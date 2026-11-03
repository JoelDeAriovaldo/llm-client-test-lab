"use client";

import { useActionState, useEffect, useState } from "react";
import { previewPrompt, type ActionState } from "@/app/actions";
import { FormStatus } from "@/components/form-bits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function HarnessEditor({
  action,
  harnessId,
  initialTemplate,
  initialUsesScheme,
  submitLabel,
  note,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  harnessId?: number;
  initialTemplate: string;
  initialUsesScheme: boolean;
  submitLabel: string;
  note?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [template, setTemplate] = useState(initialTemplate);
  const [usesScheme, setUsesScheme] = useState(initialUsesScheme);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewPrompt>> | null>(null);

  useEffect(() => {
    let current = true;
    const timer = setTimeout(async () => {
      const result = await previewPrompt(template, usesScheme);
      if (current) setPreview(result);
    }, 500);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [template, usesScheme]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form action={formAction} className="min-w-0 space-y-3">
        {harnessId ? (
          <input type="hidden" name="id" value={harnessId} />
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required />
          </div>
        )}
        <div className="flex items-center gap-2">
          <Checkbox
            id="usedMarkingScheme"
            name="usedMarkingScheme"
            checked={usesScheme}
            onCheckedChange={(checked) => setUsesScheme(checked === true)}
          />
          <Label htmlFor="usedMarkingScheme">Give the Model the Marking Scheme</Label>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="promptTemplate">Prompt template</Label>
          <Textarea
            id="promptTemplate"
            name="promptTemplate"
            rows={18}
            className="font-mono text-xs"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Use {"{{stem}}"}, {"{{lines}}"}, {"{{answer}}"} and {"{{scheme}}"}. The app adds the output instructions itself.
          </p>
        </div>
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
          <FormStatus state={state} />
        </div>
      </form>
      <section className="min-w-0 space-y-1.5">
        <h2 className="text-sm font-medium">Preview</h2>
        {preview?.problems.map((problem) => (
          <p key={problem} role="alert" className="text-sm text-destructive">{problem}</p>
        ))}
        {preview?.caption && <p className="text-xs text-muted-foreground">{preview.caption}</p>}
        {preview?.prompt && (
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border border-border p-3 text-xs">
            {preview.prompt}
          </pre>
        )}
        {!preview && <p className="text-sm text-muted-foreground">Loading…</p>}
      </section>
    </div>
  );
}
