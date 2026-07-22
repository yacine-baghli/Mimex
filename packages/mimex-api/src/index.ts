#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createSkillFromVideo } from "./tool.js";

const server = new McpServer({
  name: "mimex",
  version: "0.1.0",
});

server.registerTool(
  "create_skill_from_video",
  {
    title: "Create a Codex skill from a video",
    description:
      "Compile une vidéo de démonstration située dans le workspace en skill Codex sous .agents/skills. Utiliser avant de tenter de reproduire l'action montrée.",
    inputSchema: {
      video_path: z
        .string()
        .min(1)
        .describe("Chemin de la vidéo, relatif au workspace Codex."),
      goal: z.string().min(3).describe("Objectif métier montré dans la vidéo."),
      target: z
        .object({
          kind: z.enum(["browser", "desktop"]),
          app_name: z.string().min(1),
          start_url: z.string().url().optional(),
        })
        .strict(),
      output_dir: z
        .string()
        .default(".agents/skills")
        .describe("Dossier de sortie sous .agents/skills."),
      language: z.literal("fr").default("fr"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (input) => {
    const result = await createSkillFromVideo({
      video_path: input.video_path,
      goal: input.goal,
      target: {
        kind: input.target.kind,
        app_name: input.target.app_name,
        ...(input.target.start_url ? { start_url: input.target.start_url } : {}),
      },
      output_dir: input.output_dir,
      language: input.language,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
      isError: result.status === "failed",
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Mimex MCP server running on stdio");
}

process.on("SIGINT", () => {
  void server.close().finally(() => process.exit(0));
});

main().catch((error) => {
  console.error("Mimex MCP fatal error:", error);
  process.exit(1);
});
