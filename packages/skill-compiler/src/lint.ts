import type { GeneratedSkillSpec } from "./schema.js";

export type SkillLintResult = {
  errors: string[];
  warnings: string[];
  readyToReplay: boolean;
};

export function lintSkillSpec(spec: GeneratedSkillSpec): SkillLintResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (spec.steps.length === 0) errors.push("Le skill ne contient aucune étape.");
  if (spec.successCriteria.length === 0) {
    errors.push("Le skill ne contient aucun critère de réussite.");
  }
  if (spec.openQuestions.length > 0) {
    errors.push("Des questions critiques restent ouvertes.");
  }
  if (spec.safetyConcerns.length > 0) {
    errors.push("Des risques de sécurité ont été détectés.");
  }
  if (spec.confidence < 0.7) {
    errors.push("La confiance globale est inférieure au seuil de 0,70.");
  }

  const ids = new Set<string>();
  for (const step of spec.steps) {
    if (ids.has(step.id)) errors.push(`Identifiant d'étape dupliqué : ${step.id}.`);
    ids.add(step.id);
    if (step.source.endMs < step.source.startMs) {
      errors.push(`Timecodes inversés pour ${step.id}.`);
    }
    if (step.confidence === "low") {
      errors.push(`L'étape ${step.id} a une confiance faible.`);
    } else if (step.confidence === "medium") {
      warnings.push(`L'étape ${step.id} mérite une vérification humaine.`);
    }
  }

  const inputKeys = new Set<string>();
  for (const input of spec.inputs) {
    if (inputKeys.has(input.key)) errors.push(`Entrée dupliquée : ${input.key}.`);
    inputKeys.add(input.key);
  }

  return {
    errors,
    warnings,
    readyToReplay: errors.length === 0 && spec.readyToReplay,
  };
}
