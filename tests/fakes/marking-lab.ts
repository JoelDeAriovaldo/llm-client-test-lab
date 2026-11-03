import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Answer, Question } from "@/lib/marking-lab/schemas";

export const QUESTIONS: Question[] = [
  {
    id: "q1",
    stem: "A block has a mass of 10 g.",
    lines: [
      { label: "a", text: "Name the unit of mass.", marks: 1, answerLineUnit: null, marked: false },
      { label: "b", text: "Calculate the density.", marks: 3, answerLineUnit: "g/cm3", marked: true },
    ],
  },
  { id: "q2", stem: "Explain.", lines: [{ label: "main", text: "Why?", marks: 2, marked: true }] },
];

export const SCHEMES: Record<string, unknown> = {
  q1: {
    markedMarks: 3,
    lines: [
      {
        label: "b",
        marks: 3,
        points: [
          { code: "C1", type: "method", marks: 1, text: "formula" },
          { code: "C2", type: "method", marks: 1, text: "numbers" },
          { code: "A1", type: "final_answer", marks: 1, text: "answer" },
          { code: "B1", type: "independent", marks: 1, text: "unit" },
        ],
      },
    ],
  },
  q2: {
    markedMarks: 2,
    lines: [
      {
        label: "main",
        marks: 2,
        points: [
          { code: "B1", type: "independent", marks: 1, text: "one" },
          { code: "B2", type: "independent", marks: 1, text: "two" },
        ],
      },
    ],
  },
};

export const ANSWERS: Answer[] = [
  { id: "q1-a1", questionId: "q1", source: "synthetic", split: "open", tags: [], lines: { a: "gram", b: "d = 2" } },
  { id: "q1-a2", questionId: "q1", source: "real", split: "open", tags: [], lines: { b: "d = 3" } },
  { id: "q1-a3", questionId: "q1", source: "synthetic", split: "open", tags: [], lines: { a: "gram" } }, // No marked Line.
  { id: "q2-a1", questionId: "q2", source: "synthetic", split: "open", tags: [], lines: { main: "because" } },
];

type FakeRun = {
  id: number;
  body: Record<string, unknown>;
  datasetVersion: number;
  closed: boolean;
  withdrawn: boolean;
  results: { answerId: string; repeat: number; parseFailed: boolean }[];
};

/** An in-memory Marking Lab. It encodes our reading of the spec, so passing doesn't prove the real server agrees. */
export class FakeMarkingLab {
  server!: http.Server;
  url = "";
  version = 1;
  runs: FakeRun[] = [];
  maintainer = false;
  /** Store the next batch, then drop the connection before replying. */
  dropReplyAfterStore = false;
  /** Refuse the next batch with a 400, whatever it holds. */
  refuseNextBatch = false;
  /** Fail the next N batch posts with a 500, storing nothing. */
  failBatches = 0;
  /** Answers no Answer at all, as if the filter matched nothing. */
  noAnswers = false;
  afterRunStarted?: () => void;
  nextResultId = 100;

  async start(port = 0) {
    this.server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => this.handle(req, res, raw));
    });
    await new Promise<void>((resolve) => this.server.listen(port, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/api`;
    return this;
  }

  stop() {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(resolve));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, raw: string) {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== "Bearer msk_test") return send(401, { error: "Missing or unknown API key." });
    const url = new URL(req.url!, "http://x");
    const path = url.pathname.replace(/^\/api/, "");
    const body = raw ? JSON.parse(raw) : undefined;
    const version = Number(url.searchParams.get("version") ?? this.version);
    let m: RegExpMatchArray | null;

    if (path === "/dataset/version") return send(200, { datasetVersion: this.version, current: this.version });

    if ((m = path.match(/^\/questions\/([^/]+)\/scheme$/))) {
      const scheme = SCHEMES[m[1]];
      return scheme ? send(200, { datasetVersion: version, scheme }) : send(404, { error: "No such question" });
    }
    if ((m = path.match(/^\/questions\/([^/]+)$/))) {
      const question = QUESTIONS.find((q) => q.id === m![1]);
      return question ? send(200, { datasetVersion: version, question }) : send(404, { error: "No such question" });
    }
    if ((m = path.match(/^\/answers\/([^/]+)$/))) {
      const answer = ANSWERS.find((a) => a.id === m![1]);
      return answer ? send(200, { datasetVersion: version, answer }) : send(404, { error: "No such answer" });
    }
    if (path === "/answers") {
      const source = url.searchParams.get("source");
      const answers = this.noAnswers ? [] : ANSWERS.filter((a) => !source || a.source === source);
      const page = Number(url.searchParams.get("page") ?? 1);
      const pageSize = Number(url.searchParams.get("pageSize") ?? 100);
      return send(200, {
        datasetVersion: version,
        page,
        pageSize,
        total: answers.length,
        answers: answers.slice((page - 1) * pageSize, page * pageSize),
      });
    }

    if (path === "/runs" && req.method === "POST") {
      for (const field of ["harnessName", "gitCommit", "model", "usedMarkingScheme"]) {
        if (body[field] === undefined) return send(400, { error: `${field} is required` });
      }
      const run: FakeRun = {
        id: this.runs.length + 1,
        body,
        datasetVersion: body.datasetVersion ?? this.version,
        closed: false,
        withdrawn: false,
        results: [],
      };
      this.runs.push(run);
      this.afterRunStarted?.();
      return send(201, { runId: run.id, datasetVersion: run.datasetVersion, run: { id: run.id } });
    }

    if ((m = path.match(/^\/runs\/(\d+)(?:\/(\w+))?$/))) {
      const run = this.runs.find((r) => r.id === Number(m![1]));
      if (!run) return send(404, { error: `Run ${m[1]} does not exist` });
      const view = {
        id: run.id,
        datasetVersion: run.datasetVersion,
        closed: run.closed,
        withdrawn: run.withdrawn,
        results: run.results.length,
      };
      switch (m[2]) {
        case undefined:
          return send(200, { run: view });
        case "results":
          return this.submit(run, body.results, res, send);
        case "close":
          if (run.closed) return send(409, { error: `Run ${run.id} is already closed` });
          run.closed = true;
          return send(200, { runId: run.id, closed: true });
        case "withdraw":
          if (!this.maintainer) return send(403, { error: "Only maintainers can withdraw runs" });
          run.withdrawn = true;
          return send(200, { runId: run.id, withdrawn: true });
        case "score": {
          const overall = { results: run.results.length, exactTotalAgreement: 0.5, meanAbsError: 0.4, bias: -0.1 };
          return send(200, {
            runId: run.id,
            closed: run.closed,
            answersMarked: new Set(run.results.map((r) => r.answerId)).size,
            answersInSplit: ANSWERS.length,
            overall,
            ...(run.closed
              ? {
                  errorHistogram: [{ bucket: "0", count: 1 }],
                  byQuestion: { q1: overall },
                  disagreements: [{ answerId: "q1-a1", repeat: 1, reference: 2, harness: 1 }],
                }
              : {}),
          });
        }
      }
    }
    return send(404, { error: "Not found" });
  }

  private submit(
    run: FakeRun,
    results: Record<string, unknown>[],
    res: http.ServerResponse,
    send: (status: number, body: unknown) => void,
  ) {
    if (run.closed) return send(409, { error: `Run ${run.id} is closed; no more results can be added` });
    if (this.failBatches > 0) {
      this.failBatches--;
      return send(500, { error: "Temporarily broken" });
    }
    if (this.refuseNextBatch) {
      this.refuseNextBatch = false;
      return send(400, { error: "Refused", details: ["line b of q1 has 4 marking point(s) but 2 mark(s) were sent"] });
    }
    const problems = results.flatMap((r) => this.problems(r));
    if (problems.length > 0) return send(400, { error: problems[0], details: problems });

    const ids = results.map(() => this.nextResultId++);
    for (const r of results) {
      run.results.push({
        answerId: r.answerId as string,
        repeat: (r.repeat as number) ?? 1,
        parseFailed: Boolean(r.parseFailed),
      });
    }
    if (this.dropReplyAfterStore) {
      this.dropReplyAfterStore = false;
      res.destroy();
      return;
    }
    return send(201, { stored: results.length, runId: run.id, resultIds: ids });
  }

  private problems(result: Record<string, unknown>): string[] {
    const answer = ANSWERS.find((a) => a.id === result.answerId);
    if (!answer) return [`Answer ${String(result.answerId)} does not exist`];
    if (result.parseFailed) return result.lines ? ["parseFailed results carry no lines"] : [];
    const question = QUESTIONS.find((q) => q.id === answer.questionId)!;
    const lines = (result.lines ?? {}) as Record<string, { marks?: number[]; total: number }>;
    const problems: string[] = [];
    for (const [label, given] of Object.entries(lines)) {
      const line = question.lines.find((l) => l.label === label);
      if (!line?.marked) problems.push(`line ${label} of ${question.id} is not marked`);
      else if (given.total < 0 || given.total > line.marks) {
        problems.push(`line ${label} of ${question.id}: total ${given.total} is outside 0 to ${line.marks}`);
      }
    }
    for (const line of question.lines) {
      if (line.marked && line.label in answer.lines && !(line.label in lines)) {
        problems.push(`line ${line.label} of ${question.id} was not sent`);
      }
    }
    return problems;
  }
}
