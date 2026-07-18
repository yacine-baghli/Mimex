import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

const allowedExtensions = new Set([".mp4", ".mov", ".webm"]);
const maxVideoBytes = 200 * 1024 * 1024;
const maxDurationSeconds = 5 * 60;

export type VideoFrame = {
  index: number;
  path: string;
  timestampMs: number;
};

export type PreparedVideo = {
  sourcePath: string;
  filename: string;
  durationMs: number;
  width: number;
  height: number;
  audioPath: string | null;
  frames: VideoFrame[];
  workingDirectory: string;
  cleanup: () => Promise<void>;
};

export type PrepareVideoOptions = {
  videoPath: string;
  intervalSeconds?: number;
  maxFrames?: number;
  ffmpegPath?: string;
  ffprobePath?: string;
  keepArtifacts?: boolean;
};

type ProbeResult = {
  format?: { duration?: string };
  streams?: Array<{
    codec_type?: "video" | "audio";
    width?: number;
    height?: number;
  }>;
};

export class VideoPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoPipelineError";
  }
}

async function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      rejectPromise(
        new VideoPipelineError(`Impossible de lancer ${command}: ${error.message}`),
      );
    });
    child.once("close", (code) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout).toString("utf8"));
        return;
      }

      const details = Buffer.concat(stderr).toString("utf8").trim();
      rejectPromise(
        new VideoPipelineError(
          `${command} s'est terminé avec le code ${String(code)}${details ? `: ${details.slice(-1200)}` : ""}`,
        ),
      );
    });
  });
}

async function probeVideo(videoPath: string, ffprobePath: string): Promise<ProbeResult> {
  const output = await runProcess(ffprobePath, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    videoPath,
  ]);

  try {
    return JSON.parse(output) as ProbeResult;
  } catch {
    throw new VideoPipelineError("FFprobe a retourné des métadonnées invalides.");
  }
}

export async function prepareVideo(options: PrepareVideoOptions): Promise<PreparedVideo> {
  const sourcePath = resolve(options.videoPath);
  const extension = extname(sourcePath).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    throw new VideoPipelineError(
      `Format vidéo non accepté (${extension || "sans extension"}). Utiliser mp4, mov ou webm.`,
    );
  }

  let sourceStats;
  try {
    sourceStats = await stat(sourcePath);
  } catch {
    throw new VideoPipelineError(`Vidéo introuvable : ${sourcePath}`);
  }

  if (!sourceStats.isFile()) {
    throw new VideoPipelineError(`Le chemin vidéo ne désigne pas un fichier : ${sourcePath}`);
  }
  if (sourceStats.size > maxVideoBytes) {
    throw new VideoPipelineError("La vidéo dépasse la limite de 200 Mo.");
  }

  const ffmpegPath = options.ffmpegPath ?? process.env.GINSE_FFMPEG_PATH ?? "ffmpeg";
  const ffprobePath = options.ffprobePath ?? process.env.GINSE_FFPROBE_PATH ?? "ffprobe";
  const intervalSeconds = options.intervalSeconds ?? 2;
  const maxFrames = options.maxFrames ?? 30;
  const probe = await probeVideo(sourcePath, ffprobePath);
  const durationSeconds = Number.parseFloat(probe.format?.duration ?? "0");

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new VideoPipelineError("La durée de la vidéo est absente ou invalide.");
  }
  if (durationSeconds > maxDurationSeconds) {
    throw new VideoPipelineError("La vidéo dépasse la durée maximale de 5 minutes.");
  }

  const videoStream = probe.streams?.find((stream) => stream.codec_type === "video");
  if (!videoStream) {
    throw new VideoPipelineError("Le fichier ne contient aucune piste vidéo.");
  }

  const workingDirectory = await mkdtemp(join(tmpdir(), "ginse-video-"));
  const framePattern = join(workingDirectory, "frame-%04d.jpg");
  const audioPath = join(workingDirectory, "audio.mp3");
  const keepArtifacts = options.keepArtifacts ?? process.env.GINSE_KEEP_ARTIFACTS === "1";

  const cleanup = async () => {
    if (!keepArtifacts) {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  };

  try {
    await runProcess(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      sourcePath,
      "-vf",
      `fps=1/${intervalSeconds},scale=960:-2:force_original_aspect_ratio=decrease`,
      "-frames:v",
      String(maxFrames),
      "-q:v",
      "5",
      framePattern,
    ]);

    const hasAudio = probe.streams?.some((stream) => stream.codec_type === "audio") ?? false;
    if (hasAudio) {
      await runProcess(ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        sourcePath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "64k",
        audioPath,
      ]);
    }

    const frameFiles = (await readdir(workingDirectory))
      .filter((file) => /^frame-\d{4}\.jpg$/u.test(file))
      .sort();

    if (frameFiles.length === 0) {
      throw new VideoPipelineError("Aucune image n'a pu être extraite de la vidéo.");
    }

    const frames: VideoFrame[] = frameFiles.map((file, index) => ({
      index: index + 1,
      path: join(workingDirectory, file),
      timestampMs: Math.round(index * intervalSeconds * 1000),
    }));

    return {
      sourcePath,
      filename: basename(sourcePath),
      durationMs: Math.round(durationSeconds * 1000),
      width: videoStream.width ?? 0,
      height: videoStream.height ?? 0,
      audioPath: hasAudio ? audioPath : null,
      frames,
      workingDirectory,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
