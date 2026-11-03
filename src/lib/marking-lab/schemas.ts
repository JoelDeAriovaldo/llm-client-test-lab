import { z } from "zod";

export const LineSchema = z.object({
  label: z.string(),
  text: z.string(),
  marks: z.number().int(),
  answerLineUnit: z.string().nullish(),
  marked: z.boolean(),
});

export const QuestionSchema = z.object({
  id: z.string(),
  topic: z.string().nullish(),
  syllabusRef: z.string().nullish(),
  tier: z.string().nullish(),
  ao: z.string().nullish(),
  totalMarks: z.number().int().nullish(),
  markedMarks: z.number().int().nullish(),
  stem: z.string().nullish(),
  lines: z.array(LineSchema),
});
export type Question = z.infer<typeof QuestionSchema>;

export const PointSchema = z.object({
  code: z.string().nullish(),
  type: z.string().nullish(),
  marks: z.number().int(),
  text: z.string(),
});

export const SchemeSchema = z.object({
  markedMarks: z.number().int().nullish(),
  lines: z.array(
    z.object({ label: z.string(), marks: z.number().int(), points: z.array(PointSchema) }),
  ),
});
export type Scheme = z.infer<typeof SchemeSchema>;

export const AnswerSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  source: z.string().nullish(),
  split: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  lines: z.record(z.string(), z.string()),
});
export type Answer = z.infer<typeof AnswerSchema>;

export const RunSchema = z.looseObject({
  id: z.number().int(),
  datasetVersion: z.number().int(),
  closed: z.boolean().nullish(),
  withdrawn: z.boolean().nullish(),
  results: z.number().int().nullish(),
});
export type Run = z.infer<typeof RunSchema>;

export const GroupStatsSchema = z.looseObject({
  results: z.number().nullish(),
  parseFailures: z.number().nullish(),
  exactTotalAgreement: z.number().nullish(),
  lineAgreement: z.number().nullish(),
  pointAgreement: z.number().nullish(),
  meanAbsError: z.number().nullish(),
  bias: z.number().nullish(),
});
export type GroupStats = z.infer<typeof GroupStatsSchema>;

const Breakdown = z.record(z.string(), GroupStatsSchema).nullish();

// The spec doesn't fix every part of this, so unknown fields are kept rather than dropped.
export const ScoreSchema = z.looseObject({
  runId: z.number().int().nullish(),
  closed: z.boolean().nullish(),
  withdrawn: z.boolean().nullish(),
  note: z.string().nullish(),
  datasetVersion: z.number().int().nullish(),
  answersMarked: z.number().nullish(),
  answersInSplit: z.number().nullish(),
  overall: GroupStatsSchema.nullish(),
  clearCases: GroupStatsSchema.nullish(),
  greyCases: GroupStatsSchema.nullish(),
  repeatConsistency: z
    .looseObject({
      answersWithRepeats: z.number().nullish(),
      consistent: z.number().nullish(),
      rate: z.number().nullish(),
    })
    .nullish(),
  errorHistogram: z.array(z.object({ bucket: z.string(), count: z.number() })).nullish(),
  byQuestion: Breakdown,
  byLine: Breakdown,
  bySyllabusRef: Breakdown,
  byTag: Breakdown,
  bySource: Breakdown,
  disagreements: z.array(z.record(z.string(), z.unknown())).nullish(),
});
export type Score = z.infer<typeof ScoreSchema>;

export type RunStart = {
  harnessName: string;
  gitCommit: string;
  dirty: boolean;
  model: string;
  modelSettings: Record<string, unknown>;
  usedMarkingScheme: boolean;
  promptTemplate: string;
  split: "open";
  notes?: string;
  extra: Record<string, unknown>;
  datasetVersion?: number;
};

export type ResultSubmit = {
  answerId: string;
  datasetVersion: number;
  repeat: number;
  lines?: Record<string, { marks?: number[]; total: number }>;
  reason?: string;
  prompt: string;
  rawOutput: string;
  parseFailed: boolean;
};
