import { getStore } from "@netlify/blobs"

export type RunStatus =
  | "uploading"
  | "analyzing"
  | "awaiting_goal"
  | "generating"
  | "succeeded"
  | "failed"

export type GoalProposal = {
  goal: string
  summary: string
  observedActions: string[]
  uncertainties: string[]
  confidence: number
}

export type SkillOutput = {
  skillName: string
  description: string
  skillMarkdown: string
  confidence: number
  stepsCount: number
}

export type RunRecord = {
  id: string
  status: RunStatus
  filename: string
  contentType: string
  size: number
  chunkCount: number
  createdAt: string
  updatedAt: string
  appName: string
  startUrl: string
  displayName?: string
  approvedGoal?: string
  proposal?: GoalProposal
  output?: SkillOutput
  error?: string
  kind?: "video" | "composition"
  childRunIds?: string[]
}

export const runsStore = () => getStore({ name: "mimex-runs", consistency: "strong" })
export const mediaStore = () => getStore({ name: "mimex-media", consistency: "strong" })

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}

export async function getRun(id: string): Promise<RunRecord | null> {
  return await runsStore().get(`run:${id}`, { type: "json" }) as RunRecord | null
}

export async function saveRun(run: RunRecord): Promise<void> {
  run.updatedAt = new Date().toISOString()
  const store = runsStore()
  await store.setJSON(`run:${run.id}`, run)
  const index = await store.get("index", { type: "json" }) as { ids?: string[] } | null
  const ids = [run.id, ...(index?.ids ?? []).filter((id) => id !== run.id)].slice(0, 100)
  await store.setJSON("index", { ids })
}

export async function listRuns(): Promise<RunRecord[]> {
  const store = runsStore()
  const index = await store.get("index", { type: "json" }) as { ids?: string[] } | null
  const values = await Promise.all((index?.ids ?? []).map((id) => getRun(id)))
  return values.filter((run): run is RunRecord => Boolean(run))
}

export function publicRun(run: RunRecord) {
  return {
    id: run.id,
    status: run.status,
    filename: run.filename,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    appName: run.appName,
    startUrl: run.startUrl,
    displayName: run.displayName,
    approvedGoal: run.approvedGoal,
    proposal: run.proposal,
    output: run.output,
    error: run.error,
    kind: run.kind ?? "video",
    childRunIds: run.childRunIds,
    downloadUrl: run.output ? `/api/runs/${run.id}/skill.md` : undefined,
  }
}
