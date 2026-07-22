import { FormEvent, useEffect, useState } from "react";
import { composeRuns, downloadMarkdown, fetchRuns, type MimexRun } from "./mimex-api";

export function Compose() {
  const [runs, setRuns] = useState<MimexRun[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<MimexRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetchRuns().then((items) => setRuns(items.filter((run) => run.status === "succeeded" && run.output))).catch(() => setError("La composition nécessite l'API Netlify Mimex.")); }, []);

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 8 ? [...current, id] : current);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try { setResult(await composeRuns(selected, String(data.get("name") ?? ""), String(data.get("goal") ?? ""))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Composition interrompue."); }
    finally { setBusy(false); }
  }

  return <>
    <header className="topbar"><div><p className="breadcrumb">Studio Mimex / Composition</p><h1>Composer plusieurs skills</h1><p className="page-intro">Sélectionne 2 à 8 procédures. OpenAI crée un skill parent qui les appelle dans l'ordre choisi.</p></div></header>
    <form className="panel compose-layout" onSubmit={submit}>
      <section><h2>1. Skills enfants</h2><p className="muted">L'ordre de sélection devient l'ordre d'exécution.</p><div className="compose-list">{runs.map((run) => <button type="button" className={selected.includes(run.id) ? "selected" : ""} key={run.id} onClick={() => toggle(run.id)}><span>{selected.indexOf(run.id) + 1 || "+"}</span><strong>{run.output?.skillName}</strong></button>)}</div></section>
      <section><h2>2. Skill parent</h2><label>Nom souhaité<input name="name" placeholder="onboarding-client" /></label><label>Objectif<textarea name="goal" rows={4} placeholder="Créer le client puis préparer son suivi." /></label><button className="primary-button generate-button" disabled={selected.length < 2 || busy}>{busy ? "Composition par OpenAI…" : `Composer ${selected.length} skills`}</button>{error ? <p className="field-error">{error}</p> : null}</section>
    </form>
    {result?.output ? <section className="panel composed-result"><h2>{result.output.skillName}</h2><p>{result.output.description}</p><button className="primary-button" onClick={() => downloadMarkdown(result.output!.skillMarkdown, result.output!.skillName)}>Télécharger le skill composé</button></section> : null}
  </>;
}
