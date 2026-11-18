import { type FormEvent, useEffect, useState } from "react";
import { SkillPreview } from "./SkillPreview";
import { composeRuns, downloadMarkdown, fetchRuns, type MimexRun } from "./mimex-api";

type ReadyRun = MimexRun & { output: NonNullable<MimexRun["output"]> };

function hasSkill(run: MimexRun): run is ReadyRun {
  return run.status === "succeeded" && Boolean(run.output);
}

export function Compose() {
  const [runs, setRuns] = useState<ReadyRun[]>([]);
  const [selected, setSelected] = useState<ReadyRun[]>([]);
  const [result, setResult] = useState<ReadyRun | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchRuns(controller.signal)
      .then((items) => setRuns(items.filter(hasSkill)))
      .catch(() => {
        if (!controller.signal.aborted) setError("La composition nécessite l’API Netlify Mimex.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  function toggle(run: ReadyRun) {
    setSelected((current) => {
      if (current.some((item) => item.id === run.id)) return current.filter((item) => item.id !== run.id);
      return current.length < 8 ? [...current, run] : current;
    });
  }

  function move(index: number, offset: -1 | 1) {
    setSelected((current) => {
      const skill = current[index];
      const destination = index + offset;
      if (!skill || destination < 0 || destination >= current.length) return current;
      const reordered = current.filter((_, position) => position !== index);
      reordered.splice(destination, 0, skill);
      return reordered;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || selected.length < 2) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const run = await composeRuns(selected.map((item) => item.id), String(data.get("name") ?? ""), String(data.get("goal") ?? ""));
      if (!hasSkill(run)) throw new Error("Le skill composé est introuvable.");
      setResult(run);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Composition interrompue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <div><p className="breadcrumb">Studio Mimex / Composition</p><h1>Composer plusieurs skills</h1><p className="page-intro">Choisis 2 à 8 skills à exécuter dans l’ordre.</p></div>
      </header>
      <form className="panel compose-layout" onSubmit={submit}>
        <section>
          <h2>Skills disponibles</h2>
          {loading ? <p className="muted" role="status">Chargement des skills…</p> : null}
          {!loading && !error && runs.length < 2 ? <p className="muted">La composition nécessite au moins deux skills prêts.</p> : null}
          {runs.length > 0 ? (
            <div className="compose-list">
              {runs.map((run) => {
                const position = selected.findIndex((item) => item.id === run.id);
                return (
                  <button type="button" className={position >= 0 ? "selected" : ""} aria-pressed={position >= 0} disabled={busy || (position < 0 && selected.length >= 8)} key={run.id} onClick={() => toggle(run)}>
                    <span aria-hidden="true">{position >= 0 ? position + 1 : "+"}</span><strong>{run.displayName ?? run.output.skillName}</strong>
                  </button>
                );
              })}
            </div>
          ) : null}
          {selected.length > 0 ? (
            <>
              <h3 id="composition-order">Ordre d’exécution</h3>
              <ol className="composition-order" aria-labelledby="composition-order">
                {selected.map((run, index) => {
                  const title = run.displayName ?? run.output.skillName;
                  return <li key={run.id}>
                    <span>{title}</span>
                    <div className="order-actions">
                      <button className="icon-button" type="button" disabled={busy || index === 0} aria-label={`Monter ${title}`} onClick={() => move(index, -1)}>↑</button>
                      <button className="icon-button" type="button" disabled={busy || index === selected.length - 1} aria-label={`Descendre ${title}`} onClick={() => move(index, 1)}>↓</button>
                    </div>
                  </li>;
                })}
              </ol>
            </>
          ) : null}
        </section>
        <section>
          <h2>Skill parent</h2>
          <label>Nom souhaité<input name="name" placeholder="onboarding-client" /></label>
          <label>Objectif<textarea name="goal" rows={4} placeholder="Créer le client puis préparer son suivi." /></label>
          <button className="primary-button generate-button" disabled={selected.length < 2 || busy}>{busy ? "Composition par OpenAI…" : `Composer ${selected.length} skills`}</button>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
        </section>
      </form>
      {result ? (
        <section className="panel composed-result" aria-live="polite">
          <h2>{result.output.skillName}</h2><p>{result.output.description}</p>
          <div className="result-actions">
            <button className="secondary-button" type="button" onClick={() => setShowPreview(true)}>Aperçu et copie</button>
            <button className="primary-button" type="button" onClick={() => downloadMarkdown(result.output.skillMarkdown, result.output.skillName)}>Télécharger le skill composé</button>
          </div>
          {showPreview ? <SkillPreview output={result.output} title={result.output.skillName} onClose={() => setShowPreview(false)} /> : null}
        </section>
      ) : null}
    </>
  );
}
