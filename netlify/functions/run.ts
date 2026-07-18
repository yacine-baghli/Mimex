import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { renderOpenAiYaml, renderSkillMarkdown, slugifySkillName } from "../../packages/skill-compiler/dist/render.js";
import { GeneratedSkillSpecSchema } from "../../packages/skill-compiler/dist/schema.js";

const GINSE_APP_ID = "04cbb992-55b2-4770-9606-1b4e542a19df";
const GINSE_JWKS = createRemoteJWKSet(new URL("https://api.ginse.ai/.well-known/jwks.json"));

const InputSchema = z.object({
  workflow: z.string().trim().min(20).max(12_000),
  goal: z.string().trim().min(3).max(300),
  app_name: z.string().trim().min(2).max(100),
  start_url: z.string().url().max(500).refine((value) => value.startsWith("https://"), {
    message: "start_url must use HTTPS",
  }).optional(),
}).strict();

const OutputSchema = z.object({
  status: z.literal("ready"),
  skill_name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  steps_count: z.number().int().min(1).max(30),
  files: z.object({
    skill_md: z.string().min(50),
    openai_yaml: z.string().min(20),
    evidence_json: z.string().min(20),
  }).strict(),
}).strict();

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

type OperationRecord = {
  fingerprint: string;
  providerOperationId: string;
  status: "claimed" | "succeeded";
  createdAt: string;
  output?: Output;
};

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function cleanInline(value: string) {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim();
}

function workflowSteps(workflow: string) {
  const lines = workflow
    .split(/\r?\n/gu)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "").trim())
    .filter(Boolean);
  const candidates = lines.length > 1
    ? lines
    : workflow.split(/(?<=[.!?])\s+/gu).map((part) => part.trim()).filter(Boolean);
  return candidates.slice(0, 30).map(cleanInline).filter(Boolean);
}

function compile(input: Input, createdAt: string): Output {
  const steps = workflowSteps(input.workflow);
  if (!steps.length) throw new Error("The workflow does not contain an actionable step.");

  const skillName = slugifySkillName(`${input.app_name}-${input.goal}`);
  const spec = GeneratedSkillSpecSchema.parse({
    name: input.goal,
    description: `Reproduce the ${input.goal} workflow in ${input.app_name}.`,
    goal: input.goal,
    target: {
      kind: "browser",
      appName: input.app_name,
      startUrl: input.start_url ?? "",
    },
    inputs: [],
    steps: steps.map((instruction, index) => ({
      id: `step_${index + 1}`,
      title: `Step ${index + 1}`,
      instruction,
      expectedResult: `The visible interface confirms completion of step ${index + 1}.`,
      source: {
        startMs: 0,
        endMs: 0,
        frameIndex: index,
        transcriptExcerpt: instruction,
      },
      confidence: "medium",
      uncertainty: "Compiled from the supplied workflow transcript.",
    })),
    successCriteria: [`The visible result matches this goal: ${input.goal}`],
    openQuestions: [],
    safetyConcerns: [],
    confidence: 0.75,
    readyToReplay: true,
  });

  const evidence = {
    source: "ginse_workflow_transcript",
    generated_at: createdAt,
    app_name: input.app_name,
    goal: input.goal,
    start_url: input.start_url ?? null,
    steps: steps.map((text, index) => ({ index: index + 1, text })),
  };

  return OutputSchema.parse({
    status: "ready",
    skill_name: skillName,
    steps_count: steps.length,
    files: {
      skill_md: renderSkillMarkdown(spec, skillName),
      openai_yaml: renderOpenAiYaml(spec, skillName),
      evidence_json: `${JSON.stringify(evidence, null, 2)}\n`,
    },
  });
}

async function authenticate(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/iu);
  if (!match) throw new Error("Missing Ginse bearer token.");
  await jwtVerify(match[1], GINSE_JWKS, {
    algorithms: ["EdDSA"],
    requiredClaims: ["iat", "exp"],
  });
}

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    await authenticate(request);
  } catch {
    return json({ error: "Invalid Ginse bearer token." }, 401);
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    console.warn("Mimex2 rejected Idempotency-Key", { length: idempotencyKey.length });
    return json({ error: "A valid Idempotency-Key header is required." }, 400);
  }

  let input: Input;
  try {
    const body = await request.json() as unknown;
    const transportedInput = body && typeof body === "object" && "input" in body
      ? (body as { input: unknown }).input
      : body;
    input = InputSchema.parse(transportedInput);
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")
      : "The request body must be valid JSON.";
    console.warn("Mimex2 rejected input", { message });
    return json({ error: message }, 400);
  }

  const fingerprint = digest(canonicalJson(input));
  const operationKey = `run-${digest(idempotencyKey)}`;
  const providerOperationId = `mimex2_${digest(`${GINSE_APP_ID}:${idempotencyKey}:${fingerprint}`).slice(0, 32)}`;
  const createdAt = new Date().toISOString();
  const claim: OperationRecord = {
    fingerprint,
    providerOperationId,
    status: "claimed",
    createdAt,
  };

  try {
    const store = getStore({ name: "ginse-mimex2-runs", consistency: "strong" });
    const claimResult = await store.set(operationKey, JSON.stringify(claim), { onlyIfNew: true });
    let record = claim;
    let etag = claimResult.etag;
    const replayed = !claimResult.modified;

    if (replayed) {
      const existing = await store.getWithMetadata(operationKey, { type: "text", consistency: "strong" });
      if (!existing) return json({ error: "Could not recover the idempotent operation." }, 503);
      record = JSON.parse(existing.data) as OperationRecord;
      etag = existing.etag;
      if (record.fingerprint !== fingerprint) {
        return json({ error: "Idempotency-Key was already used with different input." }, 409);
      }
      if (record.status === "succeeded" && record.output) {
        return json({
          status: "succeeded",
          provider_operation_id: record.providerOperationId,
          replayed: true,
          output: OutputSchema.parse(record.output),
        });
      }
    }

    const output = compile(input, record.createdAt);
    const terminal: OperationRecord = { ...record, status: "succeeded", output };
    const saved = etag
      ? await store.set(operationKey, JSON.stringify(terminal), { onlyIfMatch: etag })
      : { modified: false };

    if (!saved.modified) {
      const winnerData = await store.get(operationKey, { type: "text", consistency: "strong" });
      const winner = winnerData ? JSON.parse(winnerData) as OperationRecord : null;
      if (!winner || winner.fingerprint !== fingerprint || winner.status !== "succeeded" || !winner.output) {
        return json({ error: "The operation is still being finalized. Retry with the same Idempotency-Key." }, 503);
      }
      return json({
        status: "succeeded",
        provider_operation_id: winner.providerOperationId,
        replayed,
        output: OutputSchema.parse(winner.output),
      });
    }

    return json({
      status: "succeeded",
      provider_operation_id: providerOperationId,
      replayed,
      output,
    });
  } catch (error) {
    console.error("Mimex2 Ginse run failed", error);
    return json({ error: error instanceof Error ? error.message : "Run failed." }, 500);
  }
};

export const config = {
  path: "/run",
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ["ip"],
  },
};
