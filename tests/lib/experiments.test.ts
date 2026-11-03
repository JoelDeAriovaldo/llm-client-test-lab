import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { comparabilityWarnings, type ComparedRun } from "@/lib/experiments/comparability";
import { answerFilterFor } from "@/lib/experiments/create";
import { estimateCostUsd } from "@/lib/experiments/estimate";
import { getCodeState } from "@/lib/git";
import { callCost } from "@/lib/llm/cost";
import { classifyFailure } from "@/lib/llm/errors";
import { sampleAcrossQuestions } from "@/worker/trial";

const run: ComparedRun = {
  label: "A",
  datasetVersion: 1,
  answerSource: "synthetic",
  harnessHash: "h",
  expectedAnswers: 10,
  answersMarked: 10,
  dirty: false,
  repeats: 1,
  temperature: 0,
  closed: true,
};

describe("comparabilityWarnings", () => {
  it("is empty for matching Runs", () => {
    expect(comparabilityWarnings([run, { ...run, label: "B" }])).toEqual([]);
  });
  it.each([
    ["Dataset Versions", { datasetVersion: 2 }],
    ["sets of Answers", { answerSource: null }],
    ["Harness Versions", { harnessHash: "other" }],
    ["only 5 of 10", { answersMarked: 5 }],
    ["isn't closed", { closed: false }],
    ["uncommitted", { dirty: true }],
    ["temperature 0", { repeats: 2 }],
  ])("warns about %s", (text, change) => {
    expect(comparabilityWarnings([run, { ...run, label: "B", ...change }]).join(" ")).toContain(text);
  });
});

describe("answerFilterFor", () => {
  it("is synthetic if any Connection is cloud, unless overridden", () => {
    expect(answerFilterFor(["local", "cloud"], false)).toEqual({ source: "synthetic" });
    expect(answerFilterFor(["cloud"], true)).toEqual({ source: null });
    expect(answerFilterFor(["local"], false)).toEqual({ source: null });
  });
});

describe("costs", () => {
  const prices = { inputPricePerMillion: 2, outputPricePerMillion: 10 };
  const usage = { providerCostUsd: null, inputTokens: 1000, outputTokens: 100 };
  it("treats local as free and unpriced cloud as unknown", () => {
    expect(callCost({ locality: "local", ...usage, inputPricePerMillion: null, outputPricePerMillion: null })).toBe(0);
    expect(callCost({ locality: "cloud", ...usage, inputPricePerMillion: null, outputPricePerMillion: null })).toBeNull();
  });
  it("prefers the provider's figure", () => {
    expect(callCost({ locality: "cloud", ...usage, ...prices, providerCostUsd: 0.5 })).toBe(0.5);
    expect(callCost({ locality: "cloud", ...usage, ...prices })).toBeCloseTo(0.003);
  });
  it("estimates an upper bound", () => {
    expect(
      estimateCostUsd({ answerCount: 10, repeats: 2, averagePromptChars: 4000, maxTokens: 500, locality: "cloud", ...prices }),
    ).toBeCloseTo(0.14);
    expect(
      estimateCostUsd({ answerCount: 10, repeats: 1, averagePromptChars: 1, maxTokens: 1, locality: "cloud", inputPricePerMillion: null, outputPricePerMillion: 1 }),
    ).toBeNull();
  });
});

describe("classifyFailure", () => {
  const err = (status?: number, message = "x") => Object.assign(new Error(message), { status });
  it.each([[undefined], [429], [500], [503], [408]])("retries %s", (status) => {
    expect(classifyFailure(err(status)).kind).toBe("retryable");
  });
  it.each([[400], [401], [403], [404]])("stops on %s", (status) => {
    expect(classifyFailure(err(status)).kind).toBe("configuration");
  });
  it("spots a refused response_format", () => {
    expect(classifyFailure(err(400, "json_schema is not supported")).kind).toBe("format_refused");
  });
  it("honours Retry-After", () => {
    const e = Object.assign(err(429), { headers: new Headers({ "retry-after": "7" }) });
    expect(classifyFailure(e)).toMatchObject({ retryAfterMs: 7000 });
  });
});

describe("sampleAcrossQuestions", () => {
  const answers = ["q1", "q2", "q3"].flatMap((questionId) =>
    Array.from({ length: 20 }, (_, i) => ({ id: `${questionId}-${i}`, questionId, lines: {} })),
  );
  it("spreads across Questions and is repeatable", () => {
    const sample = sampleAcrossQuestions(answers, 10, 42);
    expect(sample).toHaveLength(10);
    const perQuestion = (q: string) => sample.filter((a) => a.questionId === q).length;
    expect(Math.max(perQuestion("q1"), perQuestion("q2"), perQuestion("q3"))).toBeLessThanOrEqual(4);
    expect(sampleAcrossQuestions(answers, 10, 42)).toEqual(sample);
  });
  it("copes with fewer Answers than asked for", () => {
    expect(sampleAcrossQuestions(answers.slice(0, 3), 10, 1)).toHaveLength(3);
  });
});

describe("getCodeState", () => {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });
  it("reports the commit and uncommitted changes, and explains having no commit", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-git-"));
    git(dir, "init", "-q");
    expect(() => getCodeState(dir)).toThrow("no git commit");
    fs.writeFileSync(path.join(dir, "a"), "1");
    git(dir, "add", ".");
    git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x");
    expect(getCodeState(dir).dirty).toBe(false);
    fs.writeFileSync(path.join(dir, "a"), "2");
    expect(getCodeState(dir).dirty).toBe(true);
  });
});
