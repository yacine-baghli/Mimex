import { createWriteStream } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import multipart from "@fastify/multipart";
import { config as loadEnv } from "dotenv";
import Fastify, { type FastifyRequest } from "fastify";
import { proposeGoalFromVideo } from "@mimex/skill-compiler";
import { createSkillFromVideo } from "./tool.js";

const workspaceRoot = resolve(
  process.env.MIMEX_WORKSPACE_ROOT ?? fileURLToPath(new URL("../../..", import.meta.url)),
);
loadEnv({ path: resolve(workspaceRoot, ".env") });

const allowedExtensions = new Set([".mp4", ".mov", ".webm"]);
const maxVideoBytes = 200 * 1024 * 1024;

type ApiFields = {
  goal?: string;
  app_name?: string;
  start_url?: string;
};

function normalizeField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

class UploadRequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "UploadRequestError";
  }
}

type VideoUpload = {
  fields: ApiFields;
  uploadPath: string;
  originalFilename: string;
};

async function receiveVideoUpload(request: FastifyRequest): Promise<VideoUpload> {
  const uploadDirectory = resolve(workspaceRoot, ".mimex-tmp", "uploads");
  await mkdir(uploadDirectory, { recursive: true });
  const fields: ApiFields = {};
  let uploadPath: string | null = null;
  let originalFilename = "";

  try {
    for await (const part of request.parts()) {
      if (part.type === "field") {
        if (part.fieldname === "goal" || part.fieldname === "app_name" || part.fieldname === "start_url") {
          fields[part.fieldname] = normalizeField(part.value);
        }
        continue;
      }

      const extension = extname(part.filename).toLowerCase();
      if (part.fieldname !== "video" || !allowedExtensions.has(extension)) {
        part.file.resume();
        throw new UploadRequestError(415, "Format vidéo non accepté. Utiliser un fichier MP4, MOV ou WebM.");
      }

      originalFilename = part.filename;
      uploadPath = resolve(uploadDirectory, `${randomUUID()}${extension}`);
      await pipeline(part.file, createWriteStream(uploadPath, { flags: "wx" }));
      if (part.file.truncated) {
        throw new UploadRequestError(413, "La vidéo dépasse la limite de 200 Mo.");
      }
    }

    if (!uploadPath) {
      throw new UploadRequestError(400, "Ajoute une vidéo avant de lancer l’analyse.");
    }
    return { fields, uploadPath, originalFilename };
  } catch (error) {
    if (uploadPath) await unlink(uploadPath).catch(() => undefined);
    throw error;
  }
}

function publicErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Erreur inconnue";
  const status = "status" in error ? Number((error as { status?: unknown }).status) : 0;
  if (status === 401) return "La clé API OpenAI est invalide ou révoquée.";
  if (status === 429) return "Le quota ou la limite de débit OpenAI est atteint.";
  if (status >= 500) return "Le service OpenAI est temporairement indisponible.";
  return error.message;
}

export function buildHttpServer() {
  const server = Fastify({
    logger: true,
    bodyLimit: maxVideoBytes + 1024 * 1024,
  });

  void server.register(multipart, {
    limits: {
      fileSize: maxVideoBytes,
      files: 1,
      fields: 6,
      parts: 7,
    },
  });

  server.get("/api/health", async () => ({
    ok: true,
    openai_configured: Boolean(process.env.OPENAI_API_KEY),
  }));

  server.post("/api/objectives", async (request, reply) => {
    let upload: VideoUpload | null = null;
    try {
      upload = await receiveVideoUpload(request);
      if (!process.env.OPENAI_API_KEY && process.env.MIMEX_MOCK !== "1") {
        return reply.code(503).send({ error: "OPENAI_API_KEY manque dans le fichier .env du serveur." });
      }

      const analysis = await proposeGoalFromVideo(upload.uploadPath);
      return reply.send({
        status: "proposal_ready",
        source_video: upload.originalFilename,
        proposed_goal: analysis.proposal.goal,
        summary: analysis.proposal.summary,
        observed_actions: analysis.proposal.observedActions,
        uncertainties: analysis.proposal.uncertainties,
        confidence: analysis.proposal.confidence,
        duration_ms: analysis.durationMs,
        frame_count: analysis.frameCount,
        has_narration: analysis.hasNarration,
      });
    } catch (error) {
      request.log.error(error);
      if (error instanceof UploadRequestError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      return reply.code(502).send({ error: `L’analyse OpenAI a échoué : ${publicErrorMessage(error)}` });
    } finally {
      if (upload) await unlink(upload.uploadPath).catch(() => undefined);
    }
  });

  server.post("/api/skills", async (request, reply) => {
    let upload: VideoUpload | null = null;

    try {
      upload = await receiveVideoUpload(request);
      if (!upload.fields.goal || upload.fields.goal.length < 5) {
        return reply.code(400).send({ error: "Décris précisément l’objectif de la démonstration." });
      }
      if (!process.env.OPENAI_API_KEY && process.env.MIMEX_MOCK !== "1") {
        return reply.code(503).send({
          error: "OPENAI_API_KEY manque dans le fichier .env du serveur.",
        });
      }

      const result = await createSkillFromVideo(
        {
          video_path: relative(workspaceRoot, upload.uploadPath),
          goal: upload.fields.goal,
          target: {
            kind: "browser",
            app_name: upload.fields.app_name || "Mimex Demo CRM",
            start_url: upload.fields.start_url || "http://localhost:3000",
          },
        },
        workspaceRoot,
      );

      let skillMarkdown: string | null = null;
      let evidence: unknown = null;
      if (result.skill_path) {
        skillMarkdown = await readFile(resolve(workspaceRoot, result.skill_path), "utf8");
      }
      if (result.evidence_manifest) {
        evidence = JSON.parse(
          await readFile(resolve(workspaceRoot, result.evidence_manifest), "utf8"),
        ) as unknown;
      }

      const statusCode = result.status === "failed" ? 422 : 200;
      return reply.code(statusCode).send({
        ...result,
        source_video: upload.originalFilename,
        skill_markdown: skillMarkdown,
        evidence,
      });
    } catch (error) {
      request.log.error(error);
      if (error instanceof UploadRequestError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      return reply.code(500).send({ error: `La génération a échoué : ${publicErrorMessage(error)}` });
    } finally {
      if (upload) await unlink(upload.uploadPath).catch(() => undefined);
    }
  });

  return server;
}

const port = Number.parseInt(process.env.MIMEX_API_PORT ?? "8787", 10);
const host = process.env.MIMEX_API_HOST ?? "127.0.0.1";
const server = buildHttpServer();

try {
  await server.listen({ port, host });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
