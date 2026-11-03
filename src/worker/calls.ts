import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { calls, connections, experimentModels, harnessVersions } from "@/lib/db/schema";
import { outputJsonSchema } from "@/lib/harness/output-instructions";
import { linesToMark, renderPrompt } from "@/lib/harness/render";
import type { ModelCaller, ModelReply } from "@/lib/llm/client";
import { callCost } from "@/lib/llm/cost";
import { backoffMs, classifyFailure, MAX_ATTEMPTS } from "@/lib/llm/errors";
import { readReply } from "@/lib/marking/check";
import type { Dataset } from "@/lib/marking-lab/dataset";

export type CallDeps = {
  db: Db;
  dataset: () => Dataset;
  caller: ModelCaller;
  sleep: (ms: number) => Promise<void>;
  retryBaseMs: number;
};

export type CallContext = {
  call: typeof calls.$inferSelect;
  model: typeof experimentModels.$inferSelect;
  connection: typeof connections.$inferSelect;
  harness: typeof harnessVersions.$inferSelect;
};

async function prepare({ call, harness }: CallContext, deps: CallDeps) {
  const dataset = deps.dataset();
  const [question, answer, scheme] = await Promise.all([
    dataset.question(call.questionId, call.datasetVersion),
    dataset.answer(call.answerId, call.datasetVersion),
    harness.usedMarkingScheme ? dataset.scheme(call.questionId, call.datasetVersion) : null,
  ]);
  const prompt = renderPrompt({ template: harness.promptTemplate, question, answer, scheme });
  const jsonSchema = outputJsonSchema(linesToMark(question, answer), scheme);
  return { question, answer, scheme, prompt, jsonSchema };
}

/** Stops a Model at once rather than spending attempts on every Answer. */
function stopForConfiguration(db: Db, ctx: CallContext, message: string) {
  const { call, model } = ctx;
  db.transaction((tx) => {
    tx.update(calls).set({ status: "failed", error: message }).where(eq(calls.id, call.id)).run();
    if (call.isTrial) {
      tx.update(calls)
        .set({ status: "failed", error: message })
        .where(and(eq(calls.experimentModelId, model.id), eq(calls.isTrial, true), inArray(calls.status, ["pending"])))
        .run();
    } else {
      tx.update(experimentModels)
        .set({ status: "needs_attention", error: message })
        .where(and(eq(experimentModels.id, model.id), eq(experimentModels.status, "marking")))
        .run();
    }
  });
}

/**
 * Makes one Call and records its outcome. Provider trouble is retried and ends as "failed",
 * never as an Unreadable Reply: an outage shouldn't count against a Model. Unreadable Replies
 * aren't retried, since that would hide real unreliability and flatter the Score.
 */
export async function runCall(deps: CallDeps, ctx: CallContext) {
  const { db } = deps;
  const { call, connection, model } = ctx;
  let useResponseFormat = model.useResponseFormat;

  for (let attempt = 1; ; ) {
    try {
      const { question, answer, scheme, prompt, jsonSchema } = await prepare(ctx, deps);
      db.update(calls).set({ prompt, attempts: attempt }).where(eq(calls.id, call.id)).run();
      const reply: ModelReply = await deps.caller({
        connection,
        model: model.modelName,
        settings: model.modelSettings,
        prompt,
        jsonSchema: useResponseFormat ? jsonSchema : null,
      });
      const reading = readReply({
        rawOutput: reply.rawOutput,
        finishReason: reply.finishReason,
        question,
        answer,
        scheme,
      });
      db.update(calls)
        .set({
          status: reading.readable ? "succeeded" : "unreadable",
          rawOutput: reply.rawOutput,
          parsedLines: reading.readable ? reading.lines : null,
          reason: reading.readable ? (reading.reason ?? null) : null,
          unreadableReason: reading.readable ? null : reading.why,
          finishReason: reply.finishReason,
          latencyMs: reply.latencyMs,
          inputTokens: reply.inputTokens,
          outputTokens: reply.outputTokens,
          costUsd: callCost({
            locality: connection.locality,
            providerCostUsd: reply.providerCostUsd,
            inputTokens: reply.inputTokens,
            outputTokens: reply.outputTokens,
            inputPricePerMillion: model.inputPricePerMillion,
            outputPricePerMillion: model.outputPricePerMillion,
          }),
          error: null,
        })
        .where(eq(calls.id, call.id))
        .run();
      return;
    } catch (err) {
      const failure = classifyFailure(err);
      if (failure.kind === "format_refused" && useResponseFormat) {
        useResponseFormat = false;
        db.update(experimentModels)
          .set({ useResponseFormat: false })
          .where(eq(experimentModels.id, model.id))
          .run();
        continue; // Not the Model's fault, and not an attempt.
      }
      if (failure.kind !== "retryable") {
        stopForConfiguration(db, ctx, failure.message);
        return;
      }
      if (attempt >= MAX_ATTEMPTS) {
        db.update(calls).set({ status: "failed", error: failure.message }).where(eq(calls.id, call.id)).run();
        return;
      }
      await deps.sleep(backoffMs(attempt, deps.retryBaseMs, failure.retryAfterMs));
      attempt++;
    }
  }
}
