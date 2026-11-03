import { and, avg, count, desc, eq, inArray, sum } from "drizzle-orm";
import type { Db } from "@/lib/db";
import {
  calls,
  connections,
  experimentModels,
  experiments,
  harnesses,
  harnessVersions,
  scoreSnapshots,
} from "@/lib/db/schema";
import type { ComparedRun } from "@/lib/experiments/comparability";
import { ScoreSchema, type Score } from "@/lib/marking-lab/schemas";

export type CallStats = {
  total: number;
  finished: number;
  succeeded: number;
  unreadable: number;
  failed: number;
  costUsd: number;
  /** Calls with no known cost: the spend figure is a minimum if this isn't 0. */
  unknownCost: number;
  averageLatencyMs: number | null;
};

export function callStats(db: Db, modelId: number, isTrial: boolean): CallStats {
  const rows = db
    .select({
      status: calls.status,
      n: count(),
      cost: sum(calls.costUsd),
      costed: count(calls.costUsd),
      latency: avg(calls.latencyMs),
    })
    .from(calls)
    .where(and(eq(calls.experimentModelId, modelId), eq(calls.isTrial, isTrial)))
    .groupBy(calls.status)
    .all();
  const of = (status: string) => rows.find((r) => r.status === status)?.n ?? 0;
  const completed = rows.filter((r) => r.status === "succeeded" || r.status === "unreadable");
  const completedCount = completed.reduce((t, r) => t + r.n, 0);
  return {
    total: rows.reduce((t, r) => t + r.n, 0),
    finished: completedCount + of("failed"),
    succeeded: of("succeeded"),
    unreadable: of("unreadable"),
    failed: of("failed"),
    costUsd: rows.reduce((t, r) => t + Number(r.cost ?? 0), 0),
    unknownCost: completed.reduce((t, r) => t + (r.n - r.costed), 0),
    averageLatencyMs:
      completedCount === 0
        ? null
        : completed.reduce((t, r) => t + Number(r.latency ?? 0) * r.n, 0) / completedCount,
  };
}

export function latestScore(db: Db, modelId: number): Score | null {
  const row = db
    .select()
    .from(scoreSnapshots)
    .where(eq(scoreSnapshots.experimentModelId, modelId))
    .orderBy(desc(scoreSnapshots.id))
    .get();
  if (!row) return null;
  const parsed = ScoreSchema.safeParse(row.score);
  return parsed.success ? parsed.data : null;
}

export type ComparisonRow = {
  modelId: number;
  runId: number | null;
  experimentId: number;
  experimentName: string;
  label: string;
  harnessLabel: string;
  status: string;
  score: Score | null;
  stats: CallStats;
  compared: ComparedRun;
};

export function comparisonRows(db: Db, modelIds?: number[]): ComparisonRow[] {
  const rows = db
    .select({ model: experimentModels, experiment: experiments, version: harnessVersions, harness: harnesses })
    .from(experimentModels)
    .innerJoin(experiments, eq(experimentModels.experimentId, experiments.id))
    .innerJoin(harnessVersions, eq(experiments.harnessVersionId, harnessVersions.id))
    .innerJoin(harnesses, eq(harnessVersions.harnessId, harnesses.id))
    .where(modelIds ? inArray(experimentModels.id, modelIds) : undefined)
    .orderBy(desc(experimentModels.id))
    .all();
  return rows.map(({ model, experiment, version, harness }) => {
    const score = latestScore(db, model.id);
    const label = `${model.modelName} (Run ${model.runId ?? "none"})`;
    return {
      modelId: model.id,
      runId: model.runId,
      experimentId: experiment.id,
      experimentName: experiment.name,
      label,
      harnessLabel: `${harness.name} v${version.version}`,
      status: model.status,
      score,
      stats: callStats(db, model.id, false),
      compared: {
        label,
        datasetVersion: experiment.datasetVersion,
        answerSource: experiment.answerFilter.source,
        harnessHash: version.hash,
        expectedAnswers: experiment.answerCount,
        answersMarked: score?.answersMarked ?? null,
        dirty: experiment.dirty,
        repeats: experiment.repeats,
        temperature: model.modelSettings.temperature,
        closed: model.status === "closed",
      },
    };
  });
}

export function connectionById(db: Db, id: number) {
  return db.select().from(connections).where(eq(connections.id, id)).get();
}
