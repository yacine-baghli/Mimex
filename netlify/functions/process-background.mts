import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { appendFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join } from "node:path"
import { promisify } from "node:util"
import type { Config } from "@netlify/functions"
import bundledFfmpeg from "ffmpeg-static"
import { generateSkill, proposeGoal, transcribeAudio } from "./lib/openai.mjs"
import { getRun, json, mediaStore, saveRun } from "./lib/store.mjs"

const runProcess = promisify(execFile)

function ffmpegPath(): string {
  const candidates = [bundledFfmpeg as unknown as string, join(process.cwd(), "node_modules/ffmpeg-static/ffmpeg")]
  const result = candidates.find((candidate) => candidate && existsSync(candidate))
  if (!result) throw new Error("FFmpeg n'est pas disponible dans la fonction Netlify.")
  return result
}

async function rebuildVideo(runId: string, chunkCount: number, target: string): Promise<void> {
  const store = mediaStore()
  await writeFile(target, new Uint8Array())
  for (let index = 0; index < chunkCount; index += 1) {
    const chunk = await store.get(`media:${runId}:${index}`, { type: "arrayBuffer" })
    if (!chunk) throw new Error(`Fragment vidéo ${index + 1} introuvable.`)
    await appendFile(target, Buffer.from(chunk))
  }
}

async function extractMedia(source: string, directory: string): Promise<{ audio: string | null; frames: string[] }> {
  const ffmpeg = ffmpegPath()
  const audio = join(directory, "audio.mp3")
  const framesPattern = join(directory, "frame-%03d.jpg")
  const audioTask = runProcess(ffmpeg, ["-y", "-i", source, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", audio], { timeout: 8 * 60_000, maxBuffer: 8 * 1024 * 1024 })
    .then(() => audio)
    .catch(() => null)
  const framesTask = runProcess(ffmpeg, ["-y", "-i", source, "-vf", "fps=1/2,scale=960:-2:force_original_aspect_ratio=decrease", "-frames:v", "30", framesPattern], { timeout: 8 * 60_000, maxBuffer: 8 * 1024 * 1024 })
  const [audioPath] = await Promise.all([audioTask, framesTask])
  const frames = (await readdir(directory)).filter((name) => /^frame-\d+\.jpg$/u.test(name)).sort().map((name) => join(directory, name))
  if (!frames.length) throw new Error("Aucune image n'a pu être extraite de la vidéo.")
  return { audio: audioPath, frames }
}

export default async function handler(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { runId?: string; stage?: "goal" | "skill" }
  if (!body.runId || !body.stage) return json(400, { error: "Requête de traitement invalide." })
  const record = await getRun(body.runId)
  if (!record) return json(404, { error: "Traitement introuvable." })
  if (body.stage === "goal" && record.status !== "analyzing") return json(200, { skipped: true })
  if (body.stage === "skill" && record.status !== "generating") return json(200, { skipped: true })

  const directory = await mkdtemp(join(tmpdir(), "mimex-"))
  const extension = extname(record.filename) || ".webm"
  const source = join(directory, `source${extension}`)
  try {
    await rebuildVideo(record.id, record.chunkCount, source)
    const media = await extractMedia(source, directory)
    const transcript = await transcribeAudio(media.audio)
    if (body.stage === "goal") {
      record.proposal = await proposeGoal(transcript, media.frames)
      record.status = "awaiting_goal"
    } else {
      if (!record.approvedGoal) throw new Error("L'objectif n'a pas été validé.")
      record.output = await generateSkill({
        goal: record.approvedGoal,
        appName: record.appName,
        startUrl: record.startUrl,
        transcript,
        frames: media.frames,
      })
      record.status = "succeeded"
      const store = mediaStore()
      await Promise.all(Array.from({ length: record.chunkCount }, (_, index) => store.delete(`media:${record.id}:${index}`)))
    }
    record.error = undefined
    await saveRun(record)
  } catch (error) {
    record.status = "failed"
    record.error = error instanceof Error ? error.message : "Traitement interrompu."
    await saveRun(record)
    console.error(`[mimex] ${record.id} ${body.stage} failed`, error)
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
  return json(200, { done: true })
}

export const config: Config = {}
