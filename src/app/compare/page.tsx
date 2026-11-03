import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { ErrorHistogram } from "@/components/error-histogram";
import { ms, num, pct, usd } from "@/components/format";
import { selectClass } from "@/components/form-bits";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { calls } from "@/lib/db/schema";
import { comparabilityWarnings } from "@/lib/experiments/comparability";
import { comparisonRows, type ComparisonRow } from "@/lib/experiments/queries";
import type { GroupStats, Score } from "@/lib/marking-lab/schemas";

export const dynamic = "force-dynamic";

const BREAKDOWNS = {
  byQuestion: "Question",
  byLine: "Line",
  bySyllabusRef: "Syllabus reference",
  byTag: "Tag",
  bySource: "Source",
} as const;
type Breakdown = keyof typeof BREAKDOWNS;

const METRICS: { label: string; show: (s: Score) => string }[] = [
  { label: "Answers marked", show: (s) => String(s.answersMarked ?? "–") },
  { label: "Exact agreement", show: (s) => pct(s.overall?.exactTotalAgreement) },
  { label: "Line agreement", show: (s) => pct(s.overall?.lineAgreement) },
  { label: "Point agreement", show: (s) => pct(s.overall?.pointAgreement) },
  { label: "Clear-case agreement", show: (s) => pct(s.clearCases?.exactTotalAgreement) },
  { label: "Grey-case agreement", show: (s) => pct(s.greyCases?.exactTotalAgreement) },
  { label: "Mean abs error", show: (s) => num(s.overall?.meanAbsError) },
  { label: "Bias", show: (s) => num(s.overall?.bias) },
  { label: "Unreadable (Marking Lab)", show: (s) => String(s.overall?.parseFailures ?? "–") },
  { label: "Repeat consistency", show: (s) => pct(s.repeatConsistency?.rate) },
];

function Disagreements({ row }: { row: ComparisonRow }) {
  const items = row.score?.disagreements ?? [];
  if (items.length === 0) return null;
  const db = getDb();
  return (
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm">{row.label}: {items.length} disagreement(s)</summary>
      <ul className="mt-2 space-y-1 text-xs">
        {items.map((item, i) => {
          const answerId = typeof item.answerId === "string" ? item.answerId : null;
          const repeat = typeof item.repeat === "number" ? item.repeat : 1;
          // The spec doesn't fix this shape, so a disagreement without an answerId stays unlinked.
          const call = answerId
            ? db
                .select({ id: calls.id })
                .from(calls)
                .where(
                  and(
                    eq(calls.experimentModelId, row.modelId),
                    eq(calls.isTrial, false),
                    eq(calls.answerId, answerId),
                    eq(calls.repeat, repeat),
                  ),
                )
                .get()
            : undefined;
          return (
            <li key={i} className="flex flex-wrap gap-2 font-mono">
              {call && <Link href={`/calls/${call.id}`} className="underline underline-offset-2">{answerId}</Link>}
              <span className="break-all">{JSON.stringify(item)}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[]; by?: string }>;
}) {
  const params = await searchParams;
  const db = getDb();
  const all = comparisonRows(db).filter((r) => r.runId !== null);
  const requested = [params.ids ?? []]
    .flat()
    .flatMap((v) => v.split(","))
    .map(Number)
    .filter(Boolean);
  const rows = all.filter((r) => requested.includes(r.modelId));
  const by: Breakdown = params.by && params.by in BREAKDOWNS ? (params.by as Breakdown) : "byQuestion";
  const warnings = comparabilityWarnings(rows.map((r) => r.compared));
  const keys = [...new Set(rows.flatMap((r) => Object.keys((r.score?.[by] as Record<string, GroupStats>) ?? {})))].sort();
  const exportQuery = rows.map((r) => r.modelId).join(",");
  const histograms = rows.filter((r) => (r.score?.errorHistogram?.length ?? 0) > 0);

  return (
    <>
      <h1 className="text-2xl font-semibold">Compare</h1>
      {all.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Runs yet. Start an Experiment, and its Runs will appear here.</p>
      ) : (
        <form className="space-y-3">
          <fieldset className="grid gap-1 sm:grid-cols-2">
            <legend className="mb-1 text-sm font-medium">Runs to compare</legend>
            {all.map((r) => (
              <label key={r.modelId} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ids" value={r.modelId} defaultChecked={requested.includes(r.modelId)} />
                <span className="min-w-0 truncate">{r.label}, {r.experimentName}</span>
              </label>
            ))}
          </fieldset>
          <input type="hidden" name="by" value={by} />
          <Button type="submit" variant="outline">Compare these Runs</Button>
        </form>
      )}

      {warnings.length > 0 && (
        <Alert>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/export?ids=${exportQuery}&what=scores&format=csv`} className={buttonVariants({ variant: "outline", size: "sm" })}>Scores CSV</a>
            <a href={`/api/export?ids=${exportQuery}&what=scores&format=json`} className={buttonVariants({ variant: "outline", size: "sm" })}>Scores JSON</a>
            <a href={`/api/export?ids=${exportQuery}&what=calls&format=csv`} className={buttonVariants({ variant: "outline", size: "sm" })}>Calls CSV</a>
            <a href={`/api/export?ids=${exportQuery}&what=calls&format=json`} className={buttonVariants({ variant: "outline", size: "sm" })}>Calls JSON</a>
          </div>

          <section className="space-y-2">
            <h2 className="text-lg font-medium">Side by side</h2>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Measure</TableHead>
                    {rows.map((r) => <TableHead key={r.modelId}>{r.label}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Status</TableCell>
                    {rows.map((r) => <TableCell key={r.modelId}><StatusBadge status={r.status} /></TableCell>)}
                  </TableRow>
                  <TableRow>
                    <TableCell>Harness</TableCell>
                    {rows.map((r) => <TableCell key={r.modelId}>{r.harnessLabel}</TableCell>)}
                  </TableRow>
                  {METRICS.map((m) => (
                    <TableRow key={m.label}>
                      <TableCell>{m.label}</TableCell>
                      {rows.map((r) => <TableCell key={r.modelId}>{r.score ? m.show(r.score) : "–"}</TableCell>)}
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell>Spent (local record)</TableCell>
                    {rows.map((r) => (
                      <TableCell key={r.modelId}>
                        {usd(r.stats.costUsd)}{r.stats.unknownCost > 0 && ` + ${r.stats.unknownCost} unknown`}
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell>Avg latency (local record)</TableCell>
                    {rows.map((r) => <TableCell key={r.modelId}>{ms(r.stats.averageLatencyMs)}</TableCell>)}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>

          {histograms.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-medium">Error histogram</h2>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {histograms.map((r) => (
                  <ErrorHistogram key={r.modelId} title={r.label} buckets={r.score!.errorHistogram!} />
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-lg font-medium">Breakdown: exact agreement</h2>
            <form className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="ids" value={exportQuery} />
              <select name="by" defaultValue={by} aria-label="Break down by" className={`${selectClass} w-auto`}>
                {Object.entries(BREAKDOWNS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <Button type="submit" variant="outline">Show</Button>
            </form>
            {keys.length === 0 ? (
              <p className="text-sm text-muted-foreground">Marking Lab only gives breakdowns for closed open Runs.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{BREAKDOWNS[by]}</TableHead>
                      {rows.map((r) => <TableHead key={r.modelId}>{r.label}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.map((key) => (
                      <TableRow key={key}>
                        <TableCell>{key}</TableCell>
                        {rows.map((r) => (
                          <TableCell key={r.modelId}>{pct(r.score?.[by]?.[key]?.exactTotalAgreement)}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-medium">Disagreements</h2>
            {rows.map((r) => <Disagreements key={r.modelId} row={r} />)}
          </section>
        </>
      )}
    </>
  );
}
