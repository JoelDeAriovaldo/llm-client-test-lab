import { asc, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { calls } from "@/lib/db/schema";
import { comparisonRows } from "@/lib/experiments/queries";
import { toCsv } from "@/lib/export";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const ids = (params.get("ids") ?? "").split(",").map(Number).filter(Boolean);
  const what = params.get("what") === "calls" ? "calls" : "scores";
  const format = params.get("format") === "json" ? "json" : "csv";
  const db = getDb();
  const compared = comparisonRows(db, ids);

  let rows: Record<string, unknown>[];
  if (what === "calls") {
    const names = new Map(compared.map((r) => [r.modelId, r]));
    rows = db
      .select()
      .from(calls)
      .where(inArray(calls.experimentModelId, ids))
      .orderBy(asc(calls.id))
      .all()
      .filter((c) => !c.isTrial)
      .map((c) => ({
        runId: names.get(c.experimentModelId)?.runId ?? null,
        model: names.get(c.experimentModelId)?.label ?? null,
        answerId: c.answerId,
        questionId: c.questionId,
        repeat: c.repeat,
        datasetVersion: c.datasetVersion,
        status: c.status,
        unreadableReason: c.unreadableReason,
        attempts: c.attempts,
        parsedLines: c.parsedLines,
        reason: c.reason,
        finishReason: c.finishReason,
        latencyMs: c.latencyMs,
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
        costUsd: c.costUsd,
        error: c.error,
        resultId: c.resultId,
        prompt: c.prompt,
        rawOutput: c.rawOutput,
      }));
  } else {
    rows = compared.map((r) => ({
      runId: r.runId,
      experiment: r.experimentName,
      model: r.label,
      harness: r.harnessLabel,
      harnessHash: r.compared.harnessHash,
      status: r.status,
      datasetVersion: r.compared.datasetVersion,
      answerSource: r.compared.answerSource,
      answersMarked: r.score?.answersMarked ?? null,
      exactTotalAgreement: r.score?.overall?.exactTotalAgreement ?? null,
      lineAgreement: r.score?.overall?.lineAgreement ?? null,
      pointAgreement: r.score?.overall?.pointAgreement ?? null,
      clearCaseAgreement: r.score?.clearCases?.exactTotalAgreement ?? null,
      greyCaseAgreement: r.score?.greyCases?.exactTotalAgreement ?? null,
      meanAbsError: r.score?.overall?.meanAbsError ?? null,
      bias: r.score?.overall?.bias ?? null,
      repeatConsistency: r.score?.repeatConsistency?.rate ?? null,
      costUsd: r.stats.costUsd,
      callsWithUnknownCost: r.stats.unknownCost,
      averageLatencyMs: r.stats.averageLatencyMs,
      ...(format === "json" ? { score: r.score } : {}),
    }));
  }

  const body = format === "json" ? JSON.stringify(rows, null, 2) : toCsv(rows);
  return new Response(body, {
    headers: {
      "Content-Type": format === "json" ? "application/json" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${what}.${format}"`,
    },
  });
}
