import { z } from "zod";

export const SkillTargetSchema = z
  .object({
    kind: z.enum(["browser", "desktop"]),
    appName: z.string().min(1),
    startUrl: z.string(),
  })
  .strict();

export const SkillInputSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/u),
    label: z.string().min(1),
    description: z.string().min(1),
    required: z.boolean(),
    example: z.string(),
    allowedValues: z.array(z.string()),
  })
  .strict();

export const SkillStepSchema = z
  .object({
    id: z.string().regex(/^step_[1-9][0-9]*$/u),
    title: z.string().min(1),
    instruction: z.string().min(1),
    expectedResult: z.string().min(1),
    source: z
      .object({
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().nonnegative(),
        frameIndex: z.number().int().nonnegative(),
        transcriptExcerpt: z.string(),
      })
      .strict(),
    confidence: z.enum(["high", "medium", "low"]),
    uncertainty: z.string(),
  })
  .strict();

export const GeneratedSkillSpecSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    goal: z.string().min(1),
    target: SkillTargetSchema,
    inputs: z.array(SkillInputSchema),
    steps: z.array(SkillStepSchema),
    successCriteria: z.array(z.string().min(1)),
    openQuestions: z.array(z.string().min(1)),
    safetyConcerns: z.array(z.string().min(1)),
    confidence: z.number().min(0).max(1),
    readyToReplay: z.boolean(),
  })
  .strict();

export type SkillTarget = z.infer<typeof SkillTargetSchema>;
export type GeneratedSkillSpec = z.infer<typeof GeneratedSkillSpecSchema>;

export type EvidenceManifest = {
  sourceVideo: string;
  generatedAt: string;
  durationMs: number;
  transcript: Array<{ startMs: number; endMs: number; text: string }>;
  steps: Array<{
    id: string;
    startMs: number;
    endMs: number;
    frameIndex: number;
    transcriptExcerpt: string;
    confidence: "high" | "medium" | "low";
  }>;
};
