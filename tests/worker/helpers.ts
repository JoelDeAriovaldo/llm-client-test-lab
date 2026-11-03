import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrateDb, openDb, type Db } from "@/lib/db";
import { calls, connections, experimentModels, experiments, harnessVersions } from "@/lib/db/schema";
import { createExperiment } from "@/lib/experiments/create";
import { seedStarterHarnesses } from "@/lib/harness/starters";
import type { ModelCaller, ModelRequest } from "@/lib/llm/client";
import { MarkingLabClient } from "@/lib/marking-lab/client";
import { Worker } from "@/worker/loop";
import { FakeMarkingLab } from "../fakes/marking-lab";

export function tempDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-test-"));
  const db = openDb(path.join(dir, "test.db"));
  migrateDb(db);
  seedStarterHarnesses(db);
  return db;
}

export function goodReply(req: ModelRequest) {
  const instructions = req.prompt.slice(req.prompt.lastIndexOf("Reply with only a JSON object"));
  const shape = JSON.parse(instructions.split("\n")[1]);
  return JSON.stringify({ lines: shape.lines, reason: "ok" });
}

export const reply = (rawOutput: string, overrides: Partial<Awaited<ReturnType<ModelCaller>>> = {}) => ({
  rawOutput,
  finishReason: "stop",
  inputTokens: 100,
  outputTokens: 20,
  providerCostUsd: null,
  latencyMs: 5,
  ...overrides,
});

export const httpError = (status: number, message = "boom") => Object.assign(new Error(message), { status });

export async function setup(options: { scheme?: boolean; models?: string[]; repeats?: number; spendLimitUsd?: number; locality?: "local" | "cloud" } = {}) {
  const db = tempDb();
  const fake = await new FakeMarkingLab().start();
  const connection = db
    .insert(connections)
    .values({ name: "test", baseUrl: "http://unused", locality: options.locality ?? "cloud", concurrency: 3 })
    .returning()
    .get();
  const versions = db.select().from(harnessVersions).all();
  const version = versions.find((v) => v.usedMarkingScheme === (options.scheme ?? true))!;
  const experimentId = createExperiment(db, {
    name: "test",
    harnessVersionId: version.id,
    repeats: options.repeats ?? 1,
    allowRealOnCloud: false,
    spendLimitUsd: options.spendLimitUsd ?? null,
    models: (options.models ?? ["model-a"]).map((modelName) => ({
      connectionId: connection.id,
      modelName,
      settings: { temperature: 0, maxTokens: 1000 },
      inputPricePerMillion: 1,
      outputPricePerMillion: 1,
    })),
  });
  const makeWorker = (caller: ModelCaller) =>
    new Worker({
      db,
      lab: () => new MarkingLabClient(fake.url, "msk_test"),
      caller,
      codeState: () => ({ commit: "abc1234", dirty: false }),
      sleep: async () => undefined,
      retryBaseMs: 1,
      batchSize: 2,
    });
  const experiment = () => db.select().from(experiments).where(eq(experiments.id, experimentId)).get()!;
  const models = () => db.select().from(experimentModels).where(eq(experimentModels.experimentId, experimentId)).all();
  const allCalls = () => db.select().from(calls).all();
  return { db, fake, experimentId, makeWorker, experiment, models, allCalls };
}
