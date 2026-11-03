import { z } from "zod";
import {
  AnswerSchema,
  QuestionSchema,
  RunSchema,
  SchemeSchema,
  ScoreSchema,
  type ResultSubmit,
  type RunStart,
} from "./schemas";

/** A reply from Marking Lab refusing a request. `message` is written for people; show it as is. */
export class MarkingLabError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "MarkingLabError";
  }
}

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const PAGE_SIZE = 500;

export class MarkingLabClient {
  constructor(
    private readonly baseUrl: string,
    private readonly key: string,
  ) {}

  private async request(path: string, init?: { method: string; body?: unknown }) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.key}`,
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const parsed = ErrorBody.safeParse(json);
      throw new MarkingLabError(
        res.status,
        parsed.success ? parsed.data.error : `Marking Lab replied ${res.status}`,
        parsed.success ? parsed.data.details : [],
      );
    }
    return json;
  }

  async datasetVersion() {
    const body = await this.request("/dataset/version");
    return z.object({ datasetVersion: z.number().int(), current: z.number().int().optional() }).parse(body);
  }

  async question(id: string, version: number) {
    const body = await this.request(`/questions/${encodeURIComponent(id)}?version=${version}`);
    return z.object({ question: QuestionSchema }).parse(body).question;
  }

  async scheme(id: string, version: number) {
    const body = await this.request(`/questions/${encodeURIComponent(id)}/scheme?version=${version}`);
    return z.object({ scheme: SchemeSchema }).parse(body).scheme;
  }

  async answer(id: string, version: number) {
    const body = await this.request(`/answers/${encodeURIComponent(id)}?version=${version}`);
    return z.object({ answer: AnswerSchema }).parse(body).answer;
  }

  /** Every open Answer at this version, across all pages. */
  async answers(version: number, source: string | null) {
    const all: z.infer<typeof AnswerSchema>[] = [];
    const Page = z.object({ total: z.number().int(), answers: z.array(AnswerSchema) });
    for (let page = 1; ; page++) {
      const query = new URLSearchParams({
        version: String(version),
        page: String(page),
        pageSize: String(PAGE_SIZE),
        ...(source ? { source } : {}),
      });
      const body = Page.parse(await this.request(`/answers?${query}`));
      all.push(...body.answers);
      if (all.length >= body.total || body.answers.length === 0) return all;
    }
  }

  async startRun(run: RunStart) {
    const body = await this.request("/runs", { method: "POST", body: run });
    return z.object({ runId: z.number().int(), datasetVersion: z.number().int() }).parse(body);
  }

  async run(id: number) {
    const body = await this.request(`/runs/${id}`);
    return z.object({ run: RunSchema }).parse(body).run;
  }

  async submitResults(runId: number, results: ResultSubmit[]) {
    const body = await this.request(`/runs/${runId}/results`, { method: "POST", body: { results } });
    return z.object({ stored: z.number().int(), resultIds: z.array(z.number().int()) }).parse(body);
  }

  async closeRun(id: number) {
    await this.request(`/runs/${id}/close`, { method: "POST" });
  }

  async score(id: number) {
    return ScoreSchema.parse(await this.request(`/runs/${id}/score`));
  }

  async withdrawRun(id: number, reason: string) {
    await this.request(`/runs/${id}/withdraw`, { method: "POST", body: { reason } });
  }
}

export function markingLabFromEnv() {
  const url = process.env.MARKING_LAB_URL;
  const key = process.env.MARKING_LAB_KEY;
  if (!url || !key) throw new Error("Set MARKING_LAB_URL and MARKING_LAB_KEY in .env.local, then restart.");
  return new MarkingLabClient(url.replace(/\/$/, ""), key);
}
