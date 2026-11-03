import { desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { experiments, harnesses, harnessVersions } from "@/lib/db/schema";
import { harnessHash, PARSER_ID } from "./hash";
import { templateProblems } from "./render";

export function createHarness(db: Db, name: string, promptTemplate: string, usedMarkingScheme: boolean): number {
  const problems = templateProblems(promptTemplate, usedMarkingScheme);
  if (problems.length > 0) throw new Error(problems.join(" "));
  return db.transaction((tx) => {
    const harness = tx.insert(harnesses).values({ name }).returning().get();
    tx.insert(harnessVersions)
      .values({
        harnessId: harness.id,
        version: 1,
        promptTemplate,
        usedMarkingScheme,
        parser: PARSER_ID,
        hash: harnessHash({ promptTemplate, usedMarkingScheme, parser: PARSER_ID }),
      })
      .run();
    return harness.id;
  });
}

/** An Experiment's record must keep the prompt it ran, so a used Harness Version never changes. */
export function saveHarness(db: Db, harnessId: number, promptTemplate: string, usedMarkingScheme: boolean) {
  const problems = templateProblems(promptTemplate, usedMarkingScheme);
  if (problems.length > 0) throw new Error(problems.join(" "));
  const hash = harnessHash({ promptTemplate, usedMarkingScheme, parser: PARSER_ID });
  const latest = db
    .select()
    .from(harnessVersions)
    .where(eq(harnessVersions.harnessId, harnessId))
    .orderBy(desc(harnessVersions.version))
    .get();
  if (!latest) throw new Error("This Harness has no versions.");
  if (latest.hash === hash) return;

  const used = db.select().from(experiments).where(eq(experiments.harnessVersionId, latest.id)).get();
  if (used) {
    db.insert(harnessVersions)
      .values({ harnessId, version: latest.version + 1, promptTemplate, usedMarkingScheme, parser: PARSER_ID, hash })
      .run();
  } else {
    db.update(harnessVersions)
      .set({ promptTemplate, usedMarkingScheme, hash })
      .where(eq(harnessVersions.id, latest.id))
      .run();
  }
}
