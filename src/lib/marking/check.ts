import { z } from "zod";
import type { SubmittedLines } from "@/lib/db/schema";
import { linesToMark } from "@/lib/harness/render";
import type { Answer, Question, Scheme } from "@/lib/marking-lab/schemas";
import { extractJson } from "./parse";
import { lineTotal } from "./totals";

export type Reading =
  | { readable: true; lines: SubmittedLines; reason?: string }
  | { readable: false; why: string };

const Reply = z.object({
  lines: z.record(
    z.string(),
    z.object({ marks: z.array(z.number()).optional(), total: z.number().optional() }),
  ),
  reason: z.string().optional(),
});

const UNREADABLE_FINISH: Record<string, string> = {
  length: "The reply was cut off by the token limit.",
  content_filter: "The reply was stopped by the provider's content filter.",
};

/**
 * Turns a raw reply into marks Marking Lab will accept, or says why it can't.
 * One invalid Result makes Marking Lab refuse its whole batch, so everything is checked here.
 */
export function readReply(args: {
  rawOutput: string;
  finishReason: string | null;
  question: Question;
  answer: Answer;
  scheme: Scheme | null;
}): Reading {
  const { rawOutput, finishReason, question, answer, scheme } = args;
  const unreadable = (why: string): Reading => ({ readable: false, why });

  if (finishReason && UNREADABLE_FINISH[finishReason]) return unreadable(UNREADABLE_FINISH[finishReason]);
  if (!rawOutput.trim()) return unreadable("The reply was empty.");

  const json = extractJson(rawOutput);
  if (json === undefined) return unreadable("The reply has no valid JSON object.");
  const reply = Reply.safeParse(json);
  if (!reply.success) return unreadable("The JSON isn't in the requested shape.");

  const expected = linesToMark(question, answer);
  const expectedLabels = new Set(expected.map((l) => l.label));
  for (const label of Object.keys(reply.data.lines)) {
    if (!expectedLabels.has(label)) return unreadable(`The reply marks line ${label}, which wasn't asked for.`);
  }

  const lines: SubmittedLines = {};
  for (const line of expected) {
    const given = reply.data.lines[line.label];
    if (!given) return unreadable(`The reply doesn't mark line ${line.label}.`);

    if (!scheme) {
      const total = given.total;
      if (total === undefined || !Number.isInteger(total) || total < 0 || total > line.marks) {
        return unreadable(`Line ${line.label}: total must be a whole number from 0 to ${line.marks}.`);
      }
      lines[line.label] = { total };
      continue;
    }

    const points = scheme.lines.find((l) => l.label === line.label)?.points;
    if (!points) return unreadable(`Line ${line.label} isn't in the Marking Scheme.`);
    const marks = given.marks;
    if (!marks || marks.length !== points.length) {
      return unreadable(`Line ${line.label} has ${points.length} marking point(s) but ${marks?.length ?? 0} mark(s).`);
    }
    for (const [i, m] of marks.entries()) {
      if (!Number.isInteger(m) || m < 0 || m > points[i].marks) {
        return unreadable(`Line ${line.label}, point ${i + 1}: mark must be a whole number from 0 to ${points[i].marks}.`);
      }
    }
    lines[line.label] = { marks, total: lineTotal(marks, line.marks) };
  }
  return { readable: true, lines, reason: reply.data.reason };
}
