import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ms, usd } from "@/components/format";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { calls, experimentModels } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function Block({ title, text }: { title: string; text: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap text-xs">{text || "None"}</pre>
      </CardContent>
    </Card>
  );
}

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = getDb();
  const row = db
    .select({ call: calls, model: experimentModels })
    .from(calls)
    .innerJoin(experimentModels, eq(calls.experimentModelId, experimentModels.id))
    .where(eq(calls.id, id))
    .get();
  if (!row) notFound();
  const { call, model } = row;
  return (
    <>
      <div>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {call.answerId} <StatusBadge status={call.status} />
        </h1>
        <p className="text-sm text-muted-foreground">
          <Link href={`/experiments/${model.experimentId}`} className="underline underline-offset-2">{model.modelName}</Link>,
          repeat {call.repeat}, Dataset Version {call.datasetVersion}{call.isTrial && ", Trial"}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
        <div><dt className="text-xs text-muted-foreground">Latency</dt><dd>{ms(call.latencyMs)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Input tokens</dt><dd>{call.inputTokens ?? "–"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Output tokens</dt><dd>{call.outputTokens ?? "–"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Cost</dt><dd>{usd(call.costUsd)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Attempts</dt><dd>{call.attempts}</dd></div>
      </dl>
      {call.error && <p role="alert" className="text-sm text-destructive">{call.error}</p>}
      {call.unreadableReason && <p role="alert" className="text-sm text-destructive">Unreadable: {call.unreadableReason}</p>}
      <Block title="Parsed marks" text={call.parsedLines ? JSON.stringify(call.parsedLines, null, 2) : null} />
      <Block title="Model's reason" text={call.reason} />
      <Block title="Raw reply" text={call.rawOutput} />
      <Block title="Prompt as sent" text={call.prompt} />
    </>
  );
}
