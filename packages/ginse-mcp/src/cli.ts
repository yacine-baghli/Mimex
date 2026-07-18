#!/usr/bin/env node
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { createSkillFromVideo } from "./tool.js";

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const videoPath = readArgument("--video");
const goal = readArgument("--goal");
const startUrl = readArgument("--url") ?? "http://localhost:3000";
const appName = readArgument("--app") ?? "GINSE Demo CRM";
const workspaceRoot = process.env.GINSE_WORKSPACE_ROOT ?? fileURLToPath(new URL("../../..", import.meta.url));

if (!videoPath || !goal) {
  console.error(
    "Usage: pnpm ginse:compile -- --video <fichier> --goal <objectif> [--url <url>] [--app <nom>]",
  );
  process.exit(2);
}

const result = await createSkillFromVideo({
  video_path: videoPath,
  goal,
  target: {
    kind: "browser",
    app_name: appName,
    start_url: startUrl,
  },
}, workspaceRoot);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.status === "ready" ? 0 : 1;
