export type MimexRun = {
  id: string;
  status: "uploading" | "analyzing" | "awaiting_goal" | "generating" | "succeeded" | "failed";
  filename: string;
  createdAt: string;
  updatedAt: string;
  appName: string;
  startUrl: string;
  approvedGoal?: string;
  proposal?: {
    goal: string;
    summary: string;
    observedActions: string[];
    uncertainties: string[];
    confidence: number;
  };
  output?: {
    skillName: string;
    description: string;
    skillMarkdown: string;
    confidence: number;
    stepsCount: number;
  };
  error?: string;
  kind?: "video" | "composition";
  downloadUrl?: string;
};

type ApiBody = { error?: string; run?: MimexRun; runs?: MimexRun[]; uploadId?: string };

async function api<T extends ApiBody>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({})) as T;
  if (!response.ok) throw new Error(body.error ?? `API Mimex indisponible (HTTP ${response.status}).`);
  return body;
}

export async function usesNetlifyBackend(): Promise<boolean> {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const body = await response.json() as { storage?: string };
    return body.storage === "netlify-blobs";
  } catch {
    return false;
  }
}

export async function uploadVideo(file: File, onProgress: (value: number) => void): Promise<string> {
  const chunkSize = 4 * 1024 * 1024;
  const chunkCount = Math.ceil(file.size / chunkSize);
  const created = await api<ApiBody>("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size, chunkCount }),
  });
  if (!created.uploadId) throw new Error("Netlify n'a pas créé l'upload.");
  for (let index = 0; index < chunkCount; index += 1) {
    const response = await fetch(`/api/uploads/${created.uploadId}/${index}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: file.slice(index * chunkSize, Math.min(file.size, (index + 1) * chunkSize)),
    });
    if (!response.ok) throw new Error(`Échec de l'envoi du fragment ${index + 1}/${chunkCount}.`);
    onProgress(Math.round(((index + 1) / chunkCount) * 100));
  }
  await api(`/api/uploads/${created.uploadId}/complete`, { method: "POST" });
  return created.uploadId;
}

export async function waitForRun(id: string, terminal: MimexRun["status"][]): Promise<MimexRun> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 12 * 60_000) {
    const body = await api<ApiBody>(`/api/runs/${id}`, { cache: "no-store" });
    if (!body.run) throw new Error("État du traitement introuvable.");
    if (body.run.status === "failed") throw new Error(body.run.error ?? "Traitement interrompu.");
    if (terminal.includes(body.run.status)) return body.run;
    await new Promise((resolve) => window.setTimeout(resolve, 1800));
  }
  throw new Error("Le traitement prend plus de temps que prévu. Il continue dans la bibliothèque.");
}

export async function approveGoal(id: string, goal: string, appName: string, startUrl: string): Promise<MimexRun> {
  const body = await api<ApiBody>(`/api/runs/${id}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal, appName, startUrl }),
  });
  if (!body.run) throw new Error("La génération n'a pas démarré.");
  return body.run;
}

export async function fetchRuns(): Promise<MimexRun[]> {
  const body = await api<ApiBody>("/api/runs", { cache: "no-store" });
  return body.runs ?? [];
}

export async function refineRun(id: string, instruction: string): Promise<MimexRun> {
  const body = await api<ApiBody>(`/api/runs/${id}/refine`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instruction }),
  });
  if (!body.run) throw new Error("Skill amélioré introuvable.");
  return body.run;
}

export async function renameRun(id: string, skillName: string): Promise<MimexRun> {
  const body = await api<ApiBody>(`/api/runs/${id}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ skillName }),
  });
  if (!body.run) throw new Error("Skill renommé introuvable.");
  return body.run;
}

export async function deleteRun(id: string): Promise<void> {
  const response = await fetch(`/api/runs/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Suppression impossible.");
}

export async function composeRuns(runIds: string[], name: string, goal: string): Promise<MimexRun> {
  const body = await api<ApiBody>("/api/compose", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runIds, name, goal }),
  });
  if (!body.run) throw new Error("Composition introuvable.");
  return body.run;
}

export function downloadMarkdown(markdown: string, name = "SKILL"): void {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name.replace(/\.md$/iu, "")}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}
