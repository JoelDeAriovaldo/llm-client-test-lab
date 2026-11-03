import OpenAI from "openai";
import type { connections, ModelSettings } from "@/lib/db/schema";

type Connection = typeof connections.$inferSelect;

export type ModelRequest = {
  connection: Pick<Connection, "baseUrl" | "apiKeyEnvVar" | "locality">;
  model: string;
  settings: ModelSettings;
  prompt: string;
  jsonSchema: Record<string, unknown> | null;
};

export type ModelReply = {
  rawOutput: string;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  providerCostUsd: number | null;
  latencyMs: number;
};

export type ModelCaller = (req: ModelRequest) => Promise<ModelReply>;

function apiKey(connection: ModelRequest["connection"]) {
  if (!connection.apiKeyEnvVar) return "not-needed";
  const key = process.env[connection.apiKeyEnvVar];
  if (!key) {
    throw Object.assign(new Error(`${connection.apiKeyEnvVar} isn't set. Add it to .env.local, then restart.`), {
      status: 401,
    });
  }
  return key;
}

function clientFor(connection: ModelRequest["connection"]) {
  // Retries stay with the worker, so every attempt is counted.
  return new OpenAI({ baseURL: connection.baseUrl, apiKey: apiKey(connection), maxRetries: 0, timeout: 300_000 });
}

export const callModel: ModelCaller = async ({ connection, model, settings, prompt, jsonSchema }) => {
  const client = clientFor(connection);
  const started = Date.now();
  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    ...(jsonSchema
      ? { response_format: { type: "json_schema", json_schema: { name: "marks", schema: jsonSchema } } }
      : {}),
  });
  const usage = completion.usage as (typeof completion.usage & { cost?: number }) | undefined;
  return {
    rawOutput: completion.choices[0]?.message?.content ?? "",
    finishReason: completion.choices[0]?.finish_reason ?? null,
    inputTokens: usage?.prompt_tokens ?? null,
    outputTokens: usage?.completion_tokens ?? null,
    providerCostUsd: typeof usage?.cost === "number" ? usage.cost : null,
    latencyMs: Date.now() - started,
  };
};

export type ListedModel = { id: string; inputPricePerMillion: number | null; outputPricePerMillion: number | null };

/** OpenRouter also reports per-token prices here; other endpoints give ids only. */
export async function listModels(connection: ModelRequest["connection"]): Promise<ListedModel[]> {
  const client = clientFor(connection);
  const page = await client.models.list();
  return page.data.map((m) => {
    const pricing = (m as unknown as { pricing?: { prompt?: string; completion?: string } }).pricing;
    const perMillion = (v?: string) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) * 1_000_000 : null);
    return {
      id: m.id,
      inputPricePerMillion: perMillion(pricing?.prompt),
      outputPricePerMillion: perMillion(pricing?.completion),
    };
  });
}
