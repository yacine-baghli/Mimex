import { basename, resolve } from "node:path";
import OpenAI from "openai";
import { prepareVideo } from "@ginse/video-pipeline";
import { createEvidenceManifest } from "./render.js";
import { lintSkillSpec, type SkillLintResult } from "./lint.js";
import { createMockSkillSpec } from "./mock.js";
import { analyzeVideoWithOpenAI, transcribeVideoAudio } from "./openai.js";
import { installSkill, type InstalledSkill } from "./install.js";
import { SkillTargetSchema, type GeneratedSkillSpec, type SkillTarget } from "./schema.js";

export * from "./schema.js";
export * from "./render.js";
export * from "./lint.js";
export * from "./install.js";

export type CompileSkillOptions = {
  videoPath: string;
  goal: string;
  target: SkillTarget;
  outputDirectory: string;
  mock?: boolean;
};

export type CompileSkillResult = {
  spec: GeneratedSkillSpec;
  lint: SkillLintResult;
  installed: InstalledSkill | null;
  durationMs: number;
};

export async function compileSkillFromVideo(
  options: CompileSkillOptions,
): Promise<CompileSkillResult> {
  const target = SkillTargetSchema.parse(options.target);
  const prepared = await prepareVideo({
    videoPath: resolve(options.videoPath),
    keepArtifacts: process.env.GINSE_KEEP_ARTIFACTS === "1",
  });

  try {
    const useMock = options.mock ?? process.env.GINSE_MOCK === "1";
    const client = useMock ? null : new OpenAI();
    const transcript = client ? await transcribeVideoAudio(client, prepared.audioPath) : [];
    const spec = client
      ? await analyzeVideoWithOpenAI(client, prepared, options.goal, target, transcript)
      : createMockSkillSpec(options.goal, target);
    const lint = lintSkillSpec(spec);
    const evidence = createEvidenceManifest(
      spec,
      basename(prepared.sourcePath),
      prepared.durationMs,
      transcript,
    );
    const installed = lint.readyToReplay
      ? await installSkill(spec, evidence, options.outputDirectory)
      : null;

    return {
      spec,
      lint,
      installed,
      durationMs: prepared.durationMs,
    };
  } finally {
    await prepared.cleanup();
  }
}
