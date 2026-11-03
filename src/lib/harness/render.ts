import type { Answer, Question, Scheme } from "@/lib/marking-lab/schemas";
import { outputInstructions } from "./output-instructions";

export type Line = Question["lines"][number];

export const PLACEHOLDERS = ["stem", "lines", "answer", "scheme"] as const;
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Problems that stop a template being saved. Empty when it's fine. */
export function templateProblems(template: string, usedMarkingScheme: boolean): string[] {
  const problems: string[] = [];
  const found = new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]));
  for (const name of found) {
    if (!(PLACEHOLDERS as readonly string[]).includes(name)) {
      problems.push(`Unknown placeholder {{${name}}}. Use ${PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")}.`);
    }
  }
  if (!found.has("answer")) problems.push("The template needs {{answer}}, or the Model has nothing to mark.");
  if (usedMarkingScheme && !found.has("scheme")) {
    problems.push("This Harness uses the Marking Scheme, so the template needs {{scheme}}.");
  }
  if (!usedMarkingScheme && found.has("scheme")) {
    problems.push("This Harness doesn't use the Marking Scheme, so remove {{scheme}}.");
  }
  return problems;
}

/** The marked Lines this Answer has: exactly what a Result must cover. */
export function linesToMark(question: Question, answer: Answer): Line[] {
  return question.lines.filter((l) => l.marked && l.label in answer.lines);
}

function renderLines(question: Question) {
  return question.lines
    .map((l) => {
      const worth = l.marked ? `[${l.marks} marks]` : "[context only, not marked]";
      const unit = l.answerLineUnit ? ` (answer line unit: ${l.answerLineUnit})` : "";
      return `(${l.label}) ${l.text} ${worth}${unit}`;
    })
    .join("\n");
}

function renderAnswer(question: Question, answer: Answer) {
  return question.lines
    .filter((l) => l.label in answer.lines)
    .map((l) => `(${l.label})${l.marked ? "" : " [not marked]"} ${answer.lines[l.label]}`)
    .join("\n");
}

function renderScheme(scheme: Scheme) {
  return scheme.lines
    .map((line) => {
      const points = line.points.map(
        (p, i) => `  ${i + 1}. ${p.code ?? ""}${p.type ? ` (${p.type})` : ""}, ${p.marks} mark: ${p.text}`,
      );
      return [`(${line.label}) worth ${line.marks} marks`, ...points].join("\n");
    })
    .join("\n");
}

export function renderPrompt(args: {
  template: string;
  question: Question;
  answer: Answer;
  scheme: Scheme | null;
}): string {
  const { template, question, answer, scheme } = args;
  const values: Record<string, string> = {
    stem: question.stem ?? "",
    lines: renderLines(question),
    answer: renderAnswer(question, answer),
    scheme: scheme ? renderScheme(scheme) : "",
  };
  // One pass with a replacer, so student text containing "{{scheme}}" is never expanded.
  const body = template.replace(PLACEHOLDER, (whole, name: string) => values[name] ?? whole);
  return `${body}\n\n${outputInstructions(linesToMark(question, answer), scheme)}`;
}
