import type { EvidenceManifest, GeneratedSkillSpec } from "./schema.js";

function yamlString(value: string): string {
  return JSON.stringify(value.replace(/\s+/gu, " ").trim());
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function inputPlaceholder(key: string): string {
  return `\`{{${key}}}\``;
}

export function slugifySkillName(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 63)
    .replace(/-+$/u, "");

  return normalized || "mimex-skill";
}

export function renderSkillMarkdown(spec: GeneratedSkillSpec, skillName: string): string {
  const inputRows = spec.inputs.length
    ? spec.inputs
        .map((input) => {
          const allowed = input.allowedValues.length ? input.allowedValues.join(", ") : "—";
          return `| ${inputPlaceholder(input.key)} | ${markdownCell(input.label)} | ${input.required ? "oui" : "non"} | ${markdownCell(allowed)} |`;
        })
        .join("\n")
    : "| — | Aucune entrée variable | — | — |";

  const steps = spec.steps
    .map(
      (step, index) =>
        `${index + 1}. ${step.instruction}\n   - Vérifier : ${step.expectedResult}`,
    )
    .join("\n");

  const successCriteria = spec.successCriteria.map((criterion) => `- ${criterion}`).join("\n");

  return `---
name: ${skillName}
description: ${yamlString(spec.description)}
---

# ${spec.name}

## Objectif

${spec.goal}

## Cible autorisée

- Application : ${spec.target.appName}
- Type : ${spec.target.kind === "browser" ? "navigateur" : "application desktop"}
${spec.target.startUrl ? `- URL de départ : ${spec.target.startUrl}` : ""}

Arrêter l’exécution si l’application ou le domaine observé ne correspond pas à cette cible.

## Entrées

| Clé | Libellé | Obligatoire | Valeurs autorisées |
|---|---|---|---|
${inputRows}

Demander toute entrée obligatoire absente avant de commencer. Ne jamais réutiliser silencieusement les valeurs d’exemple de la démonstration.

## Procédure

${steps}

Observer le résultat après chaque étape. Arrêter l’exécution si l’interface contredit l’instruction au lieu de cliquer à l’aveugle.

## Critères de réussite

${successCriteria}

Vérifier chaque critère dans l’interface et ne déclarer le succès qu’après confirmation visuelle.

## Sécurité et échec

- Ne saisir aucun secret absent des entrées fournies explicitement.
- Demander confirmation avant toute action irréversible ou sensible.
- En cas d’échec, capturer l’état visible, identifier l’étape bloquée et s’arrêter.
- Consulter [references/evidence.json](references/evidence.json) uniquement pour retrouver les passages sources de la vidéo.
`;
}

export function createEvidenceManifest(
  spec: GeneratedSkillSpec,
  sourceVideo: string,
  durationMs: number,
  transcript: EvidenceManifest["transcript"],
): EvidenceManifest {
  return {
    sourceVideo,
    generatedAt: new Date().toISOString(),
    durationMs,
    transcript,
    steps: spec.steps.map((step) => ({
      id: step.id,
      startMs: step.source.startMs,
      endMs: step.source.endMs,
      frameIndex: step.source.frameIndex,
      transcriptExcerpt: step.source.transcriptExcerpt,
      confidence: step.confidence,
    })),
  };
}

export function renderOpenAiYaml(spec: GeneratedSkillSpec, skillName: string): string {
  const rawDisplayName = spec.name.replaceAll("-", " ").replace(/[\r\n]+/gu, " ").trim();
  const displayName = `${rawDisplayName.charAt(0).toLocaleUpperCase("fr")}${rawDisplayName.slice(1)}`.slice(
    0,
    64,
  );
  const shortDescription = `Reproduire la procédure : ${spec.goal}`
    .replace(/[\r\n]+/gu, " ")
    .trim()
    .slice(0, 64);
  return `interface:
  display_name: ${yamlString(displayName)}
  short_description: ${yamlString(shortDescription)}
  default_prompt: ${yamlString(`Utilise $${skillName} avec les valeurs que je vais fournir.`)}
`;
}
