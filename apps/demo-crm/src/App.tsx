import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Compose } from "./Compose";
import { Library } from "./Library";
import { Recorder } from "./Recorder";
import { approveGoal, uploadVideo, usesNetlifyBackend, waitForRun, type MimexRun } from "./mimex-api";

type Priority = "Basse" | "Normale" | "Haute";
type View = "customers" | "skills" | "library" | "compose";
type GenerationPhase = "idle" | "analyzing_goal" | "awaiting_validation" | "generating" | "done" | "error";

type Customer = {
  id: string;
  name: string;
  company: string;
  priority: Priority;
  createdAt: string;
};

type SkillApiResponse = {
  status?: "ready" | "needs_clarification" | "unsafe" | "failed";
  skill_name?: string | null;
  skill_path?: string | null;
  confidence?: number;
  ready_to_replay?: boolean;
  open_questions?: string[];
  safety_concerns?: string[];
  warnings?: string[];
  skill_markdown?: string | null;
  evidence?: { steps?: unknown[]; transcript?: unknown[] } | null;
  error?: string;
};

type GoalProposal = {
  status?: "proposal_ready";
  proposed_goal?: string;
  summary?: string;
  observed_actions?: string[];
  uncertainties?: string[];
  confidence?: number;
  duration_ms?: number;
  frame_count?: number;
  error?: string;
};

const seedCustomers: Customer[] = [
  { id: "seed-1", name: "Grace Hopper", company: "Compiler Labs", priority: "Haute", createdAt: "18 juil. 2026" },
  { id: "seed-2", name: "Alan Turing", company: "Bletchley Systems", priority: "Normale", createdAt: "17 juil. 2026" },
];

const storageKey = "mimex-demo-customers-v1";
const maxVideoBytes = 200 * 1024 * 1024;
const acceptedExtensions = ["mp4", "mov", "webm"];

function loadCustomers(): Customer[] {
  const stored = localStorage.getItem(storageKey);
  if (!stored) return seedCustomers;
  try {
    return JSON.parse(stored) as Customer[];
  } catch {
    return seedCustomers;
  }
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

function runToLegacyResult(run: MimexRun): SkillApiResponse {
  return {
    status: run.status === "succeeded" ? "ready" : "failed",
    skill_name: run.output?.skillName ?? null,
    ...(run.output ? { confidence: run.output.confidence } : {}),
    ready_to_replay: run.status === "succeeded",
    skill_markdown: run.output?.skillMarkdown ?? null,
    evidence: { steps: Array.from({ length: run.output?.stepsCount ?? 0 }) },
    ...(run.error ? { error: run.error } : {}),
  };
}

async function readApiPayload<T extends { error?: string }>(response: Response): Promise<T> {
  const body = await response.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(
      `Réponse API invalide (HTTP ${response.status}). Vérifie que le serveur Mimex fonctionne, puis recharge la page.`,
    );
  }
}

export function App() {
  const [view, setView] = useState<View>("customers");
  const [customers, setCustomers] = useState<Customer[]>(loadCustomers);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [phase, setPhase] = useState<GenerationPhase>("idle");
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [result, setResult] = useState<SkillApiResponse | null>(null);
  const [goalProposal, setGoalProposal] = useState<GoalProposal | null>(null);
  const [approvedGoal, setApprovedGoal] = useState("");
  const [codexPrompt, setCodexPrompt] = useState<string | null>(null);
  const [codexCopyState, setCodexCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const videoUrl = useMemo(() => (video ? URL.createObjectURL(video) : null), [video]);
  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  const highPriorityCount = useMemo(
    () => customers.filter((customer) => customer.priority === "Haute").length,
    [customers],
  );

  function saveCustomers(nextCustomers: Customer[]) {
    setCustomers(nextCustomers);
    localStorage.setItem(storageKey, JSON.stringify(nextCustomers));
  }

  function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("customer_name") ?? "").trim();
    const company = String(form.get("company_name") ?? "").trim();
    const priority = String(form.get("priority") ?? "Normale") as Priority;
    if (!name || !company) return;

    const customer: Customer = {
      id: crypto.randomUUID(),
      name,
      company,
      priority,
      createdAt: new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(new Date()),
    };
    saveCustomers([customer, ...customers]);
    setIsFormOpen(false);
    setNotice(`Client créé : ${name}`);
  }

  function resetDemo() {
    saveCustomers(seedCustomers);
    setIsFormOpen(false);
    setNotice("Données de démonstration réinitialisées");
  }

  function selectVideo(file: File | undefined) {
    setVideoError(null);
    setResult(null);
    setGoalProposal(null);
    setApprovedGoal("");
    setCodexPrompt(null);
    setCodexCopyState("idle");
    setActiveRunId(null);
    setUploadProgress(0);
    setPhase("idle");
    if (!file) return;

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!acceptedExtensions.includes(extension)) {
      setVideo(null);
      setVideoError("Format non accepté. Utilise MP4, MOV ou WebM.");
      return;
    }
    if (file.size > maxVideoBytes) {
      setVideo(null);
      setVideoError("La vidéo dépasse la limite de 200 Mo.");
      return;
    }
    setVideo(file);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    selectVideo(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    selectVideo(event.dataTransfer.files[0]);
  }

  async function analyzeGoal(formElement: HTMLFormElement) {
    if (!video) return;
    const form = new FormData();
    form.set("video", video, video.name);
    setPhase("analyzing_goal");
    setGenerationError(null);
    setResult(null);
    setCodexPrompt(null);
    setCodexCopyState("idle");

    try {
      if (await usesNetlifyBackend()) {
        const runId = await uploadVideo(video, setUploadProgress);
        setActiveRunId(runId);
        const run = await waitForRun(runId, ["awaiting_goal"]);
        if (!run.proposal) throw new Error("OpenAI n'a retourné aucun objectif exploitable.");
        const proposal: GoalProposal = {
          status: "proposal_ready",
          proposed_goal: run.proposal.goal,
          summary: run.proposal.summary,
          observed_actions: run.proposal.observedActions,
          uncertainties: run.proposal.uncertainties,
          confidence: run.proposal.confidence,
        };
        setGoalProposal(proposal);
        setApprovedGoal(run.proposal.goal);
        setPhase("awaiting_validation");
        formElement.querySelector<HTMLTextAreaElement>('textarea[name="goal"]')?.focus();
        return;
      }
      const response = await fetch("/api/objectives", { method: "POST", body: form });
      const payload = await readApiPayload<GoalProposal>(response);
      if (!response.ok || payload.error || !payload.proposed_goal) {
        throw new Error(payload.error ?? "OpenAI n’a pas pu déduire un objectif de cette vidéo.");
      }
      setGoalProposal(payload);
      setApprovedGoal(payload.proposed_goal);
      setPhase("awaiting_validation");
      formElement.querySelector<HTMLTextAreaElement>('textarea[name="goal"]')?.focus();
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Erreur réseau inattendue.");
      setPhase("error");
    }
  }

  async function generateSkill(formElement: HTMLFormElement) {
    if (!video || !goalProposal) return;
    const goal = approvedGoal.trim();
    if (goal.length < 5) {
      setGenerationError("Valide ou corrige l’objectif proposé avant de générer le skill.");
      setPhase("error");
      return;
    }

    const form = new FormData(formElement);
    form.set("video", video, video.name);
    form.set("goal", goal);
    setPhase("generating");
    setGenerationError(null);
    setResult(null);

    try {
      if (activeRunId) {
        const appName = String(form.get("app_name") ?? "Mimex Demo CRM");
        const startUrl = String(form.get("start_url") ?? window.location.origin);
        await approveGoal(activeRunId, goal, appName, startUrl);
        const run = await waitForRun(activeRunId, ["succeeded"]);
        if (!run.output) throw new Error("Le fichier SKILL.md est absent du résultat.");
        setResult(runToLegacyResult(run));
        setLibraryRefreshKey((value) => value + 1);
        setPhase("done");
        return;
      }
      const response = await fetch("/api/skills", { method: "POST", body: form });
      const payload = await readApiPayload<SkillApiResponse>(response);
      if (!response.ok || payload.error || payload.status === "failed") {
        throw new Error(payload.error ?? payload.open_questions?.[0] ?? "La génération du skill a échoué.");
      }
      setResult(payload);
      setPhase("done");
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Erreur réseau inattendue.");
      setPhase("error");
    }
  }

  async function handleSkillFlow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!video) {
      setVideoError("Ajoute la vidéo de ta démonstration.");
      return;
    }
    if (!goalProposal) await analyzeGoal(event.currentTarget);
    else await generateSkill(event.currentTarget);
  }

  function downloadSkill() {
    if (!result?.skill_markdown) return;
    const blob = new Blob([result.skill_markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "SKILL.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function useWithCodex() {
    if (!result?.skill_name) return;
    const prompt = `Installe le fichier SKILL.md téléchargé depuis Mimex comme skill $${result.skill_name}. Commence par me demander les entrées obligatoires, puis reproduis la procédure dans l'application cible et confirme visuellement le résultat.`;
    setCodexPrompt(prompt);
    try {
      await navigator.clipboard.writeText(prompt);
      setCodexCopyState("copied");
    } catch {
      setCodexCopyState("manual");
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" aria-label="Mimex"><span className="brand-mark">M</span><span>MIMEX</span></div>
        <nav aria-label="Navigation principale">
          <button className={`nav-item ${view === "customers" ? "active" : ""}`} type="button" onClick={() => setView("customers")}>
            <span aria-hidden="true">◎</span> CRM de démonstration
          </button>
          <button className={`nav-item ${view === "skills" ? "active" : ""}`} type="button" onClick={() => setView("skills")}>
            <span aria-hidden="true">✦</span> Générer un skill
          </button>
          <button className={`nav-item ${view === "library" ? "active" : ""}`} type="button" onClick={() => setView("library")}>
            <span aria-hidden="true">▦</span> Bibliothèque
          </button>
          <button className={`nav-item ${view === "compose" ? "active" : ""}`} type="button" onClick={() => setView("compose")}>
            <span aria-hidden="true">⎇</span> Composer des skills
          </button>
        </nav>
        <div className="demo-card">
          <span className="eyebrow">MODE DÉMO</span>
          <p>Filme une procédure dans le CRM, puis transforme-la en skill Codex.</p>
          <button className="text-button" type="button" onClick={resetDemo}>Réinitialiser les données</button>
        </div>
      </aside>

      <main>
        {view === "customers" ? (
          <>
            <header className="topbar">
              <div><p className="breadcrumb">Espace de démonstration / Clients</p><h1>Clients</h1></div>
              <button className="primary-button" type="button" onClick={() => setIsFormOpen(true)}>＋ Nouveau client</button>
            </header>
            {notice ? <div className="notice" role="status"><span>✓</span><span>{notice}</span><button type="button" aria-label="Fermer" onClick={() => setNotice(null)}>×</button></div> : null}
            <section className="metrics" aria-label="Indicateurs clients">
              <article><p>Clients actifs</p><strong>{customers.length}</strong><span>dans cet espace</span></article>
              <article><p>Priorité haute</p><strong>{highPriorityCount}</strong><span>à suivre aujourd’hui</span></article>
              <article><p>Dernière création</p><strong className="compact-value">{customers[0]?.createdAt ?? "—"}</strong><span>{customers[0]?.name ?? "Aucun client"}</span></article>
            </section>
            <section className="panel" id="customers" aria-labelledby="customer-list-title">
              <div className="panel-heading"><div><h2 id="customer-list-title">Répertoire clients</h2><p>Les fiches les plus récentes apparaissent en premier.</p></div></div>
              <div className="table-wrap"><table><thead><tr><th>Client</th><th>Entreprise</th><th>Priorité</th><th>Créé le</th></tr></thead><tbody>
                {customers.map((customer) => <tr key={customer.id} data-customer-name={customer.name}><td><span className="avatar">{customer.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span><strong>{customer.name}</strong></td><td>{customer.company}</td><td><span className={`priority priority-${customer.priority.toLowerCase()}`}>{customer.priority}</span></td><td>{customer.createdAt}</td></tr>)}
              </tbody></table></div>
            </section>
          </>
        ) : view === "skills" ? (
          <>
            <header className="topbar skill-topbar">
              <div><p className="breadcrumb">Studio Mimex / Video to Skill</p><h1>Créer un skill depuis une vidéo</h1><p className="page-intro">Dépose ou filme une démonstration. Mimex en extrait les étapes, les entrées variables et les critères de réussite.</p></div>
              <span className="api-badge"><i /> OpenAI sécurisé côté serveur</span>
            </header>

            <section className="skill-layout">
              <form className="skill-form panel" onSubmit={handleSkillFlow}>
                <div className="skill-form-heading"><span className="step-number">01</span><div><h2>Vidéo de démonstration</h2><p>MP4, MOV ou WebM · 200 Mo maximum · 5 minutes</p></div></div>
                <div className={`drop-zone ${video ? "has-file" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onClick={() => fileInputRef.current?.click()}>
                  <input ref={fileInputRef} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={onFileChange} hidden />
                  {video ? <><span className="file-icon">▶</span><strong>{video.name}</strong><small>{formatBytes(video.size)}</small><button className="replace-file" type="button">Remplacer</button></> : <><span className="upload-icon">↑</span><strong>Dépose ta vidéo ici</strong><small>ou clique pour parcourir tes fichiers</small></>}
                </div>
                <Recorder onVideo={(file) => selectVideo(file)} />
                {videoError ? <p className="field-error" role="alert">{videoError}</p> : null}
                {videoUrl ? <video className="video-preview" src={videoUrl} controls preload="metadata" /> : null}

                <div className="skill-form-heading compact"><span className="step-number">02</span><div><h2>Objectif proposé par OpenAI</h2><p>Analyse d’abord la vidéo, puis valide ou corrige la proposition.</p></div></div>
                {goalProposal ? (
                  <div className="goal-proposal">
                    <div className="proposal-meta"><span>PROPOSITION OPENAI</span><strong>{Math.round((goalProposal.confidence ?? 0) * 100)}% de confiance</strong></div>
                    <label>Objectif à valider<textarea name="goal" required minLength={5} rows={3} value={approvedGoal} onChange={(event) => setApprovedGoal(event.target.value)} /></label>
                    {goalProposal.summary ? <p>{goalProposal.summary}</p> : null}
                    {goalProposal.observed_actions?.length ? <ol>{goalProposal.observed_actions.map((action) => <li key={action}>{action}</li>)}</ol> : null}
                    {goalProposal.uncertainties?.length ? <div className="proposal-warning">À vérifier : {goalProposal.uncertainties.join(" · ")}</div> : null}
                    <button className="text-action" type="button" onClick={() => { setGoalProposal(null); setApprovedGoal(""); setPhase("idle"); setGenerationError(null); }}>Relancer l’analyse de l’objectif</button>
                  </div>
                ) : <div className="goal-placeholder"><span>✦</span><p>L’objectif sera rempli automatiquement après l’analyse visuelle de la vidéo.</p></div>}
                <div className="form-grid"><label>Application<input name="app_name" defaultValue="Mimex Demo CRM" required /></label><label>URL de départ<input name="start_url" type="url" defaultValue={window.location.origin} required /></label></div>
                <button className="primary-button generate-button" type="submit" disabled={phase === "analyzing_goal" || phase === "generating"}>
                  {phase === "analyzing_goal" ? <><span className="spinner" /> OpenAI analyse la vidéo…</> : phase === "generating" ? <><span className="spinner" /> Génération du skill…</> : goalProposal ? <>✓ Valider l’objectif et générer le skill</> : <>✦ Analyser la vidéo et proposer un objectif</>}
                </button>
                {phase === "analyzing_goal" && uploadProgress > 0 && uploadProgress < 100 ? <p className="privacy-note">Upload Netlify : {uploadProgress}%</p> : null}
                <p className="privacy-note">Les fragments vidéo sont supprimés après la génération. Le skill reste dans Netlify Blobs.</p>
              </form>

              <aside className="analysis-panel panel">
                <div className="panel-heading"><div><span className="eyebrow">PIPELINE D’ANALYSE</span><h2>Du geste au skill</h2></div><span className={`status-pill status-${phase}`}>{phase === "analyzing_goal" ? "Analyse" : phase === "awaiting_validation" ? "À valider" : phase === "generating" ? "Compilation" : phase === "done" ? "Terminé" : phase === "error" ? "Erreur" : "En attente"}</span></div>
                <ol className="pipeline-list">
                  <li className={phase !== "idle" ? "active" : ""}><span>1</span><div><strong>Préparer la vidéo</strong><small>Extraction des frames et de l’audio</small></div></li>
                  <li className={phase !== "idle" && phase !== "error" ? "active" : ""}><span>2</span><div><strong>Proposer l’objectif</strong><small>Compréhension visuelle par OpenAI</small></div></li>
                  <li className={phase === "awaiting_validation" || phase === "generating" || phase === "done" ? "active" : ""}><span>3</span><div><strong>Validation humaine</strong><small>Confirmation ou correction de l’objectif</small></div></li>
                  <li className={phase === "generating" || phase === "done" ? "active" : ""}><span>4</span><div><strong>Compiler le skill</strong><small>Étapes, paramètres, sécurité et preuves</small></div></li>
                </ol>
                {generationError ? <div className="result-message error-message"><strong>Traitement interrompu</strong><p>{generationError}</p><small>Vérifie la variable OPENAI_API_KEY et les journaux Netlify Functions, puis réessaie.</small></div> : null}
                {result ? (
                  <div className={`skill-result ${result.status === "ready" ? "ready" : "warning"}`}>
                    <div className="result-heading"><span>{result.status === "ready" ? "✓" : "!"}</span><div><strong>{result.status === "ready" ? "Skill prêt à être utilisé" : "Vérification nécessaire"}</strong><small>{result.skill_name ?? "Analyse terminée"}</small></div></div>
                    <div className="result-metrics"><div><span>Confiance</span><strong>{Math.round((result.confidence ?? 0) * 100)}%</strong></div><div><span>Étapes détectées</span><strong>{result.evidence?.steps?.length ?? 0}</strong></div></div>
                    {result.skill_path ? <p className="skill-path">{result.skill_path}</p> : null}
                    {result.open_questions?.length ? <ul>{result.open_questions.map((question) => <li key={question}>{question}</li>)}</ul> : null}
                    {result.skill_markdown ? <>
                      <pre className="skill-preview">{result.skill_markdown}</pre>
                      <div className="result-actions">
                        <button className="secondary-button download-button" type="button" onClick={downloadSkill}>↓ Télécharger SKILL.md</button>
                        <button className="primary-button codex-button" type="button" onClick={useWithCodex}>✦ Utiliser avec Codex</button>
                      </div>
                      {codexPrompt ? <div className="codex-handoff" aria-live="polite">
                        <div><strong>{codexCopyState === "copied" ? "Instruction copiée" : "Instruction prête pour Codex"}</strong><span>Télécharge aussi le SKILL.md pour le joindre à Codex.</span></div>
                        <code>{codexPrompt}</code>
                        <small>{codexCopyState === "copied" ? "Colle maintenant cette instruction dans Codex." : "Copie cette instruction et colle-la dans Codex."}</small>
                      </div> : null}
                    </> : null}
                  </div>
                ) : phase === "idle" ? <div className="empty-result"><span>◇</span><p>Le fichier <strong>SKILL.md</strong> apparaîtra ici après l’analyse.</p></div> : null}
              </aside>
            </section>
          </>
        ) : view === "library" ? <Library refreshKey={libraryRefreshKey} /> : <Compose />}
      </main>

      {isFormOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsFormOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-customer-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">NOUVELLE FICHE</span><h2 id="new-customer-title">Créer un client</h2><p>Renseignez les informations nécessaires au suivi.</p></div><button className="icon-button" type="button" aria-label="Fermer" onClick={() => setIsFormOpen(false)}>×</button></div><form onSubmit={createCustomer}><label>Nom complet<input name="customer_name" type="text" required autoFocus placeholder="ex. Ada Lovelace" /></label><label>Entreprise<input name="company_name" type="text" required placeholder="ex. Analytical Engines" /></label><label>Priorité<select name="priority" defaultValue="Normale" required><option>Basse</option><option>Normale</option><option>Haute</option></select></label><div className="form-actions"><button className="secondary-button" type="button" onClick={() => setIsFormOpen(false)}>Annuler</button><button className="primary-button" type="submit">Enregistrer</button></div></form></section></div> : null}
    </div>
  );
}
