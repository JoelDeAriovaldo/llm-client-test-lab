import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { experimentModels, experiments, harnesses, harnessVersions } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default function ExperimentsPage() {
  const db = getDb();
  const rows = db
    .select({ experiment: experiments, version: harnessVersions.version, harness: harnesses.name })
    .from(experiments)
    .innerJoin(harnessVersions, eq(experiments.harnessVersionId, harnessVersions.id))
    .innerJoin(harnesses, eq(harnessVersions.harnessId, harnesses.id))
    .orderBy(desc(experiments.id))
    .all();
  const models = db.select().from(experimentModels).all();
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Experiments</h1>
        <Link href="/experiments/new" className={buttonVariants()}>New Experiment</Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Experiments yet. Create one to test some Models.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Harness</TableHead>
              <TableHead>Models</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ experiment, version, harness }) => (
              <TableRow key={experiment.id}>
                <TableCell>
                  <Link href={`/experiments/${experiment.id}`} className="underline underline-offset-2">{experiment.name}</Link>
                </TableCell>
                <TableCell>{harness} v{version}</TableCell>
                <TableCell className="whitespace-normal">
                  {models.filter((m) => m.experimentId === experiment.id).map((m) => m.modelName).join(", ")}
                </TableCell>
                <TableCell><StatusBadge status={experiment.status} /></TableCell>
                <TableCell>{experiment.createdAt.slice(0, 16).replace("T", " ")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
