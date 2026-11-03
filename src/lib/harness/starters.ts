import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { harnesses, harnessVersions } from "@/lib/db/schema";
import { harnessHash, PARSER_ID } from "./hash";

const INTRO = "You are an experienced examiner marking a student's exam answer. Mark only what the student wrote.";

const STARTERS = [
  {
    name: "Starter: with Marking Scheme",
    usedMarkingScheme: true,
    promptTemplate: `${INTRO}

Question:
{{stem}}
{{lines}}

Marking scheme:
{{scheme}}

Student's answer:
{{answer}}`,
  },
  {
    name: "Starter: without Marking Scheme",
    usedMarkingScheme: false,
    promptTemplate: `${INTRO}

Question:
{{stem}}
{{lines}}

Student's answer:
{{answer}}`,
  },
];

export function seedStarterHarnesses(db: Db) {
  for (const s of STARTERS) {
    if (db.select().from(harnesses).where(eq(harnesses.name, s.name)).get()) continue;
    const harness = db.insert(harnesses).values({ name: s.name }).returning().get();
    db.insert(harnessVersions)
      .values({
        harnessId: harness.id,
        version: 1,
        promptTemplate: s.promptTemplate,
        usedMarkingScheme: s.usedMarkingScheme,
        parser: PARSER_ID,
        hash: harnessHash({ ...s, parser: PARSER_ID }),
      })
      .run();
  }
}
