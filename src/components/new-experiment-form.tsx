"use client";

import { useState, useTransition } from "react";
import { createExperimentAction, modelsForConnection, type ActionState } from "@/app/actions";
import { FormStatus, selectClass } from "@/components/form-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ListedModel } from "@/lib/llm/client";

type ConnectionOption = { id: number; name: string; locality: "local" | "cloud" };
type HarnessOption = { versionId: number; label: string };

type ModelRow = {
  key: number;
  connectionId: number;
  modelName: string;
  temperature: string;
  maxTokens: string;
  inputPrice: string;
  outputPrice: string;
};

const optionalNumber = (v: string) => (v.trim() === "" ? null : Number(v));

export function NewExperimentForm({
  connections,
  harnesses,
}: {
  connections: ConnectionOption[];
  harnesses: HarnessOption[];
}) {
  const [nextKey, setNextKey] = useState(1);
  const blank = (key: number): ModelRow => ({
    key,
    connectionId: connections[0]?.id ?? 0,
    modelName: "",
    temperature: "0",
    maxTokens: "2000",
    inputPrice: "",
    outputPrice: "",
  });
  const [rows, setRows] = useState<ModelRow[]>([blank(0)]);
  const [listed, setListed] = useState<Record<number, ListedModel[]>>({});
  const [listError, setListError] = useState<string>();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [harness, setHarness] = useState(harnesses[0]?.versionId ?? 0);
  const [repeats, setRepeats] = useState("1");
  const [limit, setLimit] = useState("");
  const [allowReal, setAllowReal] = useState(false);
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  const update = (key: number, change: Partial<ModelRow>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));

  async function loadModels(connectionId: number) {
    const result = await modelsForConnection(connectionId);
    setListError(result.error);
    setListed((all) => ({ ...all, [connectionId]: result.models }));
  }

  function chooseModel(row: ModelRow, modelName: string) {
    const match = listed[row.connectionId]?.find((m) => m.id === modelName);
    update(row.key, {
      modelName,
      ...(match
        ? {
            inputPrice: match.inputPricePerMillion?.toString() ?? row.inputPrice,
            outputPrice: match.outputPricePerMillion?.toString() ?? row.outputPrice,
          }
        : {}),
    });
  }

  const usesCloud = rows.some((r) => connections.find((c) => c.id === r.connectionId)?.locality === "cloud");
  const unpricedCloud = rows.some(
    (r) =>
      connections.find((c) => c.id === r.connectionId)?.locality === "cloud" &&
      (r.inputPrice === "" || r.outputPrice === ""),
  );
  const repeatAtZero = Number(repeats) > 1 && rows.some((r) => Number(r.temperature) === 0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createExperimentAction({
        name,
        notes,
        harnessVersionId: harness,
        repeats: Number(repeats),
        allowRealOnCloud: allowReal,
        spendLimitUsd: optionalNumber(limit),
        models: rows.map((r) => ({
          connectionId: r.connectionId,
          modelName: r.modelName,
          settings: { temperature: Number(r.temperature), maxTokens: Number(r.maxTokens) },
          inputPricePerMillion: optionalNumber(r.inputPrice),
          outputPricePerMillion: optionalNumber(r.outputPrice),
        })),
      });
      setState(result ?? {});
    });
  }

  if (connections.length === 0) {
    return <p className="text-sm text-muted-foreground">Add a Connection first, so there are Models to test.</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="harness">Harness</Label>
          <select id="harness" className={selectClass} value={harness} onChange={(e) => setHarness(Number(e.target.value))}>
            {harnesses.map((h) => (
              <option key={h.versionId} value={h.versionId}>{h.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="repeats">Repeats</Label>
          <Input id="repeats" type="number" min={1} value={repeats} onChange={(e) => setRepeats(e.target.value)} />
          {repeatAtZero && (
            <p className="text-xs text-muted-foreground">
              At temperature 0, repeats often match trivially, so a high repeat consistency means little.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="limit">Spending limit in USD (optional)</Label>
          <Input id="limit" type="number" min={0} step="any" value={limit} onChange={(e) => setLimit(e.target.value)} />
          {limit !== "" && unpricedCloud && (
            <p className="text-xs text-muted-foreground">
              A cloud Model below has no prices. Unless its provider reports costs, its spending won&apos;t count toward this limit.
            </p>
          )}
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="notes">Notes (optional, sent with each Run)</Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Models</h2>
        {rows.map((row, i) => (
          <Card key={row.key}>
            <CardHeader>
              <CardTitle className="text-sm">Model {i + 1}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor={`c-${row.key}`}>Connection</Label>
                <select
                  id={`c-${row.key}`}
                  className={selectClass}
                  value={row.connectionId}
                  onChange={(e) => update(row.key, { connectionId: Number(e.target.value) })}
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 lg:col-span-2">
                <Label htmlFor={`m-${row.key}`}>Model name</Label>
                <div className="flex gap-2">
                  <Input
                    id={`m-${row.key}`}
                    list={`models-${row.connectionId}`}
                    value={row.modelName}
                    onChange={(e) => chooseModel(row, e.target.value)}
                    required
                  />
                  <Button type="button" variant="outline" onClick={() => loadModels(row.connectionId)}>Load list</Button>
                </div>
                <datalist id={`models-${row.connectionId}`}>
                  {listed[row.connectionId]?.map((m) => <option key={m.id} value={m.id} />)}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`t-${row.key}`}>Temperature</Label>
                <Input id={`t-${row.key}`} type="number" min={0} step="any" value={row.temperature} onChange={(e) => update(row.key, { temperature: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`x-${row.key}`}>Token limit</Label>
                <Input id={`x-${row.key}`} type="number" min={1} value={row.maxTokens} onChange={(e) => update(row.key, { maxTokens: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`i-${row.key}`}>Input $/M</Label>
                  <Input id={`i-${row.key}`} type="number" min={0} step="any" value={row.inputPrice} onChange={(e) => update(row.key, { inputPrice: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`o-${row.key}`}>Output $/M</Label>
                  <Input id={`o-${row.key}`} type="number" min={0} step="any" value={row.outputPrice} onChange={(e) => update(row.key, { outputPrice: e.target.value })} />
                </div>
              </div>
              {rows.length > 1 && (
                <div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setRows((all) => all.filter((r) => r.key !== row.key))}>
                    Remove
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {listError && <p role="alert" className="text-sm text-destructive">{listError}</p>}
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setRows((all) => [...all, blank(nextKey)]);
            setNextKey((k) => k + 1);
          }}
        >
          Add a Model
        </Button>
      </section>

      {usesCloud && (
        <div className="flex items-start gap-2 rounded-lg border border-border p-3">
          <Checkbox id="allowReal" checked={allowReal} onCheckedChange={(c) => setAllowReal(c === true)} />
          <div>
            <Label htmlFor="allowReal">Send real student Answers to cloud providers</Label>
            <p className="text-xs text-muted-foreground">
              Off: because this Experiment uses a cloud Connection, every Model marks synthetic Answers only, so they stay comparable.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create Experiment"}</Button>
        <FormStatus state={state} />
      </div>
    </form>
  );
}
