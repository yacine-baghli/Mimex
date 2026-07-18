import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export class PathPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathPolicyError";
  }
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

export async function resolveWorkspaceVideoPath(
  workspaceRoot: string,
  requestedPath: string,
): Promise<string> {
  const canonicalRoot = await realpath(resolve(workspaceRoot));
  const candidate = resolve(canonicalRoot, requestedPath);
  let canonicalCandidate: string;

  try {
    canonicalCandidate = await realpath(candidate);
  } catch {
    throw new PathPolicyError(`Vidéo introuvable dans le workspace : ${requestedPath}`);
  }

  if (!isWithin(canonicalRoot, canonicalCandidate)) {
    throw new PathPolicyError("La vidéo doit se trouver dans le workspace Codex.");
  }

  const candidateStats = await stat(canonicalCandidate);
  if (!candidateStats.isFile()) {
    throw new PathPolicyError("Le chemin vidéo ne désigne pas un fichier.");
  }

  return canonicalCandidate;
}

export async function resolveSkillOutputDirectory(
  workspaceRoot: string,
  requestedPath: string,
): Promise<string> {
  const canonicalRoot = await realpath(resolve(workspaceRoot));
  const candidate = resolve(canonicalRoot, requestedPath);
  if (!isWithin(canonicalRoot, candidate)) {
    throw new PathPolicyError("Le dossier de sortie doit se trouver dans le workspace Codex.");
  }

  const allowedRoot = resolve(canonicalRoot, ".agents", "skills");
  if (!isWithin(allowedRoot, candidate)) {
    throw new PathPolicyError("GINSE peut uniquement écrire sous .agents/skills.");
  }

  return candidate;
}
