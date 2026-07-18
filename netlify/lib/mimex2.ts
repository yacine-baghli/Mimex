import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

export const GINSE_APP_ID = "04cbb992-55b2-4770-9606-1b4e542a19df";
export const APP_ORIGIN = "https://mimex-demo-crm.netlify.app";
const GINSE_JWKS = createRemoteJWKSet(new URL("https://api.ginse.ai/.well-known/jwks.json"));

export const InputSchema = z.object({
  video_url: z.string().url().max(1000).refine((value) => value.startsWith("https://"), {
    message: "video_url must use HTTPS",
  }),
  goal: z.string().trim().min(3).max(300).optional(),
  app_name: z.string().trim().min(2).max(100).optional(),
  start_url: z.string().url().max(500).refine((value) => value.startsWith("https://"), {
    message: "start_url must use HTTPS",
  }).optional(),
}).strict();

export const OutputSchema = z.object({
  status: z.literal("ready"),
  skill_name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  steps_count: z.number().int().min(1).max(30),
  files: z.object({
    skill_md: z.string().min(50),
    openai_yaml: z.string().min(20),
    evidence_json: z.string().min(20),
  }).strict(),
}).strict();

export type Mimex2Input = z.infer<typeof InputSchema>;
export type Mimex2Output = z.infer<typeof OutputSchema>;

export type OperationRecord = {
  fingerprint: string;
  providerOperationId: string;
  status: "pending" | "succeeded" | "failed";
  createdAt: string;
  updatedAt: string;
  input: Mimex2Input;
  output?: Mimex2Output;
  error?: string;
};

export const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function operationKey(providerOperationId: string) {
  return `operation-${providerOperationId}`;
}

export function statusUrl(providerOperationId: string) {
  return `${APP_ORIGIN}/run/status/${providerOperationId}`;
}

export function operationStore() {
  return getStore({ name: "ginse-mimex2-runs", consistency: "strong" });
}

export async function readOperation(providerOperationId: string) {
  if (!/^mimex2_[a-f0-9]{32}$/u.test(providerOperationId)) return null;
  const result = await operationStore().getWithMetadata(operationKey(providerOperationId), {
    type: "text",
    consistency: "strong",
  });
  if (!result) return null;
  return {
    record: JSON.parse(result.data) as OperationRecord,
    etag: result.etag,
  };
}

export async function authenticate(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/iu);
  if (!match) throw new Error("Missing Ginse bearer token.");
  await jwtVerify(match[1], GINSE_JWKS, {
    algorithms: ["EdDSA"],
    requiredClaims: ["iat", "exp"],
  });
}
