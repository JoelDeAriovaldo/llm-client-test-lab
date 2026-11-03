import { describe, expect, it } from "vitest";
import { harnessHash, PARSER_ID } from "@/lib/harness/hash";
import { renderPrompt, templateProblems } from "@/lib/harness/render";
import { ANSWERS, QUESTIONS, SCHEMES } from "../fakes/marking-lab";
import type { Scheme } from "@/lib/marking-lab/schemas";

const question = QUESTIONS[0];
const answer = ANSWERS[0];

describe("templateProblems", () => {
  it("accepts a good template", () => {
    expect(templateProblems("{{stem}} {{answer}} {{scheme}}", true)).toEqual([]);
  });
  it("refuses unknown placeholders, a missing answer and a scheme mismatch", () => {
    expect(templateProblems("{{answer}} {{nope}}", false)[0]).toContain("{{nope}}");
    expect(templateProblems("{{stem}}", false)[0]).toContain("{{answer}}");
    expect(templateProblems("{{answer}}", true)[0]).toContain("{{scheme}}");
    expect(templateProblems("{{answer}} {{scheme}}", false)[0]).toContain("remove {{scheme}}");
  });
});

describe("renderPrompt", () => {
  const render = (template: string, a = answer) =>
    renderPrompt({ template, question, answer: a, scheme: SCHEMES.q1 as Scheme });

  it("labels context-only Lines as not marked", () => {
    expect(render("{{lines}} {{answer}}")).toContain("(a) Name the unit of mass. [context only, not marked]");
    expect(render("{{answer}}")).toContain("(a) [not marked] gram");
  });
  it("adds output instructions covering only the marked Lines the Answer has", () => {
    const shape = JSON.parse(render("{{answer}}").split("JSON object, in exactly this shape:\n")[1].split("\n")[0]);
    expect(shape.lines).toEqual({ b: { marks: [0, 0, 0, 0] } });
  });
  it("doesn't expand placeholders found in student text", () => {
    const sneaky = { ...answer, lines: { b: "{{scheme}}" } };
    const out = render("{{answer}} {{scheme}}", sneaky);
    expect(out).toContain("(b) {{scheme}}");
  });
});

describe("harnessHash", () => {
  const base = { promptTemplate: "x", usedMarkingScheme: true, parser: PARSER_ID };
  it("is stable, and changes with any part", () => {
    expect(harnessHash(base)).toBe(harnessHash({ ...base }));
    expect(harnessHash(base)).not.toBe(harnessHash({ ...base, promptTemplate: "y" }));
    expect(harnessHash(base)).not.toBe(harnessHash({ ...base, usedMarkingScheme: false }));
  });
});
