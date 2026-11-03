/** One Run's errorHistogram from Marking Lab. A single series, so its title names it and there's no legend. */
export function ErrorHistogram({ title, buckets }: { title: string; buckets: { bucket: string; count: number }[] }) {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-sm font-medium">{title}</figcaption>
      <div
        role="img"
        aria-label={`${title}: ${buckets.map((b) => `${b.bucket}: ${b.count}`).join(", ")}`}
        className="flex h-32 items-end gap-0.5 border-b border-border"
      >
        {buckets.map((b) => (
          <div key={b.bucket} className="group relative flex h-full flex-1 items-end hover:bg-muted/60">
            <div
              className="w-full rounded-t bg-chart-1"
              style={{ height: `${(b.count / max) * 100}%`, minHeight: b.count > 0 ? 2 : 0 }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-xs text-popover-foreground shadow ring-1 ring-border group-hover:block">
              Error {b.bucket}: {b.count}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5 text-xs text-muted-foreground">
        {buckets.map((b) => (
          <span key={b.bucket} className="flex-1 truncate text-center">{b.bucket}</span>
        ))}
      </div>
    </figure>
  );
}
