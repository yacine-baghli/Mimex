import { ChangeEvent, DragEvent, FormEvent, useMemo, useRef, useState } from "react";
import { zipSync, strToU8 } from "fflate";
import { prepareVideoForCompilation, type PreparedBrowserVideo } from "./preprocess.js";

type Stage = "idle" | "preparing" | "uploading" | "analyzing" | "ready" | "error";

type SkillInput = {
  key: string;
  label: string;
  required: boolean;
  allowedValues: string[];
};

type SkillStep = {
  id: string;
  title: string;
  instruction: string;
  expectedResult: string;
  confidence: "high" | "medium" | "low";
};

type CompileResult = {
  status: "ready" | "needs_clarification" | "unsafe";
  skill_name: string | null;
  confidence: number;
  open_questions: string[];
  safety_concerns: string[];
  warnings: string[];
  spec: {
    name: string;
    description: string;
    goal: string;
    inputs: SkillInput[];
    steps: SkillStep[];
    successCriteria: string[];
  } | null;
  files: {
    skill_md: string;
    openai_yaml: string;
    evidence_json: string;
  } | null;
};

const stageCopy: Record<Stage, { index: number; label: string }> = {
  idle: { index: 0, label: "Prêt" },
  preparing: { index: 1, label: "Lecture de la vidéo" },
  uploading: { index: 2, label: "Envoi sécurisé" },
  analyzing: { index: 3, label: "Compilation du skill" },
  ready: { index: 4, label: "Skill prêt" },
  error: { index: -1, label: "Compilation interrompue" },
};

const pipeline = ["Vidéo", "Frames + voix", "Compréhension", "Skill Codex"];

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildSkillZip(result: CompileResult) {
  if (!result.files || !result.skill_name) return;
  const root = result.skill_name;
  const zip = zipSync({
    [`${root}/SKILL.md`]: strToU8(result.files.skill_md),
    [`${root}/agents/openai.yaml`]: strToU8(result.files.openai_yaml),
    [`${root}/references/evidence.json`]: strToU8(result.files.evidence_json),
  });
  downloadBlob(new Blob([zip], { type: "application/zip" }), `${root}.zip`);
}

export function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [goal, setGoal] = useState("");
  const [appName, setAppName] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompileResult | null>(null);

  const busy = stage === "preparing" || stage === "uploading" || stage === "analyzing";
  const stageIndex = stageCopy[stage].index;
  const confidence = useMemo(
    () => (result ? `${Math.round(result.confidence * 100)} %` : "—"),
    [result],
  );

  function acceptFile(nextFile: File | undefined) {
    if (!nextFile) return;
    setError(null);
    setResult(null);
    setStage("idle");

    if (!/^video\/(webm|mp4)$/u.test(nextFile.type) && !/\.(webm|mp4)$/iu.test(nextFile.name)) {
      setError("Utilisez une vidéo WebM ou MP4 lisible dans Chrome.");
      setStage("error");
      return;
    }
    if (nextFile.size > 50 * 1024 * 1024) {
      setError("La vidéo dépasse 50 Mo. Exportez une version plus courte ou compressée.");
      setStage("error");
      return;
    }
    setFile(nextFile);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    acceptFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
  }

  async function compile(event: FormEvent) {
    event.preventDefault();
    if (!file || busy) return;

    setError(null);
    setResult(null);

    try {
      setStage("preparing");
      const prepared: PreparedBrowserVideo = await prepareVideoForCompilation(file);
      setStage("uploading");

      const responsePromise = fetch("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...prepared,
          goal: goal.trim() || "Reproduire fidèlement le workflow montré dans la vidéo.",
          appName: appName.trim() || "Application montrée dans la vidéo",
          startUrl: startUrl.trim(),
        }),
      });

      setStage("analyzing");
      const response = await responsePromise;
      const payload = (await response.json()) as CompileResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "La pipeline distante a échoué.");

      setResult(payload);
      setStage("ready");
    } catch (caught) {
      setStage("error");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function reset() {
    setFile(null);
    setGoal("");
    setAppName("");
    setStartUrl("");
    setResult(null);
    setError(null);
    setStage("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="page-shell">
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Ginse — Accueil">
          <span className="wordmark-glyph" aria-hidden="true">G</span>
          <span>GINSE</span>
        </a>
        <span className="hackathon-pill">Hackathon build</span>
      </header>

      <main className="compiler-layout">
        <section className="intro-panel">
          <p className="kicker">COMPILATEUR VIDÉO → SKILL</p>
          <h1>Montrez le geste.<br />Récupérez le skill.</h1>
          <p className="intro-copy">
            Ginse lit l’écran et la narration, sépare les exemples des variables, puis livre un skill prêt à ajouter dans Codex.
          </p>

          <ol className="pipeline-rail" aria-label="Étapes de compilation">
            {pipeline.map((label, index) => {
              const active = stageIndex === index + 1 || (stage === "preparing" && index === 0);
              const complete = stageIndex > index + 1 || stage === "ready";
              return (
                <li className={active ? "active" : complete ? "complete" : ""} key={label}>
                  <span className="pipeline-node">{complete ? "✓" : index + 1}</span>
                  <span>{label}</span>
                </li>
              );
            })}
          </ol>

          <div className="privacy-note">
            <span aria-hidden="true">⌁</span>
            <p><strong>Traitement éphémère.</strong> La vidéo est préparée dans votre navigateur. Seuls des extraits compressés sont analysés.</p>
          </div>
        </section>

        <section className="workspace-panel" aria-labelledby="workspace-title">
          <div className="workspace-heading">
            <div>
              <p className="section-index">01 / SOURCE</p>
              <h2 id="workspace-title">Déposez la démonstration</h2>
            </div>
            <span className={`status-badge status-${stage}`}>{stageCopy[stage].label}</span>
          </div>

          <form onSubmit={compile}>
            <input
              ref={inputRef}
              className="visually-hidden"
              type="file"
              accept="video/webm,video/mp4,.webm,.mp4"
              onChange={onFileChange}
            />

            <div
              className={`drop-zone ${isDragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
              onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
            >
              {file ? (
                <>
                  <span className="file-icon" aria-hidden="true">▶</span>
                  <div className="file-copy">
                    <strong>{file.name}</strong>
                    <span>{formatBytes(file.size)} · WebM ou MP4 · 90 s max</span>
                  </div>
                  <button className="replace-button" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
                    Remplacer
                  </button>
                </>
              ) : (
                <button className="drop-action" type="button" onClick={() => inputRef.current?.click()}>
                  <span className="upload-mark" aria-hidden="true">↑</span>
                  <strong>Choisir une vidéo</strong>
                  <span>ou glissez-la ici · WebM/MP4 · 50 Mo max</span>
                </button>
              )}
            </div>

            <label className="field-label" htmlFor="goal">Objectif du workflow <span>facultatif</span></label>
            <input
              id="goal"
              className="text-field"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Ex. Créer une fiche client à partir d’un formulaire"
              disabled={busy}
            />

            <details className="context-details">
              <summary>Préciser l’application cible</summary>
              <div className="context-grid">
                <label>
                  Nom de l’application
                  <input value={appName} onChange={(event) => setAppName(event.target.value)} placeholder="Ex. HubSpot" disabled={busy} />
                </label>
                <label>
                  URL de départ
                  <input value={startUrl} onChange={(event) => setStartUrl(event.target.value)} placeholder="https://…" type="url" disabled={busy} />
                </label>
              </div>
            </details>

            {error ? <div className="error-message" role="alert"><span>!</span><p>{error}</p></div> : null}

            <button className="compile-button" type="submit" disabled={!file || busy}>
              {busy ? <span className="spinner" aria-hidden="true" /> : <span aria-hidden="true">⌘</span>}
              {busy ? stageCopy[stage].label : "Compiler en skill Codex"}
            </button>
          </form>

          {result ? (
            <section className={`result-card result-${result.status}`} aria-live="polite">
              <div className="result-heading">
                <div>
                  <p className="section-index">02 / RÉSULTAT</p>
                  <h2>{result.status === "ready" ? result.spec?.name : "Vérification requise"}</h2>
                </div>
                <div className="confidence"><span>Confiance</span><strong>{confidence}</strong></div>
              </div>

              {result.status === "ready" && result.spec ? (
                <>
                  <p className="result-description">{result.spec.description}</p>
                  <div className="result-stats">
                    <span><strong>{result.spec.steps.length}</strong> étapes</span>
                    <span><strong>{result.spec.inputs.length}</strong> variables</span>
                    <span><strong>{result.spec.successCriteria.length}</strong> contrôles</span>
                  </div>
                  <div className="input-chips">
                    {result.spec.inputs.map((input) => <code key={input.key}>{`{{${input.key}}}`}</code>)}
                  </div>
                  <button className="download-button" type="button" onClick={() => buildSkillZip(result)}>
                    Télécharger le skill .zip <span aria-hidden="true">↓</span>
                  </button>
                  <button className="start-over" type="button" onClick={reset}>Compiler une autre vidéo</button>
                </>
              ) : (
                <>
                  {[...result.open_questions, ...result.safety_concerns].map((item) => <p className="question" key={item}>— {item}</p>)}
                  <button className="start-over" type="button" onClick={reset}>Essayer une autre vidéo</button>
                </>
              )}
            </section>
          ) : null}
        </section>
      </main>

      <footer>
        <span>GINSE / VIDEO COMPILER</span>
        <span>Les agents improvisent. Ginse transmet le geste.</span>
      </footer>
    </div>
  );
}
