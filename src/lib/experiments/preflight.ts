import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { connections, experimentModels, experiments, harnessVersions } from "@/lib/db/schema";
import { renderPrompt } from "@/lib/harness/render";
import { markingLabFromEnv } from "@/lib/marking-lab/client";
import { Dataset } from "@/lib/marking-lab/dataset";
import { estimateCostUsd } from "./estimate";

export type ModelEstimate = { modelName: string; costUsd: number | null };
export type Estimate = { answerCount: number; calls: number; models: ModelEstimate[] };

/** What an Experiment would mark and roughly cost, using current data. */
export async function estimateExperiment(db: Db, experimentId: number): Promise<Estimate> {
  const experiment = db.select().from(experiments).where(eq(experiments.id, experimentId)).get()!;
  const version = db.select().from(harnessVersions).where(eq(harnessVersions.id, experiment.harnessVersionId)).get()!;
  const lab = markingLabFromEnv();
  const dataset = new Dataset(db, lab);
  const datasetVersion = experiment.datasetVersion ?? (await lab.datasetVersion()).datasetVersion;
  const answers = await dataset.eligibleAnswers(datasetVersion, experiment.answerFilter.source);

  const sample = answers.slice(0, 5);
  let chars = 0;
  for (const answer of sample) {
    chars += renderPrompt({
      template: version.promptTemplate,
      question: await dataset.question(answer.questionId, datasetVersion),
      answer,
      scheme: version.usedMarkingScheme ? await dataset.scheme(answer.questionId, datasetVersion) : null,
    }).length;
  }
  const averagePromptChars = sample.length === 0 ? 0 : chars / sample.length;

  const models = db
    .select({ model: experimentModels, connection: connections })
    .from(experimentModels)
    .innerJoin(connections, eq(experimentModels.connectionId, connections.id))
    .where(eq(experimentModels.experimentId, experimentId))
    .all();
  return {
    answerCount: answers.length,
    calls: answers.length * experiment.repeats * models.length,
    models: models.map(({ model, connection }) => ({
      modelName: model.modelName,
      costUsd: estimateCostUsd({
        answerCount: answers.length,
        repeats: experiment.repeats,
        averagePromptChars,
        maxTokens: model.modelSettings.maxTokens,
        inputPricePerMillion: model.inputPricePerMillion,
        outputPricePerMillion: model.outputPricePerMillion,
        locality: connection.locality,
      }),
    })),
  };
}
