import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { calls, experimentModels, scoreSnapshots, submissionBatches } from "@/lib/db/schema";
import { MarkingLabError, type MarkingLabClient } from "@/lib/marking-lab/client";
import type { ResultSubmit } from "@/lib/marking-lab/schemas";
import { backoffMs, MAX_ATTEMPTS } from "@/lib/llm/errors";

export type SubmitDeps = {
  db: Db;
  lab: MarkingLabClient;
  sleep: (ms: number) => Promise<void>;
  retryBaseMs: number;
  batchSize: number;
};

type Call = typeof calls.$inferSelect;
type Model = typeof experimentModels.$inferSelect;

function toResult(call: Call): ResultSubmit {
  const parseFailed = call.status === "unreadable";
  return {
    answerId: call.answerId,
    datasetVersion: call.datasetVersion,
    repeat: call.repeat,
    prompt: call.prompt ?? "",
    rawOutput: call.rawOutput ?? "",
    parseFailed,
    ...(call.reason ? { reason: call.reason } : {}),
    ...(parseFailed ? {} : { lines: call.parsedLines ?? {} }),
  };
}

function needsAttention(db: Db, modelId: number, error: string) {
  db.update(experimentModels).set({ status: "needs_attention", error }).where(eq(experimentModels.id, modelId)).run();
}

function describe(err: MarkingLabError) {
  return [err.message, ...err.details].join("; ");
}

/**
 * A worker can die after Marking Lab stores a batch but before that is recorded here, and
 * resending would duplicate permanent Results. The API has no idempotency key, so the stored
 * count is the only evidence: only one batch is ever in flight per Run, so it can be trusted.
 * Returns false if the batch's fate can't be determined.
 */
async function resolveInterruptedBatches(deps: SubmitDeps, model: Model, runId: number): Promise<boolean> {
  const { db, lab } = deps;
  const interrupted = db
    .select()
    .from(submissionBatches)
    .where(and(eq(submissionBatches.experimentModelId, model.id), eq(submissionBatches.status, "sending")))
    .all();
  for (const batch of interrupted) {
    const results = (await lab.run(runId)).results ?? 0;
    if (results === batch.runResultsBefore + batch.callCount) {
      db.update(submissionBatches).set({ status: "stored" }).where(eq(submissionBatches.id, batch.id)).run();
    } else if (results === batch.runResultsBefore) {
      db.transaction((tx) => {
        tx.update(calls).set({ batchId: null }).where(eq(calls.batchId, batch.id)).run();
        tx.delete(submissionBatches).where(eq(submissionBatches.id, batch.id)).run();
      });
    } else {
      needsAttention(
        db,
        model.id,
        `Can't tell whether batch ${batch.id} was stored: Run ${runId} went from ${batch.runResultsBefore} to ${results} Results, and the batch has ${batch.callCount}. Check the Run before going on.`,
      );
      return false;
    }
  }
  return true;
}

async function sendReadyBatches(deps: SubmitDeps, model: Model, runId: number): Promise<boolean> {
  const { db, lab, batchSize } = deps;
  for (;;) {
    const ready = db
      .select()
      .from(calls)
      .where(
        and(
          eq(calls.experimentModelId, model.id),
          eq(calls.isTrial, false),
          inArray(calls.status, ["succeeded", "unreadable"]),
          isNull(calls.batchId),
        ),
      )
      .orderBy(asc(calls.id))
      .limit(batchSize)
      .all();
    if (ready.length === 0) return true;

    const before = (await lab.run(runId)).results ?? 0;
    const batch = db.transaction((tx) => {
      const row = tx
        .insert(submissionBatches)
        .values({ experimentModelId: model.id, status: "sending", callCount: ready.length, runResultsBefore: before })
        .returning()
        .get();
      tx.update(calls).set({ batchId: row.id }).where(inArray(calls.id, ready.map((c) => c.id))).run();
      return row;
    });

    try {
      const { resultIds } = await lab.submitResults(runId, ready.map(toResult));
      db.transaction((tx) => {
        tx.update(submissionBatches).set({ status: "stored", resultIds }).where(eq(submissionBatches.id, batch.id)).run();
        ready.forEach((call, i) => {
          tx.update(calls).set({ resultId: resultIds[i] ?? null }).where(eq(calls.id, call.id)).run();
        });
      });
    } catch (err) {
      if (err instanceof MarkingLabError && err.status < 500) {
        // Refused: nothing stored. Our checks and the server's disagree, so a person should look.
        db.update(submissionBatches)
          .set({ status: "refused", error: describe(err) })
          .where(eq(submissionBatches.id, batch.id))
          .run();
        needsAttention(db, model.id, `Marking Lab refused a batch: ${describe(err)}`);
        return false;
      }
      throw err; // The batch stays "sending", and the retry resolves it from the stored count.
    }
  }
}

async function saveScore(deps: SubmitDeps, model: Model, runId: number) {
  const score = await deps.lab.score(runId);
  deps.db.insert(scoreSnapshots).values({ experimentModelId: model.id, runId, score }).run();
}

async function submitOnce(deps: SubmitDeps, model: Model) {
  const { db, lab } = deps;
  const runId = model.runId;
  if (runId === null) {
    needsAttention(db, model.id, "This Model has no Run on Marking Lab.");
    return;
  }
  if (!(await resolveInterruptedBatches(deps, model, runId))) return;
  if (!(await sendReadyBatches(deps, model, runId))) return;

  const unfinished =
    db
      .select({ n: count() })
      .from(calls)
      .where(
        and(
          eq(calls.experimentModelId, model.id),
          eq(calls.isTrial, false),
          inArray(calls.status, ["failed", "pending", "in_flight"]),
        ),
      )
      .get()?.n ?? 0;
  if (unfinished > 0 && !model.closeRequested) {
    await saveScore(deps, model, runId).catch(() => undefined); // Summary figures, if available.
    needsAttention(db, model.id, `${unfinished} Call(s) didn't finish. Resume to try them again, or close the Run without them.`);
    return;
  }

  try {
    await lab.closeRun(runId);
  } catch (err) {
    // Already closed by an earlier attempt that died before saving the Score.
    if (!(err instanceof MarkingLabError && err.status === 409)) throw err;
  }
  await saveScore(deps, model, runId);
  db.update(experimentModels).set({ status: "closed", error: null }).where(eq(experimentModels.id, model.id)).run();
}

export async function submitModel(deps: SubmitDeps, model: Model) {
  for (let attempt = 1; ; attempt++) {
    try {
      await submitOnce(deps, model);
      return;
    } catch (err) {
      const definite = err instanceof MarkingLabError && err.status < 500;
      if (definite || attempt >= MAX_ATTEMPTS) {
        const message = err instanceof MarkingLabError ? describe(err) : String(err);
        needsAttention(deps.db, model.id, `Couldn't finish with Marking Lab: ${message}`);
        return;
      }
      await deps.sleep(backoffMs(attempt, deps.retryBaseMs));
    }
  }
}
