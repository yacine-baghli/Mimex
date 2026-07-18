import { z } from "zod";
import {
  APP_ORIGIN,
  GINSE_APP_ID,
  InputSchema,
  authenticate,
  canonicalJson,
  digest,
  json,
  operationKey,
  operationStore,
  readOperation,
  statusUrl,
  type Mimex2Input,
  type OperationRecord,
} from "../lib/mimex2.js";

async function triggerWorker(providerOperationId: string) {
  const response = await fetch(`${APP_ORIGIN}/.netlify/functions/video-worker-background`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider_operation_id: providerOperationId }),
  });
  if (response.status !== 202) {
    throw new Error(`The video worker could not start (HTTP ${response.status}).`);
  }
}

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    await authenticate(request);
  } catch {
    return json({ error: "Invalid Ginse bearer token." }, 401);
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    return json({ error: "A valid Idempotency-Key header is required." }, 400);
  }

  let input: Mimex2Input;
  try {
    const body = await request.json() as unknown;
    const transportedInput = body && typeof body === "object" && "input" in body
      ? (body as { input: unknown }).input
      : body;
    input = InputSchema.parse(transportedInput);
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")
      : "The request body must be valid JSON.";
    return json({ error: message }, 400);
  }

  const fingerprint = digest(canonicalJson(input));
  const providerOperationId = `mimex2_${digest(`${GINSE_APP_ID}:${idempotencyKey}`).slice(0, 32)}`;
  const key = operationKey(providerOperationId);
  const now = new Date().toISOString();
  const claim: OperationRecord = {
    fingerprint,
    providerOperationId,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    input,
  };

  try {
    const claimResult = await operationStore().set(key, JSON.stringify(claim), { onlyIfNew: true });
    const replayed = !claimResult.modified;

    if (replayed) {
      const existing = await readOperation(providerOperationId);
      if (!existing) return json({ error: "Could not recover the idempotent operation." }, 503);
      if (existing.record.fingerprint !== fingerprint) {
        return json({ error: "Idempotency-Key was already used with different input." }, 409);
      }
      if (existing.record.status === "succeeded" && existing.record.output) {
        return json({
          status: "succeeded",
          provider_operation_id: providerOperationId,
          replayed: true,
          output: existing.record.output,
        });
      }
      if (existing.record.status === "failed") {
        return json({
          error: existing.record.error ?? "Video compilation failed.",
          provider_operation_id: providerOperationId,
          replayed: true,
        }, 500);
      }
      return json({
        status: "pending",
        provider_operation_id: providerOperationId,
        replayed: true,
        status_url: statusUrl(providerOperationId),
      }, 202);
    }

    try {
      await triggerWorker(providerOperationId);
    } catch (error) {
      const failed: OperationRecord = {
        ...claim,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "The video worker could not start.",
      };
      if (claimResult.etag) {
        await operationStore().set(key, JSON.stringify(failed), { onlyIfMatch: claimResult.etag });
      }
      throw error;
    }

    return json({
      status: "pending",
      provider_operation_id: providerOperationId,
      replayed: false,
      status_url: statusUrl(providerOperationId),
    }, 202);
  } catch (error) {
    console.error("Mimex2 Ginse run failed", error);
    return json({ error: error instanceof Error ? error.message : "Run failed." }, 500);
  }
};

export const config = {
  path: "/run",
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ["ip"],
  },
};
