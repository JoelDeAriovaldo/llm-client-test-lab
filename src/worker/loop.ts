import { and, asc, count, eq, inArray, isNull, sum } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { calls, connections, experimentModels, experiments, harnesses, harnessVersions } from "@/lib/db/schema";
import { OUTPUT_INSTRUCTIONS_PLACEHOLDER } from "@/lib/harness/output-instructions";
import type { ModelCaller } from "@/lib/llm/client";
import { MarkingLabError, type MarkingLabClient } from "@/lib/marking-lab/client";
import { Dataset } from "@/lib/marking-lab/dataset";
import type { CodeState } from "@/lib/git";
import { runCall, type CallContext } from "./calls";
import { submitModel } from "./submit";
import { sampleAcrossQuestions } from "./trial";

export type WorkerDeps = {
  db: Db;
  /** Called when needed, so a missing key is reported on the Experiment rather than crashing the worker. */
  lab: () => MarkingLabClient;
  caller: ModelCaller;
  codeState: () => CodeState;
  sleep?: (ms: number) => Promise<void>;
  retryBaseMs?: number;
  batchSize?: number;
};

const NO_ANSWERS = "No Answers match this Experiment's filter, so there's nothing to mark.";

const messageOf = (err: unknown) =>
  err instanceof MarkingLabError
    ? [err.message, ...err.details].join("; ")
    : err instanceof Error
      ? err.message
      : String(err);

export class Worker {
  private readonly db: Db;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly retryBaseMs: number;
  private readonly batchSize: number;
  private readonly active = new Set<Promise<void>>();
  private readonly inFlight = new Map<number, number>();
  private readonly busyExperiments = new Set<number>();
  private readonly busyModels = new Set<number>();

  constructor(private readonly deps: WorkerDeps) {
    this.db = deps.db;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.retryBaseMs = deps.retryBaseMs ?? 1000;
    this.batchSize = deps.batchSize ?? 50;
  }

  /** Calls left in flight by a crash had no outcome recorded, so they run again. */
  recover() {
    this.db.update(calls).set({ status: "pending" }).where(eq(calls.status, "in_flight")).run();
  }

  private track(work: Promise<void>) {
    const tracked = work.finally(() => this.active.delete(tracked));
    this.active.add(tracked);
  }

  private dataset() {
    return new Dataset(this.db, this.deps.lab());
  }

  /** One pass over the database: starts whatever is ready and returns without waiting for it. */
  tick() {
    this.startQueuedTrials();
    this.startQueuedExperiments();
    this.enforceSpendLimits();
    this.dispatchCalls();
    this.settleFinishedWork();
    this.startSubmissions();
  }

  /** Ticks until nothing is left to do. */
  async drain() {
    for (;;) {
      this.tick();
      if (this.active.size === 0) {
        this.tick();
        if (this.active.size === 0) return;
      }
      await Promise.race(this.active);
    }
  }

  private startQueuedTrials() {
    const requested = this.db.select().from(experiments).where(eq(experiments.trialStatus, "requested")).all();
    for (const experiment of requested) {
      this.db.update(experiments).set({ trialStatus: "running" }).where(eq(experiments.id, experiment.id)).run();
      this.track(
        this.seedTrial(experiment).catch((err) => {
          this.db
            .update(experiments)
            .set({ trialStatus: "failed", error: `The Trial couldn't start: ${messageOf(err)}` })
            .where(eq(experiments.id, experiment.id))
            .run();
        }),
      );
    }
  }

  private async seedTrial(experiment: typeof experiments.$inferSelect) {
    const version = (await this.deps.lab().datasetVersion()).datasetVersion;
    const eligible = await this.dataset().eligibleAnswers(version, experiment.answerFilter.source);
    if (eligible.length === 0) throw new Error(NO_ANSWERS);
    const sample = sampleAcrossQuestions(eligible, experiment.trialSize, experiment.id);
    const models = this.db.select().from(experimentModels).where(eq(experimentModels.experimentId, experiment.id)).all();
    this.db.transaction((tx) => {
      for (const model of models) {
        for (const answer of sample) {
          tx.insert(calls)
            .values({
              experimentModelId: model.id,
              isTrial: true,
              datasetVersion: version,
              answerId: answer.id,
              questionId: answer.questionId,
              repeat: 1,
            })
            .onConflictDoNothing()
            .run();
        }
      }
      tx.update(experiments).set({ answerCount: eligible.length }).where(eq(experiments.id, experiment.id)).run();
    });
  }

  private startQueuedExperiments() {
    const queued = this.db.select().from(experiments).where(eq(experiments.status, "queued")).all();
    for (const experiment of queued) {
      if (this.busyExperiments.has(experiment.id)) continue;
      this.busyExperiments.add(experiment.id);
      this.track(
        this.beginExperiment(experiment)
          .catch((err) => {
            this.db
              .update(experiments)
              .set({ status: "paused", error: `The Experiment couldn't start: ${messageOf(err)}` })
              .where(eq(experiments.id, experiment.id))
              .run();
          })
          .finally(() => this.busyExperiments.delete(experiment.id)),
      );
    }
  }

  /** Safe to repeat: picks up from whichever Model hasn't got a Run yet. */
  private async beginExperiment(experiment: typeof experiments.$inferSelect) {
    const { db } = this;
    const lab = this.deps.lab();
    const code = experiment.gitCommit
      ? { commit: experiment.gitCommit, dirty: experiment.dirty ?? false }
      : this.deps.codeState();
    db.update(experiments).set({ gitCommit: code.commit, dirty: code.dirty }).where(eq(experiments.id, experiment.id)).run();

    const { harness, version } = db
      .select({ harness: harnesses, version: harnessVersions })
      .from(harnessVersions)
      .innerJoin(harnesses, eq(harnessVersions.harnessId, harnesses.id))
      .where(eq(harnessVersions.id, experiment.harnessVersionId))
      .get()!;
    const slug = harness.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    let datasetVersion = experiment.datasetVersion;
    const models = db
      .select({ model: experimentModels, connection: connections })
      .from(experimentModels)
      .innerJoin(connections, eq(experimentModels.connectionId, connections.id))
      .where(and(eq(experimentModels.experimentId, experiment.id), isNull(experimentModels.runId)))
      .all();
    for (const { model, connection } of models) {
      const started = await lab.startRun({
        harnessName: `llm-client-test-lab/${slug}-v${version.version}`,
        gitCommit: code.commit,
        dirty: code.dirty,
        model: model.modelName,
        modelSettings: { ...model.modelSettings },
        usedMarkingScheme: version.usedMarkingScheme,
        promptTemplate: `${version.promptTemplate}\n\n${OUTPUT_INSTRUCTIONS_PLACEHOLDER}`,
        split: "open",
        ...(experiment.notes ? { notes: experiment.notes } : {}),
        extra: {
          harnessHash: version.hash,
          harnessVersionId: version.id,
          experimentId: experiment.id,
          answerFilter: experiment.answerFilter,
          connection: connection.name,
        },
        // Pinned to the first Run's version, so a change mid-Experiment can't split the data.
        ...(datasetVersion === null ? {} : { datasetVersion }),
      });
      datasetVersion ??= started.datasetVersion;
      db.update(experiments).set({ datasetVersion }).where(eq(experiments.id, experiment.id)).run();
      db.update(experimentModels).set({ runId: started.runId }).where(eq(experimentModels.id, model.id)).run();
    }

    const eligible = await this.dataset().eligibleAnswers(datasetVersion!, experiment.answerFilter.source);
    if (eligible.length === 0) throw new Error(NO_ANSWERS);
    const unseeded = db
      .select()
      .from(experimentModels)
      .where(and(eq(experimentModels.experimentId, experiment.id), eq(experimentModels.status, "pending")))
      .all();
    db.transaction((tx) => {
      for (const model of unseeded) {
        for (const answer of eligible) {
          for (let repeat = 1; repeat <= experiment.repeats; repeat++) {
            tx.insert(calls)
              .values({
                experimentModelId: model.id,
                datasetVersion: datasetVersion!,
                answerId: answer.id,
                questionId: answer.questionId,
                repeat,
              })
              .onConflictDoNothing()
              .run();
          }
        }
        tx.update(experimentModels).set({ status: "marking" }).where(eq(experimentModels.id, model.id)).run();
      }
      tx.update(experiments)
        .set({ status: "running", answerCount: eligible.length })
        .where(eq(experiments.id, experiment.id))
        .run();
    });
  }

  private enforceSpendLimits() {
    const running = this.db.select().from(experiments).where(eq(experiments.status, "running")).all();
    for (const experiment of running) {
      if (experiment.spendLimitUsd === null) continue;
      const spent = this.db
        .select({ total: sum(calls.costUsd) })
        .from(calls)
        .innerJoin(experimentModels, eq(calls.experimentModelId, experimentModels.id))
        .where(and(eq(experimentModels.experimentId, experiment.id), eq(calls.isTrial, false)))
        .get();
      if (Number(spent?.total ?? 0) >= experiment.spendLimitUsd) {
        this.db
          .update(experiments)
          .set({
            status: "paused",
            error: `Paused: this Experiment reached its spending limit of $${experiment.spendLimitUsd}. Raise the limit to resume.`,
          })
          .where(eq(experiments.id, experiment.id))
          .run();
      }
    }
  }

  private dispatchCalls() {
    const pending = this.db
      .select({
        call: calls,
        model: experimentModels,
        experiment: experiments,
        connection: connections,
        harness: harnessVersions,
      })
      .from(calls)
      .innerJoin(experimentModels, eq(calls.experimentModelId, experimentModels.id))
      .innerJoin(experiments, eq(experimentModels.experimentId, experiments.id))
      .innerJoin(connections, eq(experimentModels.connectionId, connections.id))
      .innerJoin(harnessVersions, eq(experiments.harnessVersionId, harnessVersions.id))
      .where(eq(calls.status, "pending"))
      // By Answer rather than by Model, so Models sharing a Connection advance together.
      .orderBy(asc(calls.answerId), asc(calls.repeat), asc(calls.experimentModelId))
      .all();

    for (const { call, model, experiment, connection, harness } of pending) {
      const allowed = call.isTrial
        ? experiment.trialStatus === "running"
        : experiment.status === "running" && model.status === "marking";
      if (!allowed) continue;
      const used = this.inFlight.get(connection.id) ?? 0;
      if (used >= connection.concurrency) continue;

      this.inFlight.set(connection.id, used + 1);
      this.db.update(calls).set({ status: "in_flight" }).where(eq(calls.id, call.id)).run();
      const context: CallContext = { call, model, connection, harness };
      this.track(
        runCall(
          {
            db: this.db,
            dataset: () => this.dataset(),
            caller: this.deps.caller,
            sleep: this.sleep,
            retryBaseMs: this.retryBaseMs,
          },
          context,
        ).finally(() => {
          this.inFlight.set(connection.id, (this.inFlight.get(connection.id) ?? 1) - 1);
        }),
      );
    }
  }

  private unfinishedCalls(modelId: number, isTrial: boolean) {
    return (
      this.db
        .select({ n: count() })
        .from(calls)
        .where(
          and(
            eq(calls.experimentModelId, modelId),
            eq(calls.isTrial, isTrial),
            inArray(calls.status, ["pending", "in_flight"]),
          ),
        )
        .get()?.n ?? 0
    );
  }

  private settleFinishedWork() {
    const { db } = this;
    const open = db.select().from(experiments).where(inArray(experiments.status, ["running", "paused"])).all();
    const trials = db.select().from(experiments).where(eq(experiments.trialStatus, "running")).all();

    for (const experiment of trials) {
      const models = db.select().from(experimentModels).where(eq(experimentModels.experimentId, experiment.id)).all();
      if (this.trialSeeded(experiment.id) && models.every((m) => this.unfinishedCalls(m.id, true) === 0)) {
        db.update(experiments).set({ trialStatus: "done" }).where(eq(experiments.id, experiment.id)).run();
      }
    }

    for (const experiment of open) {
      const models = db.select().from(experimentModels).where(eq(experimentModels.experimentId, experiment.id)).all();
      for (const model of models) {
        if (model.status === "marking" && this.unfinishedCalls(model.id, false) === 0) {
          db.update(experimentModels).set({ status: "submitting" }).where(eq(experimentModels.id, model.id)).run();
          model.status = "submitting";
        }
      }
      const statuses = models.map((m) => m.status);
      if (statuses.every((s) => s === "closed" || s === "withdrawn")) {
        db.update(experiments).set({ status: "finished" }).where(eq(experiments.id, experiment.id)).run();
      } else if (experiment.status === "running" && statuses.every((s) => s === "closed" || s === "withdrawn" || s === "needs_attention")) {
        db.update(experiments).set({ status: "paused" }).where(eq(experiments.id, experiment.id)).run();
      }
    }
  }

  private trialSeeded(experimentId: number) {
    const row = this.db
      .select({ n: count() })
      .from(calls)
      .innerJoin(experimentModels, eq(calls.experimentModelId, experimentModels.id))
      .where(and(eq(experimentModels.experimentId, experimentId), eq(calls.isTrial, true)))
      .get();
    return (row?.n ?? 0) > 0;
  }

  private startSubmissions() {
    const submitting = this.db.select().from(experimentModels).where(eq(experimentModels.status, "submitting")).all();
    for (const model of submitting) {
      if (this.busyModels.has(model.id)) continue;
      this.busyModels.add(model.id);
      this.track(
        (async () => {
          await submitModel(
            {
              db: this.db,
              lab: this.deps.lab(),
              sleep: this.sleep,
              retryBaseMs: this.retryBaseMs,
              batchSize: this.batchSize,
            },
            model,
          );
        })()
          .catch((err) => {
            this.db
              .update(experimentModels)
              .set({ status: "needs_attention", error: messageOf(err) })
              .where(eq(experimentModels.id, model.id))
              .run();
          })
          .finally(() => this.busyModels.delete(model.id)),
      );
    }
  }
}
