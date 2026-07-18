import { randomUUID } from "node:crypto";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { EvidenceManifest, GeneratedSkillSpec } from "./schema.js";
import { renderOpenAiYaml, renderSkillMarkdown, slugifySkillName } from "./render.js";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function allocateSkillName(outputDirectory: string, requestedName: string): Promise<string> {
  const baseName = slugifySkillName(requestedName);
  let candidate = baseName;
  let suffix = 2;

  while (await exists(join(outputDirectory, candidate))) {
    const suffixText = `-${suffix}`;
    candidate = `${baseName.slice(0, 63 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }

  return candidate;
}

export type InstalledSkill = {
  name: string;
  directory: string;
  skillPath: string;
  evidencePath: string;
};

export async function installSkill(
  spec: GeneratedSkillSpec,
  evidence: EvidenceManifest,
  outputDirectory: string,
): Promise<InstalledSkill> {
  const absoluteOutput = resolve(outputDirectory);
  await mkdir(absoluteOutput, { recursive: true });
  const name = await allocateSkillName(absoluteOutput, spec.name);
  const finalDirectory = join(absoluteOutput, name);
  const stagingDirectory = join(absoluteOutput, `.${name}-${randomUUID()}.tmp`);
  const referencesDirectory = join(stagingDirectory, "references");
  const agentsDirectory = join(stagingDirectory, "agents");
  await mkdir(referencesDirectory, { recursive: true });
  await mkdir(agentsDirectory, { recursive: true });

  const skillPath = join(stagingDirectory, "SKILL.md");
  const evidencePath = join(referencesDirectory, "evidence.json");
  await writeFile(skillPath, renderSkillMarkdown(spec, name), "utf8");
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await writeFile(join(agentsDirectory, "openai.yaml"), renderOpenAiYaml(spec, name), "utf8");
  await rename(stagingDirectory, finalDirectory);

  return {
    name,
    directory: finalDirectory,
    skillPath: join(finalDirectory, "SKILL.md"),
    evidencePath: join(finalDirectory, "references", "evidence.json"),
  };
}
