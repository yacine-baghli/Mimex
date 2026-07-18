import { json, readOperation } from "../lib/mimex2.js";

export default async (request: Request) => {
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
  const providerOperationId = new URL(request.url).pathname.split("/").filter(Boolean).at(-1) ?? "";
  const operation = await readOperation(providerOperationId);
  if (!operation) return json({ error: "Operation not found." }, 404);

  if (operation.record.status === "succeeded" && operation.record.output) {
    return json({
      status: "succeeded",
      provider_operation_id: providerOperationId,
      output: operation.record.output,
    });
  }
  if (operation.record.status === "failed") {
    return json({
      status: "failed",
      provider_operation_id: providerOperationId,
      error: operation.record.error ?? "Video compilation failed.",
    });
  }
  return json({
    status: "pending",
    provider_operation_id: providerOperationId,
  });
};

export const config = {
  path: "/run/status/:operationId",
};
