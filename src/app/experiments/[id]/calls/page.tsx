import Link from "next/link";
import { and, asc, count, eq, type SQL } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ms, usd } from "@/components/format";
import { selectClass } from "@/components/form-bits";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { calls, callStatuses, experimentModels, experiments } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const LIMIT = 500;

export default async function ExperimentCallsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; model?: string }>;
}) {
  const id = Number((await params).id);
  const { status, model } = await searchParams;
  const db = getDb();
  const experiment = db.select().from(experiments).where(eq(experiments.id, id)).get();
  if (!experiment) notFound();
  const models = db.select().from(experimentModels).where(eq(experimentModels.experimentId, id)).all();

  const filters: (SQL | undefined)[] = [eq(experimentModels.experimentId, id), eq(calls.isTrial, false)];
  if (callStatuses.includes(status as (typeof callStatuses)[number])) {
    filters.push(eq(calls.status, status as (typeof callStatuses)[number]));
  }
  if (model) filters.push(eq(experimentModels.id, Number(model)));
  const where = and(...filters);

  const total =
    db
      .select({ n: count() })
      .from(calls)
      .innerJoin(experimentModels, eq(calls.experimentModelId, experimentModels.id))
      .where(where)
      .get()?.n ?? 0;
  const rows = db
    .select({ call: calls, modelName: experimentModels.modelName })
    .from(calls)
    .innerJoin(experimentModels, eq(calls.experimentModelId, experimentModels.id))
    .where(where)
    .orderBy(asc(calls.id))
    .limit(LIMIT)
    .all();

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Calls</h1>
        <p className="text-sm text-muted-foreground">
          <Link href={`/experiments/${id}`} className="underline underline-offset-2">{experiment.name}</Link>:
          showing {rows.length} of {total}
        </p>
      </div>
      <form className="flex flex-wrap items-end gap-2">
        <select name="model" defaultValue={model ?? ""} aria-label="Model" className={`${selectClass} w-auto`}>
          <option value="">All Models</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.modelName}</option>)}
        </select>
        <select name="status" defaultValue={status ?? ""} aria-label="Outcome" className={`${selectClass} w-auto`}>
          <option value="">All outcomes</option>
          {callStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button type="submit" variant="outline">Filter</Button>
      </form>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Answer</TableHead>
            <TableHead>Repeat</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Latency</TableHead>
            <TableHead>Cost</TableHead>
            <TableHead>Sent</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ call, modelName }) => (
            <TableRow key={call.id}>
              <TableCell><Link href={`/calls/${call.id}`} className="underline underline-offset-2">{call.answerId}</Link></TableCell>
              <TableCell>{call.repeat}</TableCell>
              <TableCell>{modelName}</TableCell>
              <TableCell><StatusBadge status={call.status} /></TableCell>
              <TableCell>{ms(call.latencyMs)}</TableCell>
              <TableCell>{usd(call.costUsd)}</TableCell>
              <TableCell>{call.batchId ? "Yes" : "No"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
