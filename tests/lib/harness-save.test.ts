import { describe, expect, it } from "vitest";
import { harnessVersions } from "@/lib/db/schema";
import { createExperiment } from "@/lib/experiments/create";
import { createHarness, saveHarness } from "@/lib/harness/save";
import { eq } from "drizzle-orm";
import { connections } from "@/lib/db/schema";
import { tempDb } from "../worker/helpers";

describe("saveHarness", () => {
  it("edits an unused version in place, and creates a new version once used", () => {
    const db = tempDb();
    const id = createHarness(db, "h", "{{answer}}", false);
    const versions = () => db.select().from(harnessVersions).where(eq(harnessVersions.harnessId, id)).all();

    saveHarness(db, id, "first {{answer}}", false);
    expect(versions()).toHaveLength(1);
    expect(versions()[0].promptTemplate).toBe("first {{answer}}");

    const connection = db.insert(connections).values({ name: "c", baseUrl: "http://x", locality: "local", concurrency: 1 }).returning().get();
    createExperiment(db, {
      name: "e",
      harnessVersionId: versions()[0].id,
      repeats: 1,
      allowRealOnCloud: false,
      spendLimitUsd: null,
      models: [{ connectionId: connection.id, modelName: "m", settings: { temperature: 0, maxTokens: 10 }, inputPricePerMillion: null, outputPricePerMillion: null }],
    });

    saveHarness(db, id, "second {{answer}}", false);
    expect(versions().map((v) => v.promptTemplate)).toEqual(["first {{answer}}", "second {{answer}}"]);
    expect(versions()[1].version).toBe(2);
    expect(versions()[0].hash).not.toBe(versions()[1].hash);
  });

  it("does nothing when unchanged, and refuses a bad template", () => {
    const db = tempDb();
    const id = createHarness(db, "h", "{{answer}}", false);
    saveHarness(db, id, "{{answer}}", false);
    expect(db.select().from(harnessVersions).where(eq(harnessVersions.harnessId, id)).all()).toHaveLength(1);
    expect(() => saveHarness(db, id, "no placeholder", false)).toThrow("{{answer}}");
  });
});
