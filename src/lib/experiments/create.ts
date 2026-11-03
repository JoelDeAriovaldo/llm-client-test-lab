import { inArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { connections, experimentModels, experiments, type AnswerFilter, type ModelSettings } from "@/lib/db/schema";

/** Applies to the whole Experiment, so every Model marks the same Answers and stays comparable. */
export function answerFilterFor(localities: ("local" | "cloud")[], allowRealOnCloud: boolean): AnswerFilter {
  return { source: localities.includes("cloud") && !allowRealOnCloud ? "synthetic" : null };
}

export type NewExperiment = {
  name: string;
  notes?: string;
  harnessVersionId: number;
  repeats: number;
  allowRealOnCloud: boolean;
  spendLimitUsd: number | null;
  models: {
    connectionId: number;
    modelName: string;
    settings: ModelSettings;
    inputPricePerMillion: number | null;
    outputPricePerMillion: number | null;
  }[];
};

export function createExperiment(db: Db, input: NewExperiment): number {
  if (input.models.length === 0) throw new Error("An Experiment needs at least one Model.");
  if (!Number.isInteger(input.repeats) || input.repeats < 1) throw new Error("Repeats must be 1 or more.");
  const used = db
    .select()
    .from(connections)
    .where(inArray(connections.id, input.models.map((m) => m.connectionId)))
    .all();
  return db.transaction((tx) => {
    const experiment = tx
      .insert(experiments)
      .values({
        name: input.name,
        notes: input.notes || null,
        harnessVersionId: input.harnessVersionId,
        repeats: input.repeats,
        allowRealOnCloud: input.allowRealOnCloud,
        answerFilter: answerFilterFor(used.map((c) => c.locality), input.allowRealOnCloud),
        spendLimitUsd: input.spendLimitUsd,
      })
      .returning()
      .get();
    for (const m of input.models) {
      tx.insert(experimentModels)
        .values({
          experimentId: experiment.id,
          connectionId: m.connectionId,
          modelName: m.modelName,
          modelSettings: m.settings,
          inputPricePerMillion: m.inputPricePerMillion,
          outputPricePerMillion: m.outputPricePerMillion,
        })
        .run();
    }
    return experiment.id;
  });
}
