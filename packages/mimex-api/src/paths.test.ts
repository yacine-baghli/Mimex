import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSkillOutputDirectory, resolveWorkspaceVideoPath } from "./paths.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("workspace path policy", () => {
  it("accepts videos and skill output inside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "mimex-path-test-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "fixtures", "videos"), { recursive: true });
    await writeFile(join(root, "fixtures", "videos", "demo.mp4"), "demo");

    await expect(
      resolveWorkspaceVideoPath(root, "fixtures/videos/demo.mp4"),
    ).resolves.toContain("demo.mp4");
    await expect(resolveSkillOutputDirectory(root, ".agents/skills")).resolves.toContain(
      join(".agents", "skills"),
    );
  });

  it("rejects output outside .agents/skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "mimex-path-test-"));
    temporaryDirectories.push(root);
    await expect(resolveSkillOutputDirectory(root, "output")).rejects.toThrow(
      "uniquement écrire sous .agents/skills",
    );
  });
});
