import { asc, desc, eq } from "drizzle-orm";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { NewExperimentForm } from "@/components/new-experiment-form";
import { getDb } from "@/lib/db";
import { connections, harnesses, harnessVersions } from "@/lib/db/schema";
import { getCodeState } from "@/lib/git";

export const dynamic = "force-dynamic";

function codeWarning(): string | null {
  try {
    return getCodeState().dirty
      ? "This app's code has uncommitted changes. You can still run, but each Run will be sent with dirty: true."
      : null;
  } catch (err) {
    return (err as Error).message;
  }
}

export default function NewExperimentPage() {
  const db = getDb();
  const latest = new Map<number, { versionId: number; label: string }>();
  const versions = db
    .select({ version: harnessVersions, name: harnesses.name })
    .from(harnessVersions)
    .innerJoin(harnesses, eq(harnessVersions.harnessId, harnesses.id))
    .orderBy(desc(harnessVersions.version))
    .all();
  for (const { version, name } of versions) {
    if (!latest.has(version.harnessId)) {
      latest.set(version.harnessId, { versionId: version.id, label: `${name} v${version.version}` });
    }
  }
  const warning = codeWarning();
  return (
    <>
      <h1 className="text-2xl font-semibold">New Experiment</h1>
      {warning && (
        <Alert>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      )}
      <NewExperimentForm
        harnesses={[...latest.values()]}
        connections={db
          .select({ id: connections.id, name: connections.name, locality: connections.locality })
          .from(connections)
          .orderBy(asc(connections.name))
          .all()}
      />
    </>
  );
}
