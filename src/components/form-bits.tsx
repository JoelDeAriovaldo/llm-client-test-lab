"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export function FormStatus({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="text-sm text-destructive">{state.error}</p>;
  if (state.message) return <p role="status" className="text-sm text-muted-foreground">{state.message}</p>;
  return null;
}

type ServerAction = (state: ActionState, form: FormData) => Promise<ActionState>;

/** A form that shows its Server Action's outcome next to the submit button. */
export function ActionForm({
  action,
  submitLabel,
  variant,
  className,
  children,
}: {
  action: ServerAction;
  submitLabel: string;
  variant?: "default" | "outline";
  className?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={cn("space-y-3", className)}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? "Working…" : submitLabel}
        </Button>
        <FormStatus state={state} />
      </div>
    </form>
  );
}
