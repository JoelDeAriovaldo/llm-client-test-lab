"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/app/actions";
import { FormStatus } from "@/components/form-bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** For actions that can't be undone: names what will happen, and waits for a clear yes. */
export function ConfirmAction({
  action,
  fields,
  triggerLabel,
  title,
  description,
  confirmLabel,
  askReason,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  fields: Record<string, string | number>;
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  askReason?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (previous: ActionState, form: FormData) => {
    const result = await action(previous, form);
    if (result.message) setOpen(false);
    return result;
  }, {});
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{triggerLabel}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {askReason && (
            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason</Label>
              <Textarea id="reason" name="reason" required />
            </div>
          )}
          <FormStatus state={state} />
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Working…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
