import { Suspense } from "react";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import {
  closeRunAction,
  pauseExperimentAction,
  requestTrialAction,
  resumeExperimentAction,
  startExperimentAction,
  withdrawRunAction,
} from "@/app/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConfirmAction } from "@/components/confirm-action";
import { ms, num, pct, usd } from "@/components/format";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { calls, connections, experimentModels, experiments, harnesses, harnessVersions } from "@/lib/db/schema";
import { estimateExperiment } from "@/lib/experiments/preflight";
import { callStats, latestScore } from "@/lib/experiments/queries";

export const dynamic = "force-dynamic";

function Hidden({ id }: { id: number }) {
  return <input type="hidden" name="experimentId" value={id} />;
}

async function EstimateCard({ id }: { id: number }) {
  const outcome = await estimateExperiment(getDb(), id).then(
    (estimate) => ({ estimate }),
    (err: Error) => ({ problem: err.message }),
  );
  if ("problem" in outcome) {
    return (
      <Alert>
        <AlertDescription>Couldn&apos;t work out an estimate: {outcome.problem}</AlertDescription>
      </Alert>
    );
  }
  const { estimate } = outcome;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Estimate</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>{estimate.answerCount} Answers, {estimate.calls} Calls in total.</p>
        <ul>
          {estimate.models.map((m) => (
            <li key={m.modelName}>{m.modelName}: up to {usd(m.costUsd)}</li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          An upper bound, assuming every reply reaches the token limit. Unknown means the Model has no prices.
        </p>
      </CardContent>
    </Card>
  );
}

export default async function ExperimentPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = getDb();
  const experiment = db.select().from(experiments).where(eq(experiments.id, id)).get();
  if (!experiment) notFound();
  const { version, harness } = db
    .select({ version: harnessVersions, harness: harnesses })
    .from(harnessVersions)
    .innerJoin(harnesses, eq(harnessVersions.harnessId, harnesses.id))
    .where(eq(harnessVersions.id, experiment.harnessVersionId))
    .get()!;
  const models = db
    .select({ model: experimentModels, connection: connections })
    .from(experimentModels)
    .innerJoin(connections, eq(experimentModels.connectionId, connections.id))
    .where(eq(experimentModels.experimentId, id))
    .orderBy(asc(experimentModels.id))
    .all();

  const anySubmitting = models.some(({ model }) => model.status === "submitting");
  const active =
    experiment.status === "queued" ||
    experiment.status === "running" ||
    experiment.trialStatus === "requested" ||
    experiment.trialStatus === "running" ||
    anySubmitting;
  const canStart = experiment.status === "draft";
  const limitReached = experiment.error?.includes("spending limit");
  const trialCalls = db
    .select({ call: calls, modelName: experimentModels.modelName })
    .from(calls)
    .innerJoin(experimentModels, eq(calls.experimentModelId, experimentModels.id))
    .where(and(eq(experimentModels.experimentId, id), eq(calls.isTrial, true)))
    .orderBy(asc(calls.answerId), asc(calls.experimentModelId))
    .all();

  return (
    <>
      <AutoRefresh active={active} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {experiment.name} <StatusBadge status={experiment.status} />
          </h1>
          <p className="text-sm text-muted-foreground">
            {harness.name} v{version.version}, {version.usedMarkingScheme ? "with" : "without"} Marking Scheme,{" "}
            {experiment.repeats} repeat(s),{" "}
            {experiment.answerFilter.source === "synthetic" ? "synthetic Answers only" : "all open Answers"}
            {experiment.datasetVersion !== null && `, Dataset Version ${experiment.datasetVersion}`}
            {experiment.spendLimitUsd !== null && `, limit ${usd(experiment.spendLimitUsd)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canStart && (
            <form action={startExperimentAction}>
              <Hidden id={id} />
              <Button type="submit">Start Experiment</Button>
            </form>
          )}
          {experiment.status === "running" && (
            <form action={pauseExperimentAction}>
              <Hidden id={id} />
              <Button type="submit" variant="outline">Pause</Button>
            </form>
          )}
          {experiment.status === "paused" && (
            <form action={resumeExperimentAction} className="flex flex-wrap items-end gap-2">
              <Hidden id={id} />
              {limitReached && (
                <div className="space-y-1">
                  <Label htmlFor="spendLimitUsd" className="text-xs">New limit in USD</Label>
                  <Input id="spendLimitUsd" name="spendLimitUsd" type="number" step="any" required className="w-28" />
                </div>
              )}
              <Button type="submit">Resume</Button>
            </form>
          )}
          <Link href={`/compare?ids=${models.map((m) => m.model.id).join(",")}`} className={buttonVariants({ variant: "outline" })}>
            Compare
          </Link>
          <Link href={`/experiments/${id}/calls`} className={buttonVariants({ variant: "outline" })}>
            All Calls
          </Link>
        </div>
      </div>

      {experiment.error && (
        <Alert variant="destructive">
          <AlertDescription>{experiment.error}</AlertDescription>
        </Alert>
      )}
      {experiment.dirty && (
        <Alert>
          <AlertDescription>
            This Experiment ran on code with uncommitted changes ({experiment.gitCommit}, sent as dirty).
          </AlertDescription>
        </Alert>
      )}

      {canStart && (
        <Suspense fallback={<p className="text-sm text-muted-foreground">Working out an estimate…</p>}>
          <EstimateCard id={id} />
        </Suspense>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Trial</CardTitle>
          {canStart && experiment.trialStatus !== "running" && experiment.trialStatus !== "requested" && (
            <form action={requestTrialAction}>
              <Hidden id={id} />
              <Button type="submit" variant="outline">
                {experiment.trialStatus === "none" ? `Run a Trial on ${experiment.trialSize} Answers` : "Run the Trial again"}
              </Button>
            </form>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Trial Calls stay in this app and are never submitted, so they get no Score. Use one to check the Harness and parser.
          </p>
          {trialCalls.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Finished</TableHead>
                    <TableHead>Unreadable</TableHead>
                    <TableHead>Failed</TableHead>
                    <TableHead>Avg latency</TableHead>
                    <TableHead>Spent</TableHead>
                    <TableHead>Projected full cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {models.map(({ model }) => {
                    const s = callStats(db, model.id, true);
                    const completed = s.succeeded + s.unreadable;
                    const known = completed - s.unknownCost;
                    const projected =
                      known > 0 && experiment.answerCount !== null
                        ? (s.costUsd / known) * experiment.answerCount * experiment.repeats
                        : null;
                    return (
                      <TableRow key={model.id}>
                        <TableCell>{model.modelName}</TableCell>
                        <TableCell>{s.finished} of {s.total}</TableCell>
                        <TableCell>{s.unreadable}</TableCell>
                        <TableCell>{s.failed}</TableCell>
                        <TableCell>{ms(s.averageLatencyMs)}</TableCell>
                        <TableCell>{s.unknownCost > 0 && known === 0 ? "unknown" : usd(s.costUsd)}</TableCell>
                        <TableCell>{usd(projected)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Answer</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Parsed marks</TableHead>
                      <TableHead>Reply</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trialCalls.map(({ call, modelName }) => (
                      <TableRow key={call.id}>
                        <TableCell>
                          <Link href={`/calls/${call.id}`} className="underline underline-offset-2">{call.answerId}</Link>
                        </TableCell>
                        <TableCell>{modelName}</TableCell>
                        <TableCell><StatusBadge status={call.status} /></TableCell>
                        <TableCell className="max-w-56 whitespace-normal font-mono text-xs">
                          {call.parsedLines ? JSON.stringify(call.parsedLines) : (call.unreadableReason ?? call.error ?? "")}
                        </TableCell>
                        <TableCell className="max-w-72 truncate font-mono text-xs">{call.rawOutput}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Models</h2>
        {models.map(({ model, connection }) => {
          const stats = callStats(db, model.id, false);
          const score = latestScore(db, model.id);
          return (
            <Card key={model.id}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {model.modelName} <StatusBadge status={model.status} />
                </CardTitle>
                <div className="flex flex-wrap gap-2">
                  {model.status === "needs_attention" && model.runId !== null && (
                    <ConfirmAction
                      action={closeRunAction}
                      fields={{ modelId: model.id, experimentId: id }}
                      triggerLabel="Close anyway"
                      title={`Close Run ${model.runId}?`}
                      description="Finished Results will be submitted, unfinished Answers will be left out, and no more Results can be added afterward. This can't be undone."
                      confirmLabel="Close the Run"
                    />
                  )}
                  {model.runId !== null && model.status !== "withdrawn" && (
                    <ConfirmAction
                      action={withdrawRunAction}
                      fields={{ modelId: model.id, experimentId: id }}
                      triggerLabel="Withdraw"
                      title={`Withdraw Run ${model.runId}?`}
                      description="This marks the Run as a mistake on Marking Lab, and can't be undone here. Marking Lab only allows this for maintainer keys."
                      confirmLabel="Withdraw the Run"
                      askReason
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  {connection.name}, temperature {model.modelSettings.temperature}, token limit {model.modelSettings.maxTokens}
                  {model.runId !== null && `, Run ${model.runId}`}
                  {!model.useResponseFormat && ", endpoint refused structured output"}
                </p>
                {model.error && <p role="alert" className="text-destructive">{model.error}</p>}
                {model.withdrawReason && <p>Withdrawn: {model.withdrawReason}</p>}
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">Calls finished</dt><dd>{stats.finished} of {stats.total}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Unreadable</dt><dd>{stats.unreadable}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Failed</dt><dd>{stats.failed}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Avg latency</dt><dd>{ms(stats.averageLatencyMs)}</dd></div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Spent</dt>
                    <dd>{usd(stats.costUsd)}{stats.unknownCost > 0 && ` + ${stats.unknownCost} unknown`}</dd>
                  </div>
                  {score && (
                    <>
                      <div><dt className="text-xs text-muted-foreground">Exact agreement</dt><dd>{pct(score.overall?.exactTotalAgreement)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Mean abs error</dt><dd>{num(score.overall?.meanAbsError)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Bias</dt><dd>{num(score.overall?.bias)}</dd></div>
                    </>
                  )}
                </dl>
                {score?.note && <p className="text-xs text-muted-foreground">{score.note}</p>}
              </CardContent>
            </Card>
          );
        })}
      </section>
    </>
  );
}
