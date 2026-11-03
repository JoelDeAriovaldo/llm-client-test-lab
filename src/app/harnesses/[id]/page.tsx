import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { saveHarnessAction } from "@/app/actions";
import { HarnessEditor } from "@/components/harness-editor";
import { getDb } from "@/lib/db";
import { experiments, harnesses, harnessVersions } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function HarnessPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = getDb();
  const harness = db.select().from(harnesses).where(eq(harnesses.id, id)).get();
  if (!harness) notFound();
  const versions = db
    .select()
    .from(harnessVersions)
    .where(eq(harnessVersions.harnessId, id))
    .orderBy(desc(harnessVersions.version))
    .all();
  const latest = versions[0];
  const used = Boolean(db.select().from(experiments).where(eq(experiments.harnessVersionId, latest.id)).get());
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">{harness.name}</h1>
        <p className="text-sm text-muted-foreground">Version {latest.version}</p>
      </div>
      <HarnessEditor
        key={latest.hash}
        action={saveHarnessAction}
        harnessId={id}
        initialTemplate={latest.promptTemplate}
        initialUsesScheme={latest.usedMarkingScheme}
        submitLabel="Save"
        note={used ? `An Experiment has used v${latest.version}, so saving a change creates v${latest.version + 1}.` : undefined}
      />
      {versions.length > 1 && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">Version history</h2>
          {versions.slice(1).map((v) => (
            <details key={v.id} className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-sm">
                v{v.version}, {v.usedMarkingScheme ? "with" : "without"} Marking Scheme, {v.createdAt.slice(0, 10)}
              </summary>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{v.promptTemplate}</pre>
            </details>
          ))}
        </section>
      )}
    </>
  );
}
