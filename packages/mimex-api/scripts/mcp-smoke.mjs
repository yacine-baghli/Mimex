import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: {
    ...process.env,
    MIMEX_MOCK: "1",
  },
  stderr: "pipe",
});

const client = new Client({ name: "mimex-smoke", version: "0.1.0" });

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const tool = tools.find((candidate) => candidate.name === "create_skill_from_video");
  if (!tool) {
    throw new Error("L'outil create_skill_from_video est absent du serveur MCP.");
  }
  process.stdout.write(`MCP OK: ${tool.name}\n`);
} finally {
  await client.close();
}
