import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callModel, listModels } from "@/lib/llm/client";
import { classifyFailure } from "@/lib/llm/errors";
import { FakeLlmEndpoint } from "../fakes/llm-endpoint";

let fake: FakeLlmEndpoint;
beforeEach(async () => {
  fake = await new FakeLlmEndpoint().start();
});
afterEach(() => fake.stop());

const request = (overrides = {}) => ({
  connection: { baseUrl: fake.url, apiKeyEnvVar: null, locality: "local" as const },
  model: "m",
  settings: { temperature: 0.5, maxTokens: 77 },
  prompt: "hello",
  jsonSchema: null,
  ...overrides,
});

// These run the real openai SDK over HTTP, so a change in its behaviour shows up here.
describe("callModel", () => {
  it("sends the settings and reads the reply, usage and provider cost", async () => {
    fake.script = () => ({ content: "hi", finishReason: "length", cost: 0.25 });
    const reply = await callModel(request());
    expect(reply).toMatchObject({ rawOutput: "hi", finishReason: "length", inputTokens: 120, outputTokens: 30, providerCostUsd: 0.25 });
    expect(fake.requests[0].body).toMatchObject({ temperature: 0.5, max_tokens: 77 });
    expect(fake.requests[0].body.response_format).toBeUndefined();
  });

  it("requests structured output when given a schema", async () => {
    fake.script = () => ({ content: "{}" });
    await callModel(request({ jsonSchema: { type: "object" } }));
    expect(fake.requests[0].body.response_format).toMatchObject({ type: "json_schema" });
  });

  it("doesn't retry by itself, so every attempt is counted", async () => {
    fake.script = () => ({ status: 503, error: "down" });
    await expect(callModel(request())).rejects.toBeDefined();
    expect(fake.requests).toHaveLength(1);
  });

  it.each([
    [429, "Slow down", "retryable"],
    [500, "down", "retryable"],
    [401, "bad key", "configuration"],
    [404, "no such model", "configuration"],
    [400, "response_format is not supported", "format_refused"],
  ])("classifies a real SDK error for %i", async (status, error, kind) => {
    fake.script = () => ({ status, error });
    const err = await callModel(request()).catch((e) => e);
    expect(classifyFailure(err).kind).toBe(kind);
  });

  it("reads Retry-After from a real SDK error", async () => {
    fake.script = () => ({ status: 429, error: "x", headers: { "retry-after": "3" } });
    const err = await callModel(request()).catch((e) => e);
    expect(classifyFailure(err)).toMatchObject({ retryAfterMs: 3000 });
  });

  it("classifies a dead endpoint as retryable", async () => {
    await fake.stop();
    const err = await callModel(request()).catch((e) => e);
    expect(classifyFailure(err).kind).toBe("retryable");
    fake = await new FakeLlmEndpoint().start();
  });

  it("explains a missing key, and stops rather than retries", async () => {
    const err = await callModel(request({ connection: { baseUrl: fake.url, apiKeyEnvVar: "NOT_SET_ANYWHERE", locality: "cloud" } })).catch((e) => e);
    expect(err.message).toContain("NOT_SET_ANYWHERE");
    expect(classifyFailure(err).kind).toBe("configuration");
  });
});

describe("listModels", () => {
  it("converts per-token prices to per-million", async () => {
    const models = await listModels({ baseUrl: fake.url, apiKeyEnvVar: null, locality: "local" });
    const steady = models.find((m) => m.id === "steady")!;
    expect(steady.inputPricePerMillion).toBeCloseTo(1);
    expect(steady.outputPricePerMillion).toBeCloseTo(2);
  });
});
