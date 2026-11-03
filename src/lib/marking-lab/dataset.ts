import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { datasetCache } from "@/lib/db/schema";
import type { MarkingLabClient } from "./client";
import type { Answer, Question, Scheme } from "./schemas";

type Kind = (typeof datasetCache.$inferSelect)["kind"];

/** Reads through a local cache. A Dataset Version never changes, so entries never go stale. */
export class Dataset {
  constructor(
    private readonly db: Db,
    private readonly lab: MarkingLabClient,
  ) {}

  private read<T>(version: number, kind: Kind, externalId: string): T | undefined {
    const row = this.db
      .select({ body: datasetCache.body })
      .from(datasetCache)
      .where(
        and(
          eq(datasetCache.version, version),
          eq(datasetCache.kind, kind),
          eq(datasetCache.externalId, externalId),
        ),
      )
      .get();
    return row?.body as T | undefined;
  }

  private write(version: number, kind: Kind, externalId: string, body: unknown) {
    this.db.insert(datasetCache).values({ version, kind, externalId, body }).onConflictDoNothing().run();
  }

  async question(id: string, version: number): Promise<Question> {
    const cached = this.read<Question>(version, "question", id);
    if (cached) return cached;
    const fresh = await this.lab.question(id, version);
    this.write(version, "question", id, fresh);
    return fresh;
  }

  async scheme(id: string, version: number): Promise<Scheme> {
    const cached = this.read<Scheme>(version, "scheme", id);
    if (cached) return cached;
    const fresh = await this.lab.scheme(id, version);
    this.write(version, "scheme", id, fresh);
    return fresh;
  }

  async answer(id: string, version: number): Promise<Answer> {
    const cached = this.read<Answer>(version, "answer", id);
    if (cached) return cached;
    const fresh = await this.lab.answer(id, version);
    this.write(version, "answer", id, fresh);
    return fresh;
  }

  async answers(version: number, source: string | null): Promise<Answer[]> {
    const key = source ?? "all";
    const cachedIds = this.read<string[]>(version, "answer_list", key);
    if (cachedIds) return Promise.all(cachedIds.map((id) => this.answer(id, version)));
    const fresh = await this.lab.answers(version, source);
    for (const a of fresh) this.write(version, "answer", a.id, a);
    this.write(version, "answer_list", key, fresh.map((a) => a.id));
    return fresh;
  }

  /** Answers worth a Call: those with at least one marked Line the student answered. */
  async eligibleAnswers(version: number, source: string | null): Promise<Answer[]> {
    const answers = await this.answers(version, source);
    const eligible: Answer[] = [];
    for (const answer of answers) {
      const question = await this.question(answer.questionId, version);
      if (question.lines.some((l) => l.marked && l.label in answer.lines)) eligible.push(answer);
    }
    return eligible;
  }
}
