import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);

export const connections = sqliteTable("connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  baseUrl: text("base_url").notNull(),
  // The name of the environment variable, never the key itself.
  apiKeyEnvVar: text("api_key_env_var"),
  locality: text("locality", { enum: ["local", "cloud"] }).notNull(),
  concurrency: integer("concurrency").notNull(),
  createdAt: createdAt(),
});

export const harnesses = sqliteTable("harnesses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  createdAt: createdAt(),
});

export const harnessVersions = sqliteTable(
  "harness_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    harnessId: integer("harness_id")
      .notNull()
      .references(() => harnesses.id),
    version: integer("version").notNull(),
    promptTemplate: text("prompt_template").notNull(),
    usedMarkingScheme: integer("used_marking_scheme", { mode: "boolean" }).notNull(),
    parser: text("parser").notNull(),
    hash: text("hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("harness_versions_unique").on(t.harnessId, t.version)],
);

export const experimentStatuses = ["draft", "queued", "running", "paused", "finished"] as const;
export const trialStatuses = ["none", "requested", "running", "done", "failed"] as const;

export type AnswerFilter = { source: "synthetic" | null };

export const experiments = sqliteTable("experiments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  notes: text("notes"),
  harnessVersionId: integer("harness_version_id")
    .notNull()
    .references(() => harnessVersions.id),
  repeats: integer("repeats").notNull().default(1),
  allowRealOnCloud: integer("allow_real_on_cloud", { mode: "boolean" }).notNull().default(false),
  answerFilter: text("answer_filter", { mode: "json" }).$type<AnswerFilter>().notNull(),
  spendLimitUsd: real("spend_limit_usd"),
  datasetVersion: integer("dataset_version"),
  answerCount: integer("answer_count"),
  gitCommit: text("git_commit"),
  dirty: integer("dirty", { mode: "boolean" }),
  status: text("status", { enum: experimentStatuses }).notNull().default("draft"),
  trialStatus: text("trial_status", { enum: trialStatuses }).notNull().default("none"),
  trialSize: integer("trial_size").notNull().default(10),
  error: text("error"),
  createdAt: createdAt(),
});

export const experimentModelStatuses = [
  "pending",
  "marking",
  "submitting",
  "needs_attention",
  "closed",
  "withdrawn",
] as const;

export type ModelSettings = { temperature: number; maxTokens: number };

export const experimentModels = sqliteTable("experiment_models", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  experimentId: integer("experiment_id")
    .notNull()
    .references(() => experiments.id),
  connectionId: integer("connection_id")
    .notNull()
    .references(() => connections.id),
  modelName: text("model_name").notNull(),
  modelSettings: text("model_settings", { mode: "json" }).$type<ModelSettings>().notNull(),
  inputPricePerMillion: real("input_price_per_million"),
  outputPricePerMillion: real("output_price_per_million"),
  // Cleared when an endpoint refuses response_format for this Model.
  useResponseFormat: integer("use_response_format", { mode: "boolean" }).notNull().default(true),
  runId: integer("run_id"),
  status: text("status", { enum: experimentModelStatuses }).notNull().default("pending"),
  closeRequested: integer("close_requested", { mode: "boolean" }).notNull().default(false),
  withdrawReason: text("withdraw_reason"),
  error: text("error"),
});

export const callStatuses = ["pending", "in_flight", "succeeded", "unreadable", "failed"] as const;

export type SubmittedLines = Record<string, { marks?: number[]; total: number }>;

export const calls = sqliteTable(
  "calls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    experimentModelId: integer("experiment_model_id")
      .notNull()
      .references(() => experimentModels.id),
    isTrial: integer("is_trial", { mode: "boolean" }).notNull().default(false),
    datasetVersion: integer("dataset_version").notNull(),
    answerId: text("answer_id").notNull(),
    questionId: text("question_id").notNull(),
    repeat: integer("repeat").notNull().default(1),
    status: text("status", { enum: callStatuses }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    prompt: text("prompt"),
    rawOutput: text("raw_output"),
    parsedLines: text("parsed_lines", { mode: "json" }).$type<SubmittedLines>(),
    reason: text("reason"),
    unreadableReason: text("unreadable_reason"),
    finishReason: text("finish_reason"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: real("cost_usd"),
    error: text("error"),
    batchId: integer("batch_id"),
    resultId: integer("result_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("calls_unique").on(t.experimentModelId, t.isTrial, t.answerId, t.repeat),
  ],
);

export const submissionBatches = sqliteTable("submission_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  experimentModelId: integer("experiment_model_id")
    .notNull()
    .references(() => experimentModels.id),
  status: text("status", { enum: ["sending", "stored", "refused"] }).notNull(),
  callCount: integer("call_count").notNull(),
  // run.results just before sending: how a crash mid-send is resolved.
  runResultsBefore: integer("run_results_before").notNull(),
  resultIds: text("result_ids", { mode: "json" }).$type<number[]>(),
  error: text("error"),
  createdAt: createdAt(),
});

export const scoreSnapshots = sqliteTable("score_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  experimentModelId: integer("experiment_model_id")
    .notNull()
    .references(() => experimentModels.id),
  runId: integer("run_id").notNull(),
  score: text("score", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  fetchedAt: createdAt(),
});

export const datasetCache = sqliteTable(
  "dataset_cache",
  {
    version: integer("version").notNull(),
    kind: text("kind", { enum: ["question", "scheme", "answer", "answer_list"] }).notNull(),
    externalId: text("external_id").notNull(),
    body: text("body", { mode: "json" }).$type<unknown>().notNull(),
  },
  (t) => [uniqueIndex("dataset_cache_unique").on(t.version, t.kind, t.externalId)],
);

export const workerHeartbeat = sqliteTable("worker_heartbeat", {
  id: integer("id").primaryKey(),
  pid: integer("pid").notNull(),
  beatAt: integer("beat_at").notNull(),
});
