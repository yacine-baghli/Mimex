import { useEffect, useState } from "react";
import { deleteRun, downloadMarkdown, fetchRuns, refineRun, renameRun, type MimexRun } from "./mimex-api";

export function Library({ refreshKey = 0 }: { refreshKey?: number }) {
  const [runs, setRuns] = useState<MimexRun[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try { setRuns(await fetchRuns()); setError(null); }
    catch { setError("La bibliothèque Netlify est disponible après déploiement ou avec netlify dev."); }
  }
  useEffect(() => { void refresh(); }, [refreshKey]);

  async function refine(run: MimexRun) {
    const instruction = window.prompt("Quelle modification appliquer au skill ?");
    if (!instruction?.trim()) return;
    setBusy(run.id);
    try { await refineRun(run.id, instruction); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Amélioration interrompue."); }
    finally { setBusy(null); }
  }

  async function rename(run: MimexRun) {
    const name = window.prompt("Nouveau nom du skill", run.output?.skillName);
    if (!name?.trim()) return;
    setBusy(run.id);
    try { await renameRun(run.id, name); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Renommage impossible."); }
    finally { setBusy(null); }
  }

  async function remove(run: MimexRun) {
    if (!window.confirm(`Supprimer ${run.output?.skillName ?? run.filename} ?`)) return;
    setBusy(run.id);
    try { await deleteRun(run.id); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Suppression impossible."); }
    finally { setBusy(null); }
  }

  async function codex(run: MimexRun) {
    const name = run.output?.skillName;
    if (!name) return;
    await navigator.clipboard.writeText(`Télécharge le SKILL.md de Mimex, installe-le comme skill $${name}, demande-moi les entrées obligatoires puis exécute-le.`);
  }

  return <>
    <header className="topbar"><div><p className="breadcrumb">Studio Mimex / Bibliothèque</p><h1>Skills de l'équipe</h1><p className="page-intro">Les données sont persistées dans Netlify Blobs et restent disponibles après les déploiements.</p></div><button className="secondary-button" onClick={() => void refresh()}>↻ Actualiser</button></header>
    {error ? <div className="result-message error-message">{error}</div> : null}
    <section className="library-grid">
      {runs.length === 0 ? <div className="panel empty-library">Aucun skill enregistré pour le moment.</div> : runs.map((run) => <article className="panel skill-card" key={run.id}>
        <div className="skill-card-top"><span className={`status-pill status-${run.status}`}>{run.status}</span><small>{new Date(run.createdAt).toLocaleDateString("fr-FR")}</small></div>
        <h2>{run.output?.skillName ?? run.filename}</h2>
        <p>{run.output?.description ?? run.proposal?.summary ?? run.error ?? "Traitement en cours…"}</p>
        {run.output ? <div className="skill-card-actions">
          <button onClick={() => downloadMarkdown(run.output!.skillMarkdown, run.output!.skillName)}>Télécharger</button>
          <button onClick={() => void codex(run)}>Utiliser avec Codex</button>
          <button disabled={busy === run.id} onClick={() => void refine(run)}>Améliorer par IA</button>
          <button disabled={busy === run.id} onClick={() => void rename(run)}>Renommer</button>
          <button className="destructive-link" disabled={busy === run.id} onClick={() => void remove(run)}>Supprimer</button>
        </div> : null}
      </article>)}
    </section>
  </>;
}
