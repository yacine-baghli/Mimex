import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installSkill } from "./install.js";
import { lintSkillSpec } from "./lint.js";
import { createMockSkillSpec } from "./mock.js";
import { normalizeGeneratedSkillSpec } from "./openai.js";
import { createEvidenceManifest, renderSkillMarkdown, slugifySkillName } from "./render.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("skill renderer", () => {
  it("produces a valid Codex frontmatter with generalized inputs", () => {
    const spec = createMockSkillSpec("Créer une fiche client", {
      kind: "browser",
      appName: "Mimex Demo CRM",
      startUrl: "http://localhost:3000",
    });

    const markdown = renderSkillMarkdown(spec, "create-customer");
    expect(markdown).toContain("---\nname: create-customer\ndescription:");
    expect(markdown).toContain("`{{customer_name}}`");
    expect(markdown).toContain("## Critères de réussite");
    expect(markdown).not.toContain("Ada Lovelace");
  });

  it("normalizes names to safe, verb-led folder slugs", () => {
    expect(slugifySkillName("Créer une Fiche Client !")).toBe("creer-une-fiche-client");
  });

  it("installs without overwriting an existing skill", async () => {
    const root = await mkdtemp(join(tmpdir(), "mimex-skill-test-"));
    temporaryDirectories.push(root);
    const spec = createMockSkillSpec("Créer une fiche client", {
      kind: "browser",
      appName: "Mimex Demo CRM",
      startUrl: "http://localhost:3000",
    });
    const evidence = createEvidenceManifest(spec, "demo.mp4", 8000, []);

    const first = await installSkill(spec, evidence, root);
    const second = await installSkill(spec, evidence, root);

    expect(first.name).toBe("create-customer");
    expect(second.name).toBe("create-customer-2");
    expect(await readFile(first.skillPath, "utf8")).toContain("name: create-customer");
  });
});

describe("skill lint", () => {
  it("accepts a complete replayable skill", () => {
    const spec = createMockSkillSpec("Créer une fiche client", {
      kind: "browser",
      appName: "Mimex Demo CRM",
      startUrl: "http://localhost:3000",
    });
    expect(lintSkillSpec(spec)).toMatchObject({ errors: [], readyToReplay: true });
  });

  it("blocks a skill with open questions", () => {
    const spec = createMockSkillSpec("Créer une fiche client", {
      kind: "browser",
      appName: "Mimex Demo CRM",
      startUrl: "http://localhost:3000",
    });
    spec.openQuestions = ["Quel champ correspond à la priorité ?"];
    expect(lintSkillSpec(spec).readyToReplay).toBe(false);
  });

  it("does not block when unseen dropdown options are the only uncertainty", () => {
    const spec = createMockSkillSpec("Créer une fiche client", {
      kind: "browser",
      appName: "Mimex Demo CRM",
      startUrl: "http://localhost:3000",
    });
    spec.readyToReplay = false;
    spec.openQuestions = [
      "La liste Priorité contient-elle exactement les valeurs visibles ou d’autres options existent-elles ?",
    ];

    const normalized = normalizeGeneratedSkillSpec(spec);
    expect(normalized.openQuestions).toEqual([]);
    expect(normalized.readyToReplay).toBe(true);
  });
});
