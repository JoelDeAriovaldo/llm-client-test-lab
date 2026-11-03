export type ComparedRun = {
  label: string;
  datasetVersion: number | null;
  answerSource: string | null;
  harnessHash: string;
  expectedAnswers: number | null;
  answersMarked: number | null;
  dirty: boolean | null;
  repeats: number;
  temperature: number;
  closed: boolean;
};

const differs = <T>(runs: ComparedRun[], pick: (r: ComparedRun) => T) => new Set(runs.map(pick)).size > 1;

/** Reasons a Score comparison could mislead. Empty when the Runs compare cleanly. */
export function comparabilityWarnings(runs: ComparedRun[]): string[] {
  const warnings: string[] = [];
  if (differs(runs, (r) => r.datasetVersion)) warnings.push("These Runs use different Dataset Versions.");
  if (differs(runs, (r) => r.answerSource)) warnings.push("These Runs marked different sets of Answers.");
  if (differs(runs, (r) => r.harnessHash)) warnings.push("These Runs use different Harness Versions.");
  for (const r of runs) {
    if (r.expectedAnswers !== null && r.answersMarked !== null && r.answersMarked < r.expectedAnswers) {
      warnings.push(`${r.label} marked only ${r.answersMarked} of ${r.expectedAnswers} Answers.`);
    }
    if (!r.closed) warnings.push(`${r.label} isn't closed, so it has summary figures only.`);
    if (r.dirty) warnings.push(`${r.label} ran on code with uncommitted changes.`);
    if (r.repeats > 1 && r.temperature === 0) {
      warnings.push(`${r.label} used repeats at temperature 0, so a high repeat consistency means little.`);
    }
  }
  return warnings;
}
