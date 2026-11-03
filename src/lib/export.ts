/** Student text ends up in spreadsheets, where a leading = + - or @ would run as a formula. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  return [columns.join(","), ...rows.map((r) => columns.map((c) => csvField(r[c])).join(","))].join("\n") + "\n";
}
