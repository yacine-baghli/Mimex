import { relative, resolve } from "node:path";
import { compileSkillFromVideo, type SkillTarget } from "@ginse/skill-compiler";
import { resolveSkillOutputDirectory, resolveWorkspaceVideoPath } from "./paths.js";

export type CreateSkillInput = {
  video_path: string;
  goal: string;
  target: {
    kind: "browser" | "desktop";
    app_name: string;
    start_url?: string;
  };
  output_dir?: string;
  language?: "fr";
};

export type CreateSkillOutput = {
  status: "ready" | "needs_clarification" | "unsafe" | "failed";
  skill_name: string | null;
  skill_path: string | null;
  confidence: number;
  ready_to_replay: boolean;
  open_questions: string[];
  safety_concerns: string[];
  warnings: string[];
  evidence_manifest: string | null;
};

export async function createSkillFromVideo(
  input: CreateSkillInput,
  workspaceRoot = process.env.GINSE_WORKSPACE_ROOT ?? process.cwd(),
): Promise<CreateSkillOutput> {
  try {
    const canonicalWorkspace = resolve(workspaceRoot);
    const videoPath = await resolveWorkspaceVideoPath(canonicalWorkspace, input.video_path);
    const outputDirectory = await resolveSkillOutputDirectory(
      canonicalWorkspace,
      input.output_dir ?? ".agents/skills",
    );
    const target: SkillTarget = {
      kind: input.target.kind,
      appName: input.target.app_name,
      startUrl: input.target.start_url ?? "",
    };
    const result = await compileSkillFromVideo({
      videoPath,
      goal: input.goal,
      target,
      outputDirectory,
    });

    if (result.spec.safetyConcerns.length > 0) {
      return {
        status: "unsafe",
        skill_name: null,
        skill_path: null,
        confidence: result.spec.confidence,
        ready_to_replay: false,
        open_questions: result.spec.openQuestions,
        safety_concerns: result.spec.safetyConcerns,
        warnings: result.lint.warnings,
        evidence_manifest: null,
      };
    }

    if (!result.installed || !result.lint.readyToReplay) {
      return {
        status: "needs_clarification",
        skill_name: null,
        skill_path: null,
        confidence: result.spec.confidence,
        ready_to_replay: false,
        open_questions: [
          ...result.spec.openQuestions,
          ...result.lint.errors.filter(
            (error) => !error.toLocaleLowerCase("fr").includes("question"),
          ),
        ],
        safety_concerns: [],
        warnings: result.lint.warnings,
        evidence_manifest: null,
      };
    }

    return {
      status: "ready",
      skill_name: result.installed.name,
      skill_path: relative(canonicalWorkspace, result.installed.skillPath).replaceAll("\\", "/"),
      confidence: result.spec.confidence,
      ready_to_replay: true,
      open_questions: [],
      safety_concerns: [],
      warnings: result.lint.warnings,
      evidence_manifest: relative(canonicalWorkspace, result.installed.evidencePath).replaceAll(
        "\\",
        "/",
      ),
    };
  } catch (error) {
    return {
      status: "failed",
      skill_name: null,
      skill_path: null,
      confidence: 0,
      ready_to_replay: false,
      open_questions: [error instanceof Error ? error.message : String(error)],
      safety_concerns: [],
      warnings: [],
      evidence_manifest: null,
    };
  }
}
