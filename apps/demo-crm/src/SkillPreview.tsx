import { useEffect, useRef, useState } from "react";
import { codexHandoff, downloadMarkdown, type MimexRun } from "./mimex-api";

export function SkillPreview({ output, title, onClose }: {
  output: NonNullable<MimexRun["output"]>;
  title: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [feedback, setFeedback] = useState("");
  const [prompt, setPrompt] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(output.skillMarkdown);
      setFeedback("Markdown copié.");
    } catch {
      setFeedback("Copie indisponible. Sélectionne le Markdown dans l’aperçu.");
    }
  }

  async function copyHandoff() {
    const instruction = codexHandoff(output.skillName);
    setPrompt(instruction);
    try {
      await navigator.clipboard.writeText(instruction);
      setFeedback("Instruction pour Codex copiée.");
    } catch {
      setFeedback("Copie indisponible. Sélectionne l’instruction ci-dessous.");
    }
  }

  return (
    <dialog className="modal skill-dialog" ref={dialogRef} onClose={onClose} aria-labelledby="skill-preview-title">
      <header className="modal-heading">
        <div>
          <h2 id="skill-preview-title">{title}</h2>
          <p>{output.description}</p>
        </div>
        <button className="icon-button" type="button" aria-label="Fermer l’aperçu" onClick={() => dialogRef.current?.close()}>×</button>
      </header>
      <div className="skill-dialog-content">
        <pre className="skill-preview" tabIndex={0} aria-label="Contenu Markdown">{output.skillMarkdown}</pre>
        <div className="result-actions">
          <button className="secondary-button" type="button" onClick={() => downloadMarkdown(output.skillMarkdown, output.skillName)}>Télécharger</button>
          <button className="secondary-button" type="button" onClick={() => void copyMarkdown()}>Copier le Markdown</button>
          <button className="primary-button" type="button" onClick={() => void copyHandoff()}>Utiliser avec Codex</button>
        </div>
        <div className="skill-copy-feedback" role="status">{feedback}</div>
        {prompt ? <div className="codex-handoff"><code>{prompt}</code></div> : null}
      </div>
    </dialog>
  );
}
