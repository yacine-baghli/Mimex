import type { Config } from "@netlify/functions"
import { composeSkills, rewriteSkill } from "./lib/openai.mjs"
import {
  getRun,
  json,
  listRuns,
  mediaStore,
  publicRun,
  saveRun,
  type RunRecord,
} from "./lib/store.mjs"

const MAX_VIDEO_BYTES = 200 * 1024 * 1024
const MAX_CHUNK_BYTES = 4 * 1024 * 1024
const allowedExtensions = new Set(["mp4", "mov", "webm", "mkv"])

function routePath(request: Request): string {
  const pathname = new URL(request.url).pathname
  const direct = "/.netlify/functions/api"
  if (pathname.startsWith(direct)) return pathname.slice(direct.length) || "/"
  const apiIndex = pathname.indexOf("/api/")
  if (apiIndex >= 0) return pathname.slice(apiIndex + 4)
  return pathname === "/api" ? "/" : pathname
}

async function bodyJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json()
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

async function startWorker(request: Request, runId: string, stage: "goal" | "skill"): Promise<void> {
  const origin = new URL(request.url).origin
  const response = await fetch(`${origin}/.netlify/functions/process-background`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId, stage }),
  })
  if (!response.ok) throw new Error(`Impossible de démarrer le traitement (${response.status}).`)
}

function validId(value: string): boolean {
  return /^[a-f0-9-]{20,40}$/iu.test(value)
}

export default async function handler(request: Request): Promise<Response> {
  const path = routePath(request)
  const parts = path.split("/").filter(Boolean)

  if (request.method === "GET" && path === "/health") {
    return json(200, { ok: true, openaiConfigured: Boolean(process.env.OPENAI_API_KEY), storage: "netlify-blobs" })
  }

  if (request.method === "POST" && path === "/uploads") {
    const body = await bodyJson(request)
    const filename = typeof body.filename === "string" ? body.filename.slice(0, 180) : ""
    const contentType = typeof body.contentType === "string" ? body.contentType.slice(0, 100) : "video/webm"
    const size = Number(body.size)
    const chunkCount = Number(body.chunkCount)
    const extension = filename.split(".").pop()?.toLowerCase() ?? ""
    if (!filename || !allowedExtensions.has(extension)) return json(415, { error: "Format accepté : MP4, MOV, WebM ou MKV." })
    if (!Number.isInteger(size) || size <= 0 || size > MAX_VIDEO_BYTES) return json(413, { error: "La vidéo doit peser moins de 200 Mo." })
    if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 60) return json(422, { error: "Découpage de vidéo invalide." })

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await saveRun({
      id, status: "uploading", filename, contentType, size, chunkCount,
      createdAt: now, updatedAt: now, appName: "Mimex Demo CRM", startUrl: new URL(request.url).origin,
      kind: "video",
    })
    return json(201, { uploadId: id, chunkSize: MAX_CHUNK_BYTES })
  }

  if (parts[0] === "uploads" && parts.length === 3 && request.method === "PUT") {
    const [, id, rawIndex] = parts
    if (!validId(id ?? "")) return json(404, { error: "Upload introuvable." })
    const run = await getRun(id!)
    const index = Number(rawIndex)
    if (!run || run.status !== "uploading" || !Number.isInteger(index) || index < 0 || index >= run.chunkCount) {
      return json(409, { error: "Ce fragment ne correspond pas à un upload actif." })
    }
    const data = await request.arrayBuffer()
    if (data.byteLength <= 0 || data.byteLength > MAX_CHUNK_BYTES) return json(413, { error: "Fragment vidéo trop volumineux." })
    await mediaStore().set(`media:${id}:${index}`, data, { metadata: { contentType: "application/octet-stream" } })
    return json(200, { received: index })
  }

  if (parts[0] === "uploads" && parts[2] === "complete" && request.method === "POST") {
    const id = parts[1] ?? ""
    const run = await getRun(id)
    if (!run || run.status !== "uploading") return json(409, { error: "Upload inactif ou déjà finalisé." })
    const store = mediaStore()
    for (let index = 0; index < run.chunkCount; index += 1) {
      if (!await store.getMetadata(`media:${id}:${index}`)) return json(409, { error: `Le fragment ${index + 1} manque.` })
    }
    run.status = "analyzing"
    await saveRun(run)
    try {
      await startWorker(request, id, "goal")
    } catch (error) {
      run.status = "failed"
      run.error = error instanceof Error ? error.message : "Traitement impossible."
      await saveRun(run)
      return json(502, { error: run.error })
    }
    return json(202, { run: publicRun(run) })
  }

  if (request.method === "GET" && path === "/runs") {
    return json(200, { runs: (await listRuns()).map(publicRun) })
  }

  if (parts[0] === "runs" && parts.length >= 2) {
    const id = parts[1] ?? ""
    const run = await getRun(id)
    if (!run) return json(404, { error: "Skill introuvable." })

    if (request.method === "GET" && parts.length === 2) return json(200, { run: publicRun(run) })

    if (request.method === "GET" && parts[2] === "skill.md") {
      if (!run.output) return json(409, { error: "Le skill n'est pas encore prêt." })
      return new Response(run.output.skillMarkdown, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="${run.output.skillName || "SKILL"}.md"`,
        },
      })
    }

    if (request.method === "POST" && parts[2] === "generate") {
      const body = await bodyJson(request)
      const goal = typeof body.goal === "string" ? body.goal.trim().slice(0, 2_000) : ""
      if (run.status !== "awaiting_goal" || goal.length < 5) return json(409, { error: "Valide un objectif avant la génération." })
      run.approvedGoal = goal
      run.appName = typeof body.appName === "string" ? body.appName.trim().slice(0, 120) || run.appName : run.appName
      run.startUrl = typeof body.startUrl === "string" ? body.startUrl.trim().slice(0, 500) || run.startUrl : run.startUrl
      run.status = "generating"
      run.error = undefined
      await saveRun(run)
      await startWorker(request, id, "skill")
      return json(202, { run: publicRun(run) })
    }

    if (request.method === "POST" && parts[2] === "refine") {
      const body = await bodyJson(request)
      const instruction = typeof body.instruction === "string" ? body.instruction.trim().slice(0, 4_000) : ""
      if (!run.output || instruction.length < 3) return json(422, { error: "Décris la modification souhaitée." })
      try {
        run.output = await rewriteSkill({ current: run.output.skillMarkdown, instruction })
        await saveRun(run)
        return json(200, { run: publicRun(run) })
      } catch (error) {
        return json(502, { error: error instanceof Error ? error.message : "Amélioration interrompue." })
      }
    }

    if (request.method === "PATCH" && parts.length === 2) {
      const body = await bodyJson(request)
      const skillName = typeof body.skillName === "string" ? body.skillName.trim().slice(0, 100) : ""
      if (!run.output || !skillName) return json(422, { error: "Nom invalide." })
      run.output.skillName = skillName
      await saveRun(run)
      return json(200, { run: publicRun(run) })
    }

    if (request.method === "DELETE" && parts.length === 2) {
      await runsStoreDelete(run)
      return new Response(null, { status: 204 })
    }
  }

  if (request.method === "POST" && path === "/compose") {
    const body = await bodyJson(request)
    const runIds = Array.isArray(body.runIds) ? [...new Set(body.runIds.filter((id): id is string => typeof id === "string"))] : []
    if (runIds.length < 2 || runIds.length > 8) return json(422, { error: "Choisis entre 2 et 8 skills." })
    const children = await Promise.all(runIds.map(getRun))
    if (children.some((child) => !child?.output)) return json(404, { error: "Un skill sélectionné est introuvable." })
    try {
      const output = await composeSkills({
        name: typeof body.name === "string" ? body.name.trim().slice(0, 100) : "",
        goal: typeof body.goal === "string" ? body.goal.trim().slice(0, 2_000) : "",
        children: children.map((child) => child!.output!),
      })
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const run: RunRecord = {
        id, status: "succeeded", filename: `${output.skillName}.composition`, contentType: "text/markdown",
        size: output.skillMarkdown.length, chunkCount: 0, createdAt: now, updatedAt: now,
        appName: "Composition Mimex", startUrl: "", approvedGoal: typeof body.goal === "string" ? body.goal : "",
        output, kind: "composition", childRunIds: runIds,
      }
      await saveRun(run)
      return json(201, { run: publicRun(run) })
    } catch (error) {
      return json(502, { error: error instanceof Error ? error.message : "Composition interrompue." })
    }
  }

  return json(404, { error: "Route API inconnue." })
}

async function runsStoreDelete(run: RunRecord): Promise<void> {
  const { runsStore } = await import("./lib/store.mjs")
  await runsStore().delete(`run:${run.id}`)
  const media = mediaStore()
  await Promise.all(Array.from({ length: run.chunkCount }, (_, index) => media.delete(`media:${run.id}:${index}`)))
}

export const config: Config = {}
