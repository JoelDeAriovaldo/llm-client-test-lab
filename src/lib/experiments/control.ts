import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { calls, experimentModels, experiments, submissionBatches } from "@/lib/db/schema";

// The UI only records intent here; the worker notices it and acts.

export function startExperiment(db: Db, id: number) {
  db.update(experiments).set({ status: "queued", error: null }).where(eq(experiments.id, id)).run();
}

export function pauseExperiment(db: Db, id: number) {
  db.update(experiments).set({ status: "paused" }).where(eq(experiments.id, id)).run();
}

/** Replaces any earlier Trial. Trial Calls are local only and were never submitted. */
export function requestTrial(db: Db, id: number) {
  db.transaction((tx) => {
    const modelIds = tx
      .select({ id: experimentModels.id })
      .from(experimentModels)
      .where(eq(experimentModels.experimentId, id))
      .all()
      .map((m) => m.id);
    tx.delete(calls)
      .where(and(eq(calls.isTrial, true), inArray(calls.experimentModelId, modelIds)))
      .run();
    tx.update(experiments).set({ trialStatus: "requested", error: null }).where(eq(experiments.id, id)).run();
  });
}

export function resumeExperiment(db: Db, id: number, spendLimitUsd?: number | null) {
  db.transaction((tx) => {
    const models = tx.select().from(experimentModels).where(eq(experimentModels.experimentId, id)).all();
    const attention = models.filter((m) => m.status === "needs_attention").map((m) => m.id);
    if (attention.length > 0) {
      tx.update(calls)
        .set({ status: "pending", attempts: 0, error: null })
        .where(
          and(eq(calls.isTrial, false), eq(calls.status, "failed"), inArray(calls.experimentModelId, attention)),
        )
        .run();
      // Refused batches stored nothing, so their Calls can be sent again.
      const refused = tx
        .select({ id: submissionBatches.id })
        .from(submissionBatches)
        .where(and(eq(submissionBatches.status, "refused"), inArray(submissionBatches.experimentModelId, attention)))
        .all()
        .map((b) => b.id);
      if (refused.length > 0) {
        tx.update(calls).set({ batchId: null }).where(inArray(calls.batchId, refused)).run();
      }
      tx.update(experimentModels)
        .set({ status: "marking", error: null })
        .where(inArray(experimentModels.id, attention))
        .run();
    }
    const unstarted = models.some((m) => m.status === "pending");
    tx.update(experiments)
      .set({
        status: unstarted ? "queued" : "running",
        error: null,
        ...(spendLimitUsd === undefined ? {} : { spendLimitUsd }),
      })
      .where(eq(experiments.id, id))
      .run();
  });
}

/** Submits whatever is ready, then closes the Run, even with Calls left unfinished. */
export function requestClose(db: Db, modelId: number) {
  db.update(experimentModels)
    .set({ status: "submitting", closeRequested: true, error: null })
    .where(eq(experimentModels.id, modelId))
    .run();
}
