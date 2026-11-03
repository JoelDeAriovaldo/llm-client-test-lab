import { Badge } from "@/components/ui/badge";

const LABELS: Record<string, string> = {
  draft: "Draft",
  queued: "Starting",
  running: "Running",
  paused: "Paused",
  finished: "Finished",
  pending: "Waiting",
  marking: "Marking",
  submitting: "Submitting",
  needs_attention: "Needs attention",
  closed: "Closed",
  withdrawn: "Withdrawn",
  in_flight: "In progress",
  succeeded: "Marked",
  unreadable: "Unreadable",
  failed: "Failed",
};

const ALERT = new Set(["needs_attention", "failed"]);
const MUTED = new Set(["draft", "pending", "withdrawn"]);

export function StatusBadge({ status }: { status: string }) {
  const variant = ALERT.has(status) ? "destructive" : MUTED.has(status) ? "outline" : "secondary";
  return <Badge variant={variant}>{LABELS[status] ?? status}</Badge>;
}
