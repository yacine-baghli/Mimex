import { basename, resolve } from "node:path";
import OpenAI from "openai";
import { prepareVideo } from "@mimex/video-pipeline";
import { createEvidenceManifest } from "./render.js";
import { lintSkillSpec, type SkillLintResult } from "./lint.js";
import { createMockSkillSpec } from "./mock.js";
import {
  analyzeVideoWithOpenAI,
  proposeVideoGoalWithOpenAI,
  transcribeVideoAudio,
  type VideoGoalProposal,
} from "./openai.js";
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

export type ProposeGoalResult = {
  proposal: VideoGoalProposal;
  durationMs: number;
  frameCount: number;
  hasNarration: boolean;
};

export async function proposeGoalFromVideo(videoPath: string): Promise<ProposeGoalResult> {
  const prepared = await prepareVideo({
    videoPath: resolve(videoPath),
    keepArtifacts: process.env.MIMEX_KEEP_ARTIFACTS === "1",
  });

  try {
    const useMock = process.env.MIMEX_MOCK === "1";
    const client = useMock ? null : new OpenAI();
    const transcript = client ? await transcribeVideoAudio(client, prepared.audioPath) : [];
    const proposal = client
      ? await proposeVideoGoalWithOpenAI(client, prepared, transcript)
      : {
          goal: "Créer une nouvelle fiche client dans le CRM",
          summary: "Ouvrir le formulaire client, renseigner les informations puis enregistrer la fiche.",
          observedActions: [
            "Ouvrir le formulaire de création",
            "Renseigner les informations du client",
            "Enregistrer la fiche",
          ],
          uncertainties: [],
          confidence: 0.95,
        };

    return {
      proposal,
      durationMs: prepared.durationMs,
      frameCount: prepared.frames.length,
      hasNarration: transcript.length > 0,
    };
  } finally {
    await prepared.cleanup();
  }
}

export async function compileSkillFromVideo(
  options: CompileSkillOptions,
): Promise<CompileSkillResult> {
  const target = SkillTargetSchema.parse(options.target);
  const prepared = await prepareVideo({
    videoPath: resolve(options.videoPath),
    keepArtifacts: process.env.MIMEX_KEEP_ARTIFACTS === "1",
  });

  try {
    const useMock = options.mock ?? process.env.MIMEX_MOCK === "1";
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
