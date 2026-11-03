import { describe, expect, it } from "vitest";
import { readReply } from "@/lib/marking/check";
import { extractJson } from "@/lib/marking/parse";
import { lineTotal } from "@/lib/marking/totals";
import { ANSWERS, QUESTIONS, SCHEMES } from "../fakes/marking-lab";
import type { Scheme } from "@/lib/marking-lab/schemas";

const question = QUESTIONS[0];
const scheme = SCHEMES.q1 as Scheme;
const answer = ANSWERS[0];
const read = (rawOutput: string, finishReason: string | null = "stop", s: Scheme | null = scheme) =>
  readReply({ rawOutput, finishReason, question, answer, scheme: s });
const good = JSON.stringify({ lines: { b: { marks: [1, 1, 1, 1] } }, reason: "fine" });

describe("extractJson", () => {
  it("reads plain, fenced and embedded JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":{"b":"}"}} done')).toEqual({ a: { b: "}" } });
  });
  it("skips a broken object and finds a later one", () => {
    expect(extractJson('{oops} then {"a":1}')).toEqual({ a: 1 });
  });
  it("returns undefined with no object", () => {
    expect(extractJson("about two marks")).toBeUndefined();
  });
});

describe("lineTotal", () => {
  it("adds marks, capped at the Line's marks", () => {
    expect(lineTotal([1, 0, 1], 3)).toBe(2);
    expect(lineTotal([1, 1, 1, 1, 1], 3)).toBe(3);
  });
});

describe("readReply", () => {
  it("caps the total when points add up to more than the Line is worth", () => {
    expect(read(good)).toEqual({
      readable: true,
      lines: { b: { marks: [1, 1, 1, 1], total: 3 } },
      reason: "fine",
    });
  });
  it("ignores a total the Model states when a scheme is used", () => {
    const r = read(JSON.stringify({ lines: { b: { marks: [1, 0, 0, 0], total: 3 } } }));
    expect(r).toMatchObject({ lines: { b: { total: 1 } } });
  });
  it("reads totals only without a scheme", () => {
    expect(read(JSON.stringify({ lines: { b: { total: 2 } } }), "stop", null)).toMatchObject({
      readable: true,
      lines: { b: { total: 2 } },
    });
  });
  it.each([
    ["no JSON", "about two marks"],
    ["empty", "   "],
    ["wrong shape", '{"marks":[1]}'],
    ["missing Line", '{"lines":{}}'],
    ["context-only Line", '{"lines":{"a":{"marks":[1]},"b":{"marks":[1,1,1,1]}}}'],
    ["wrong mark count", '{"lines":{"b":{"marks":[1,1]}}}'],
    ["mark above the point's worth", '{"lines":{"b":{"marks":[2,0,0,0]}}}'],
    ["negative mark", '{"lines":{"b":{"marks":[-1,0,0,0]}}}'],
    ["fractional mark", '{"lines":{"b":{"marks":[0.5,0,0,0]}}}'],
  ])("is unreadable: %s", (_name, raw) => {
    expect(read(raw).readable).toBe(false);
  });
  it("is unreadable when a total is out of range", () => {
    expect(read('{"lines":{"b":{"total":9}}}', "stop", null).readable).toBe(false);
  });
  it.each(["length", "content_filter"])("is unreadable on finish reason %s, even with valid JSON", (reason) => {
    expect(read(good, reason).readable).toBe(false);
  });
  it("only asks for Lines the student answered", () => {
    const blank = { ...answer, lines: {} };
    const r = readReply({ rawOutput: '{"lines":{}}', finishReason: "stop", question, answer: blank, scheme });
    expect(r).toMatchObject({ readable: true, lines: {} });
  });
});
