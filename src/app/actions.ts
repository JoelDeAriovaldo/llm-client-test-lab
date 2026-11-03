"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { connections, experimentModels, scoreSnapshots } from "@/lib/db/schema";
import {
  pauseExperiment,
  requestClose,
  requestTrial,
  resumeExperiment,
  startExperiment,
} from "@/lib/experiments/control";
import { createExperiment } from "@/lib/experiments/create";
import { renderPrompt, templateProblems } from "@/lib/harness/render";
import { createHarness, saveHarness } from "@/lib/harness/save";
import { listModels, type ListedModel } from "@/lib/llm/client";
import { MarkingLabError, markingLabFromEnv } from "@/lib/marking-lab/client";
import { Dataset } from "@/lib/marking-lab/dataset";

export type ActionState = { error?: string; message?: string };

function messageOf(err: unknown) {
  if (err instanceof MarkingLabError) return [err.message, ...err.details].join("; ");
  return err instanceof Error ? err.message : String(err);
}

const int = (form: FormData, name: string) => Number(form.get(name));

export async function saveConnectionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Give the Connection a name."),
      baseUrl: z.url("The base URL must be a full URL, such as https://openrouter.ai/api/v1."),
      apiKeyEnvVar: z
        .string()
        .trim()
        .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Enter the variable's name, such as OPENROUTER_API_KEY, not the key itself.")
        .or(z.literal("")),
      locality: z.enum(["local", "cloud"]),
      concurrency: z.coerce.number().int().min(1, "Concurrency must be 1 or more."),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { apiKeyEnvVar, ...rest } = parsed.data;
  const values = { ...rest, baseUrl: rest.baseUrl.replace(/\/$/, ""), apiKeyEnvVar: apiKeyEnvVar || null };
  const id = int(form, "id");
  try {
    if (id) getDb().update(connections).set(values).where(eq(connections.id, id)).run();
    else getDb().insert(connections).values(values).run();
  } catch (err) {
    return { error: messageOf(err) };
  }
  revalidatePath("/connections");
  return { message: "Saved." };
}

export async function testConnectionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const connection = getDb().select().from(connections).where(eq(connections.id, int(form, "id"))).get();
  if (!connection) return { error: "This Connection no longer exists." };
  try {
    const models = await listModels(connection);
    return { message: `Connected. ${models.length} Model(s) available.` };
  } catch (err) {
    return { error: messageOf(err) };
  }
}

export async function modelsForConnection(id: number): Promise<{ models: ListedModel[]; error?: string }> {
  const connection = getDb().select().from(connections).where(eq(connections.id, id)).get();
  if (!connection) return { models: [], error: "This Connection no longer exists." };
  try {
    return { models: await listModels(connection) };
  } catch (err) {
    return { models: [], error: messageOf(err) };
  }
}

export async function createHarnessAction(_: ActionState, form: FormData): Promise<ActionState> {
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Give the Harness a name." };
  let id: number;
  try {
    id = createHarness(getDb(), name, String(form.get("promptTemplate")), form.get("usedMarkingScheme") === "on");
  } catch (err) {
    return { error: messageOf(err) };
  }
  redirect(`/harnesses/${id}`);
}

export async function saveHarnessAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = int(form, "id");
  try {
    saveHarness(getDb(), id, String(form.get("promptTemplate")), form.get("usedMarkingScheme") === "on");
  } catch (err) {
    return { error: messageOf(err) };
  }
  revalidatePath(`/harnesses/${id}`);
  return { message: "Saved." };
}

export async function previewPrompt(
  template: string,
  usedMarkingScheme: boolean,
): Promise<{ prompt?: string; problems: string[]; caption?: string }> {
  const problems = templateProblems(template, usedMarkingScheme);
  if (problems.length > 0) return { problems };
  try {
    const db = getDb();
    const lab = markingLabFromEnv();
    const dataset = new Dataset(db, lab);
    const version = (await lab.datasetVersion()).datasetVersion;
    const answer = (await dataset.eligibleAnswers(version, "synthetic"))[0];
    if (!answer) return { problems: ["No synthetic Answers are available to preview with."] };
    const prompt = renderPrompt({
      template,
      question: await dataset.question(answer.questionId, version),
      answer,
      scheme: usedMarkingScheme ? await dataset.scheme(answer.questionId, version) : null,
    });
    return { prompt, problems: [], caption: `Answer ${answer.id}, Dataset Version ${version}` };
  } catch (err) {
    return { problems: [`Couldn't load a preview: ${messageOf(err)}`] };
  }
}

const NewExperimentSchema = z.object({
  name: z.string().trim().min(1, "Give the Experiment a name."),
  notes: z.string().optional(),
  harnessVersionId: z.number().int().positive("Choose a Harness."),
  repeats: z.number().int().min(1, "Repeats must be 1 or more."),
  allowRealOnCloud: z.boolean(),
  spendLimitUsd: z.number().positive("The spending limit must be above 0.").nullable(),
  models: z
    .array(
      z.object({
        connectionId: z.number().int().positive("Choose a Connection for each Model."),
        modelName: z.string().trim().min(1, "Enter a name for each Model."),
        settings: z.object({
          temperature: z.number().min(0, "Temperature can't be negative."),
          maxTokens: z.number().int().positive("The token limit must be above 0."),
        }),
        inputPricePerMillion: z.number().min(0).nullable(),
        outputPricePerMillion: z.number().min(0).nullable(),
      }),
    )
    .min(1, "Add at least one Model."),
});

export async function createExperimentAction(input: unknown): Promise<ActionState> {
  const parsed = NewExperimentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  let id: number;
  try {
    id = createExperiment(getDb(), parsed.data);
  } catch (err) {
    return { error: messageOf(err) };
  }
  redirect(`/experiments/${id}`);
}

function experimentAction(run: (id: number, form: FormData) => void) {
  return async (form: FormData) => {
    const id = int(form, "experimentId");
    run(id, form);
    revalidatePath(`/experiments/${id}`);
  };
}

const startImpl = experimentAction((id) => startExperiment(getDb(), id));
const pauseImpl = experimentAction((id) => pauseExperiment(getDb(), id));
const trialImpl = experimentAction((id) => requestTrial(getDb(), id));
const resumeImpl = experimentAction((id, form) => {
  const limit = form.get("spendLimitUsd");
  resumeExperiment(getDb(), id, limit ? Number(limit) : undefined);
});

export async function startExperimentAction(form: FormData) {
  await startImpl(form);
}
export async function pauseExperimentAction(form: FormData) {
  await pauseImpl(form);
}
export async function requestTrialAction(form: FormData) {
  await trialImpl(form);
}
export async function resumeExperimentAction(form: FormData) {
  await resumeImpl(form);
}

export async function closeRunAction(_: ActionState, form: FormData): Promise<ActionState> {
  requestClose(getDb(), int(form, "modelId"));
  revalidatePath(`/experiments/${int(form, "experimentId")}`);
  return { message: "Closing." };
}

export async function withdrawRunAction(_: ActionState, form: FormData): Promise<ActionState> {
  const db = getDb();
  const reason = String(form.get("reason") ?? "").trim();
  if (!reason) return { error: "A reason is required to withdraw a Run." };
  const model = db.select().from(experimentModels).where(eq(experimentModels.id, int(form, "modelId"))).get();
  if (!model?.runId) return { error: "This Model has no Run to withdraw." };
  try {
    const lab = markingLabFromEnv();
    await lab.withdrawRun(model.runId, reason);
    db.update(experimentModels)
      .set({ status: "withdrawn", withdrawReason: reason, error: null })
      .where(eq(experimentModels.id, model.id))
      .run();
    const score = await lab.score(model.runId).catch(() => null);
    if (score) db.insert(scoreSnapshots).values({ experimentModelId: model.id, runId: model.runId, score }).run();
  } catch (err) {
    return { error: messageOf(err) };
  }
  revalidatePath(`/experiments/${model.experimentId}`);
  return { message: "Withdrawn." };
}
