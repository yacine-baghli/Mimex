import { useEffect, useState } from "react";
import { SkillPreview } from "./SkillPreview";
import { deleteRun, downloadMarkdown, fetchRuns, refineRun, renameRun, type MimexRun } from "./mimex-api";

const statusLabels: Record<MimexRun["status"], string> = {
  uploading: "Téléversement",
  analyzing: "Analyse en cours",
  awaiting_goal: "Objectif à valider",
  generating: "Génération en cours",
  succeeded: "Prêt",
  failed: "Échec",
};

export function Library({ onResume, canResume }: { onResume: (run: MimexRun) => void; canResume: boolean }) {
  const [runs, setRuns] = useState<MimexRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = runs.find((run) => run.id === previewId);

  useEffect(() => {
    if (busy) return;
    const controller = new AbortController();
    let timer: number | undefined;

    async function refresh() {
      try {
        const nextRuns = await fetchRuns(controller.signal);
        if (controller.signal.aborted) return;
        setRuns(nextRuns);
        setLoaded(true);
        setLoadError(null);
        if (nextRuns.some((run) => run.status === "analyzing" || run.status === "generating")) {
          timer = window.setTimeout(refresh, 5_000);
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        setLoadError(cause instanceof Error ? cause.message : "Impossible de charger la bibliothèque.");
      }
    }

    void refresh();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [busy, refreshKey]);

  async function update(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Modification interrompue.");
    } finally {
      setBusy(false);
    }
  }

  function refine(run: MimexRun) {
    const instruction = window.prompt("Quelle modification appliquer au skill ?")?.trim();
    if (instruction) void update(() => refineRun(run.id, instruction));
  }

  function rename(run: MimexRun) {
    const name = window.prompt("Nouveau nom dans la bibliothèque", run.displayName ?? run.output?.skillName)?.trim();
    if (name) void update(() => renameRun(run.id, name));
  }

  function remove(run: MimexRun) {
    const title = run.displayName ?? run.output?.skillName ?? run.filename;
    if (window.confirm(`Supprimer ${title} ?`)) void update(() => deleteRun(run.id));
  }

  return (
    <>
      <header className="topbar">
        <div><p className="breadcrumb">Studio Mimex / Bibliothèque</p><h1>Skills de l’équipe</h1></div>
        <button className="secondary-button" type="button" onClick={() => setRefreshKey((value) => value + 1)}>Actualiser</button>
      </header>
      {loadError ? <div className="result-message error-message" role="alert">{loadError}</div> : null}
      {actionError ? <div className="result-message error-message" role="alert">{actionError}</div> : null}
      <section className="library-grid" aria-label="Skills enregistrés">
        {!loaded && !loadError ? <div className="panel empty-library" role="status">Chargement de la bibliothèque…</div> : null}
        {loaded && runs.length === 0 ? <div className="panel empty-library">Aucun skill enregistré pour le moment.</div> : null}
        {runs.map((run) => {
          const output = run.output;
          return (
            <article className="panel skill-card" key={run.id}>
              <div className="skill-card-top">
                <span className={`status-pill status-${run.status}`}>{statusLabels[run.status]}</span>
                <small>{new Date(run.createdAt).toLocaleDateString("fr-FR")}</small>
              </div>
              <h2>{run.displayName ?? output?.skillName ?? run.filename}</h2>
              <p>{run.error ?? output?.description ?? run.proposal?.summary ?? "Traitement en cours…"}</p>
              {output ? (
                <div className="skill-card-actions">
                  <button type="button" onClick={() => setPreviewId(run.id)}>Aperçu et copie</button>
                  <button type="button" onClick={() => downloadMarkdown(output.skillMarkdown, output.skillName)}>Télécharger</button>
                  <button type="button" disabled={busy} onClick={() => refine(run)}>Améliorer par IA</button>
                  <button type="button" disabled={busy} onClick={() => rename(run)}>Renommer</button>
                  <button className="destructive-link" type="button" disabled={busy} onClick={() => remove(run)}>Supprimer</button>
                </div>
              ) : null}
              {run.status === "awaiting_goal" && run.proposal ? (
                <button className="secondary-button" type="button" disabled={!canResume} onClick={() => onResume(run)}>Valider l’objectif</button>
              ) : null}
            </article>
          );
        })}
      </section>
      {preview?.output ? (
        <SkillPreview output={preview.output} title={preview.displayName ?? preview.output.skillName} onClose={() => setPreviewId(null)} />
      ) : null}
    </>
  );
}
