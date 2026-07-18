import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  APP_ORIGIN,
  OutputSchema,
  operationKey,
  operationStore,
  readOperation,
  type Mimex2Output,
  type OperationRecord,
} from "../lib/mimex2.js";

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_DURATION_MS = 90_000;
const FFMPEG_PATH = join(
  process.env.LAMBDA_TASK_ROOT ?? process.cwd(),
  "node_modules/@ffmpeg-installer/linux-x64/ffmpeg",
);

function isPrivateAddress(address: string) {
  const value = address.toLowerCase();
  if (isIP(value) === 4) {
    const parts = value.split(".").map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || parts[0] === 0;
  }
  if (isIP(value) === 6) {
    return value === "::1"
      || value === "::"
      || value.startsWith("fe8")
      || value.startsWith("fe9")
      || value.startsWith("fea")
      || value.startsWith("feb")
      || value.startsWith("fc")
      || value.startsWith("fd")
      || value.startsWith("::ffff:127.")
      || value.startsWith("::ffff:10.")
      || value.startsWith("::ffff:192.168.");
  }
  return true;
}

async function assertPublicHttpsUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("The video URL must be a public HTTPS URL without credentials.");
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new Error("Local video URLs are not allowed.");
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("The video URL resolves to a private or unsupported address.");
  }
  return url;
}

async function fetchVideo(initialUrl: string) {
  let current = await assertPublicHttpsUrl(initialUrl);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": "Mimex2-Ginse/1.0" },
      signal: AbortSignal.timeout(60_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new Error("The video URL redirects too many times.");
      current = await assertPublicHttpsUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`The video could not be downloaded (HTTP ${response.status}).`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_VIDEO_BYTES) throw new Error("The video exceeds the 50 MB limit.");
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
    if (contentType && !contentType.startsWith("video/") && contentType !== "application/octet-stream") {
      throw new Error(`The URL does not return a video (${contentType}).`);
    }

    const chunks: Buffer[] = [];
    let total = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_VIDEO_BYTES) {
        await reader.cancel();
        throw new Error("The video exceeds the 50 MB limit.");
      }
      chunks.push(Buffer.from(value));
    }
    if (total < 1024) throw new Error("The downloaded video is empty or invalid.");
    const extension = contentType.includes("webm") || current.pathname.toLowerCase().endsWith(".webm") ? "webm" : "mp4";
    return { bytes: Buffer.concat(chunks), extension };
  }
  throw new Error("The video could not be downloaded.");
}

async function runFfmpeg(args: string[]) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-200_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(`FFmpeg failed (${code}): ${stderr.slice(-1200)}`));
    });
  });
}

function durationFromFfmpeg(stderr: string) {
  const match = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/u);
  if (!match) throw new Error("The video duration could not be read.");
  return Math.round((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000);
}

async function prepareVideo(providerOperationId: string, videoUrl: string) {
  const workDir = join(tmpdir(), providerOperationId);
  const framesDir = join(workDir, "frames");
  await mkdir(framesDir, { recursive: true });
  const downloaded = await fetchVideo(videoUrl);
  const inputPath = join(workDir, `input.${downloaded.extension}`);
  const audioPath = join(workDir, "narration.wav");
  await writeFile(inputPath, downloaded.bytes);

  const audioLog = await runFfmpeg([
    "-y", "-i", inputPath, "-t", "90", "-vn", "-ac", "1", "-ar", "8000", "-acodec", "pcm_s16le", audioPath,
  ]);
  const durationMs = durationFromFfmpeg(audioLog);
  if (durationMs <= 0 || durationMs > MAX_DURATION_MS) throw new Error("The video must be 90 seconds or shorter.");
  if ((await stat(audioPath)).size < 100) throw new Error("The video has no usable narration audio.");

  let spacingMs = 7000;
  await runFfmpeg([
    "-y", "-i", inputPath, "-vf", "fps=1/7,scale=720:-2", "-frames:v", "12", "-q:v", "6", join(framesDir, "frame-%02d.jpg"),
  ]);
  let frameNames = (await readdir(framesDir)).filter((name) => name.endsWith(".jpg")).sort();
  if (frameNames.length < 3) {
    await rm(framesDir, { recursive: true, force: true });
    await mkdir(framesDir, { recursive: true });
    spacingMs = 1000;
    await runFfmpeg([
      "-y", "-i", inputPath, "-vf", "fps=1,scale=720:-2", "-frames:v", "12", "-q:v", "6", join(framesDir, "frame-%02d.jpg"),
    ]);
    frameNames = (await readdir(framesDir)).filter((name) => name.endsWith(".jpg")).sort();
  }
  if (frameNames.length < 3) throw new Error("At least three video frames are required.");

  const frames = await Promise.all(frameNames.slice(0, 12).map(async (name, index) => ({
    index,
    timestampMs: Math.min(index * spacingMs, Math.max(0, durationMs - 1)),
    dataUrl: `data:image/jpeg;base64,${(await readFile(join(framesDir, name))).toString("base64")}`,
  })));
  const audioWavBase64 = (await readFile(audioPath)).toString("base64");
  await rm(workDir, { recursive: true, force: true });
  return { durationMs, frames, audioWavBase64, extension: downloaded.extension };
}

async function compileVideo(record: OperationRecord): Promise<Mimex2Output> {
  const prepared = await prepareVideo(record.providerOperationId, record.input.video_url);
  const response = await fetch(`${APP_ORIGIN}/api/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: `workflow.${prepared.extension}`,
      durationMs: prepared.durationMs,
      frames: prepared.frames,
      audioWavBase64: prepared.audioWavBase64,
      goal: record.input.goal ?? "Reproduce the workflow shown in the video.",
      appName: record.input.app_name ?? "Application shown in the video",
      startUrl: record.input.start_url ?? "",
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `Compilation failed (HTTP ${response.status}).`);
  if (result.status !== "ready" || !result.files || typeof result.skill_name !== "string") {
    throw new Error("The video needs clarification before it can become a replayable skill.");
  }
  const spec = result.spec as { steps?: unknown[] } | undefined;
  return OutputSchema.parse({
    status: "ready",
    skill_name: result.skill_name,
    steps_count: spec?.steps?.length ?? 1,
    files: result.files,
  });
}

export default async (request: Request) => {
  let providerOperationId = "";
  try {
    const body = await request.json() as { provider_operation_id?: unknown };
    providerOperationId = typeof body.provider_operation_id === "string" ? body.provider_operation_id : "";
    const operation = await readOperation(providerOperationId);
    if (!operation || operation.record.status !== "pending" || !operation.etag) return;

    const output = await compileVideo(operation.record);
    const succeeded: OperationRecord = {
      ...operation.record,
      status: "succeeded",
      updatedAt: new Date().toISOString(),
      output,
      error: undefined,
    };
    await operationStore().set(operationKey(providerOperationId), JSON.stringify(succeeded), {
      onlyIfMatch: operation.etag,
    });
  } catch (error) {
    console.error("Mimex2 video worker failed", error);
    if (!providerOperationId) return;
    const operation = await readOperation(providerOperationId);
    if (!operation || operation.record.status !== "pending" || !operation.etag) return;
    const failed: OperationRecord = {
      ...operation.record,
      status: "failed",
      updatedAt: new Date().toISOString(),
      error: (error instanceof Error ? error.message : "Video compilation failed.").slice(0, 500),
    };
    await operationStore().set(operationKey(providerOperationId), JSON.stringify(failed), {
      onlyIfMatch: operation.etag,
    });
  }
};

export const config = {
  background: true,
};
