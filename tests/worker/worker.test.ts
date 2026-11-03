import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { calls, experiments, scoreSnapshots, submissionBatches } from "@/lib/db/schema";
import { requestClose, requestTrial, resumeExperiment, startExperiment } from "@/lib/experiments/control";
import { goodReply, httpError, reply, setup } from "./helpers";
import type { FakeMarkingLab } from "../fakes/marking-lab";

let fake: FakeMarkingLab | undefined;
afterEach(async () => {
  await fake?.stop();
  fake = undefined;
});

async function tickUntil(worker: { tick(): void }, done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i++) {
    worker.tick();
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(done()).toBe(true);
}

async function start(options?: Parameters<typeof setup>[0]) {
  const s = await setup(options);
  fake = s.fake;
  return s;
}

describe("a full Experiment", () => {
  it("marks, submits, closes and saves a Score for each Model", async () => {
    const s = await start({ models: ["model-a", "model-b"] });
    startExperiment(s.db, s.experimentId);
    await s.makeWorker(async (req) => reply(goodReply(req))).drain();

    expect(s.experiment().status).toBe("finished");
    expect(s.models().map((m) => m.status)).toEqual(["closed", "closed"]);
    expect(s.fake.runs).toHaveLength(2);
    expect(s.fake.runs.every((r) => r.closed)).toBe(true);
    // Cloud: synthetic only. q1-a2 is real, and q1-a3 has no marked Line, so 2 of 4 Answers.
    expect(s.fake.runs[0].results.map((r) => r.answerId).sort()).toEqual(["q1-a1", "q2-a1"]);
    expect(s.db.select().from(scoreSnapshots).all()).toHaveLength(2);
    expect(s.allCalls().every((c) => c.resultId !== null)).toBe(true);
  });

  it("sends the code state, Harness hash and Answer filter on each Run", async () => {
    const s = await start();
    startExperiment(s.db, s.experimentId);
    await s.makeWorker(async (req) => reply(goodReply(req))).drain();
    const body = s.fake.runs[0].body;
    expect(body.gitCommit).toBe("abc1234");
    expect(body.dirty).toBe(false);
    expect(body.split).toBe("open");
    expect(body.extra).toMatchObject({ answerFilter: { source: "synthetic" }, experimentId: s.experimentId });
    expect((body.extra as { harnessHash: string }).harnessHash).toHaveLength(64);
  });

  it("includes real Answers when every Connection is local", async () => {
    const s = await start({ locality: "local" });
    startExperiment(s.db, s.experimentId);
    await s.makeWorker(async (req) => reply(goodReply(req))).drain();
    expect(s.fake.runs[0].results.map((r) => r.answerId).sort()).toEqual(["q1-a1", "q1-a2", "q2-a1"]);
    expect(s.allCalls().every((c) => c.costUsd === 0)).toBe(true);
  });

  it("pins later Runs to the first Run's Dataset Version", async () => {
    const s = await start({ models: ["model-a", "model-b"] });
    s.fake.version = 7;
    s.fake.afterRunStarted = () => {
      s.fake.version = 8;
    };
    startExperiment(s.db, s.experimentId);
    await s.makeWorker(async (req) => reply(goodReply(req))).drain();
    expect(s.fake.runs.map((r) => r.datasetVersion)).toEqual([7, 7]);
    expect(s.experiment().datasetVersion).toBe(7);
  });

  it("makes one Call per repeat and sends the repeat number", async () => {
    const s = await start({ repeats: 2 });
    startExperiment(s.db, s.experimentId);
    await s.makeWorker(async (req) => reply(goodReply(req))).drain();
    expect(s.fake.runs[0].results.filter((r) => r.answerId === "q1-a1").map((r) => r.repeat).sort()).toEqual([1, 2]);
  });
});

describe("Trials", () => {
  it("makes local Calls only, and never touches a Run", async () => {
    const s = await start();
    requestTrial(s.db, s.experimentId);
    await s.makeWorker(async (req) => reply(goodReply(req))).drain();
    expect(s.experiment().trialStatus).toBe("done");
    expect(s.experiment().status).toBe("draft");
    expect(s.fake.runs).toHaveLength(0);
    expect(s.allCalls().length).toBeGreaterThan(0);
    expect(s.allCalls().every((c) => c.isTrial)).toBe(true);
  });

  it("doesn't reuse Trial Calls in the full Experiment", async () => {
    const s = await start();
    requestTrial(s.db, s.experimentId);
    const worker = s.makeWorker(async (req) => reply(goodReply(req)));
    await worker.drain();
    const trialCount = s.allCalls().length;
    startExperiment(s.db, s.experimentId);
    await worker.drain();
    expect(s.allCalls().filter((c) => !c.isTrial)).toHaveLength(trialCount);
    expect(s.fake.runs[0].results).toHaveLength(trialCount);
  });

  it("replaces an earlier Trial", async () => {
    const s = await start();
    const worker = s.makeWorker(async (req) => reply(goodReply(req)));
    requestTrial(s.db, s.experimentId);
    await worker.drain();
    const first = s.allCalls().length;
    requestTrial(s.db, s.experimentId);
    await worker.drain();
    expect(s.allCalls()).toHaveLength(first);
    expect(s.experiment().trialStatus).toBe("done");
  });

  it("fails the rest of a Model's Trial on a configuration error", async () => {
    const s = await start();
    requestTrial(s.db, s.experimentId);
    await s.makeWorker(async () => { throw httpError(401, "bad key"); }).drain();
    expect(s.experiment().trialStatus).toBe("done");
    expect(s.allCalls().every((c) => c.status === "failed" && c.error === "bad key")).toBe(true);
  });
});

describe("no eligible Answers", () => {
  it("fails a Trial with a plain reason", async () => {
    const s = await start();
    s.fake.noAnswers = true;
    requestTrial(s.db, s.experimentId);
    await s.makeWorker(async () => reply("")).drain();
    expect(s.experiment().trialStatus).toBe("failed");
    expect(s.experiment().error).toContain("No Answers match");
  });

  it("pauses an Experiment rather than closing empty Runs", async () => {
    const s = await start();
    s.fake.noAnswers = true;
    startExperiment(s.db, s.experimentId);
    await s.makeWorker(async () => reply("")).drain();
    expect(s.experiment().status).toBe("paused");
    expect(s.fake.runs[0].closed).toBe(false);
  });
});

describe("failures", () => {
  it("submits an Unreadable Reply as parseFailed, without retrying", async () => {
    const s = await start();
    startExperiment(s.db, s.experimentId);
    let requests = 0;
    await s.makeWorker(async () => { requests++; return reply("about two marks"); }).drain();
    expect(requests).toBe(2);
    expect(s.fake.runs[0].results.every((r) => r.parseFailed)).toBe(true);
    expect(s.allCalls().every((c) => c.status === "unreadable" && c.unreadableReason)).toBe(true);
    expect(s.models()[0].status).toBe("closed");
  });

  it("counts a truncated reply as unreadable even if the JSON parses", async () => {
    const s = await start();
    startExperiment(s.db, s.experimentId);
    await s.makeWorker(async (req) => reply(goodReply(req), { finishReason: "length" })).drain();
    expect(s.allCalls().every((c) => c.status === "unreadable")).toBe(true);
  });

  it("retries provider errors without counting them against the Model", async () => {
    const s = await start();
    startExperiment(s.db, s.experimentId);
    const seen = new Map<string, number>();
    await s.makeWorker(async (req) => {
      const n = (seen.get(req.prompt) ?? 0) + 1;
      seen.set(req.prompt, n);
      if (n === 1) throw httpError(429);
      return reply(goodReply(req));
    }).drain();
    expect(s.allCalls().every((c) => c.status === "succeeded" && c.attempts === 2)).toBe(true);
    expect(s.fake.runs[0].results.every((r) => !r.parseFailed)).toBe(true);
  });

  it("leaves the Run open after repeated provider errors, and Resume finishes it", async () => {
    const s = await start();
    startExperiment(s.db, s.experimentId);
    await s.makeWorker(async (req) => {
      if (req.prompt.includes("Why?")) throw httpError(503);
      return reply(goodReply(req));
    }).drain();
    expect(s.models()[0].status).toBe("needs_attention");
    expect(s.experiment().status).toBe("paused");
    expect(s.fake.runs[0].closed).toBe(false);
    expect(s.fake.runs[0].results.map((r) => r.answerId)).toEqual(["q1-a1"]); // Never parseFailed.
    expect(s.db.select().from(scoreSnapshots).all()).toHaveLength(1); // Summary figures.

    resumeExperiment(s.db, s.experimentId);
    await s.makeWorker(async (req) => reply(goodReply(req))).drain();
    expect(s.experiment().status).toBe("finished");
    expect(s.fake.runs[0].closed).toBe(true);
    expect(s.fake.runs[0].results).toHaveLength(2);
  });

  it("stops a Model right away on a configuration error, and Close anyway closes it", async () => {
    const s = await start();
    startExperiment(s.db, s.experimentId);
    let requests = 0;
    await s.makeWorker(async () => { requests++; throw httpError(401, "bad key"); }).drain();
    expect(requests).toBeLessThanOrEqual(3);
    expect(s.models()[0]).toMatchObject({ status: "needs_attention", error: "bad key" });

    requestClose(s.db, s.models()[0].id);
    await s.makeWorker(async () => { throw new Error("unused"); }).drain();
    expect(s.models()[0].status).toBe("closed");
    expect(s.fake.runs[0].closed).toBe(true);
    expect(s.experiment().status).toBe("finished");
  });

  it("falls back to no response_format when the endpoint refuses it", async () => {
    const s = await start();
    startExperiment(s.db, s.experimentId);
    await s.makeWorker(async (req) => {
      if (req.jsonSchema) throw httpError(400, "response_format is not supported");
      return reply(goodReply(req));
    }).drain();
    expect(s.models()[0].useResponseFormat).toBe(false);
    expect(s.allCalls().every((c) => c.status === "succeeded")).toBe(true);
  });

  it("pauses at the spending limit, and resumes when it's raised", async () => {
    const s = await start({ spendLimitUsd: 0.0001, repeats: 3 });
    startExperiment(s.db, s.experimentId);
    const worker = s.makeWorker(async (req) => reply(goodReply(req), { providerCostUsd: 0.001 }));
    await worker.drain();
    expect(s.experiment().status).toBe("paused");
    expect(s.experiment().error).toContain("spending limit");

    resumeExperiment(s.db, s.experimentId, 100);
    await worker.drain();
    expect(s.experiment().status).toBe("finished");
  });

  it("reports a failure to start on the Experiment", async () => {
    const s = await start();
    s.db.update(experiments).set({ status: "queued" }).where(eq(experiments.id, s.experimentId)).run();
    const worker = s.makeWorker(async () => reply(""));
    (worker as unknown as { deps: { codeState: () => never } }).deps.codeState = () => {
      throw new Error("no commit");
    };
    await worker.drain();
    expect(s.experiment()).toMatchObject({ status: "paused" });
    expect(s.experiment().error).toContain("no commit");
  });
});

describe("submission safety", () => {
  it("sends in batches, one at a time", async () => {
    const s = await start({ repeats: 3 });
    startExperiment(s.db, s.experimentId);
    await s.makeWorker(async (req) => reply(goodReply(req))).drain();
    const batches = s.db.select().from(submissionBatches).all();
    expect(batches.map((b) => b.callCount)).toEqual([2, 2, 2]);
    expect(batches.map((b) => b.runResultsBefore)).toEqual([0, 2, 4]);
  });

  it("never resends a batch that was stored before the reply was lost", async () => {
    const s = await start();
    s.fake.dropReplyAfterStore = true;
    startExperiment(s.db, s.experimentId);
    await s.makeWorker(async (req) => reply(goodReply(req))).drain();
    expect(s.fake.runs[0].results).toHaveLength(2);
    expect(s.models()[0].status).toBe("closed");
    const [batch] = s.db.select().from(submissionBatches).all();
    expect(batch).toMatchObject({ status: "stored", resultIds: null });
  });

  it("resends a batch that never arrived", async () => {
    const s = await start();
    s.fake.failBatches = 1;
    startExperiment(s.db, s.experimentId);
    await s.makeWorker(async (req) => reply(goodReply(req))).drain();
    expect(s.fake.runs[0].results).toHaveLength(2);
    expect(s.db.select().from(submissionBatches).all()).toHaveLength(1);
  });

  it("recovers a batch left 'sending' by a crash, without resending", async () => {
    const s = await start();
    s.fake.dropReplyAfterStore = true;
    startExperiment(s.db, s.experimentId);
    const dying = s.makeWorker(async (req) => reply(goodReply(req)));
    // Make the retry path fatal, to act like a process that died right after the POST.
    (dying as unknown as { sleep: () => Promise<void> }).sleep = () => new Promise(() => undefined);
    await tickUntil(dying, () => s.db.select().from(submissionBatches).all().length > 0 && s.fake.runs[0].results.length > 0);
    expect(s.db.select().from(submissionBatches).all()[0].status).toBe("sending");

    const next = s.makeWorker(async (req) => reply(goodReply(req)));
    next.recover();
    await next.drain();
    expect(s.fake.runs[0].results).toHaveLength(2);
    expect(s.models()[0].status).toBe("closed");
  });

  it("stops rather than guess when the stored count makes no sense", async () => {
    const s = await start();
    s.fake.dropReplyAfterStore = true;
    startExperiment(s.db, s.experimentId);
    const dying = s.makeWorker(async (req) => reply(goodReply(req)));
    (dying as unknown as { sleep: () => Promise<void> }).sleep = () => new Promise(() => undefined);
    await tickUntil(dying, () => s.db.select().from(submissionBatches).all().length > 0 && s.fake.runs[0].results.length > 0);
    s.fake.runs[0].results.push({ answerId: "x", repeat: 1, parseFailed: false });

    await s.makeWorker(async (req) => reply(goodReply(req))).drain();
    expect(s.models()[0].status).toBe("needs_attention");
    expect(s.models()[0].error).toContain("Can't tell");
  });

  it("stops on a refused batch, stores nothing, and sends it again after Resume", async () => {
    const s = await start();
    s.fake.refuseNextBatch = true;
    startExperiment(s.db, s.experimentId);
    const worker = s.makeWorker(async (req) => reply(goodReply(req)));
    await worker.drain();
    expect(s.models()[0].status).toBe("needs_attention");
    expect(s.models()[0].error).toContain("2 mark(s) were sent");
    expect(s.fake.runs[0].results).toHaveLength(0);

    resumeExperiment(s.db, s.experimentId);
    await worker.drain();
    expect(s.fake.runs[0].results).toHaveLength(2);
    expect(s.models()[0].status).toBe("closed");
  });

  it("resumes after a crash without repeating finished Calls", async () => {
    const s = await start();
    startExperiment(s.db, s.experimentId);
    let requests = 0;
    const first = s.makeWorker(async (req) => {
      requests++;
      if (req.prompt.includes("Why?")) return new Promise(() => undefined); // Dies mid-Call.
      return reply(goodReply(req));
    });
    first.tick();
    await new Promise((r) => setTimeout(r, 200));
    first.tick();
    await new Promise((r) => setTimeout(r, 200));
    expect(s.allCalls().map((c) => c.status).sort()).toEqual(["in_flight", "succeeded"]);
    const before = requests;

    const second = s.makeWorker(async (req) => { requests++; return reply(goodReply(req)); });
    second.recover();
    await second.drain();
    expect(requests).toBe(before + 1);
    expect(s.fake.runs[0].results).toHaveLength(2);
    expect(s.db.select().from(calls).where(eq(calls.status, "succeeded")).all()).toHaveLength(2);
  });
});
