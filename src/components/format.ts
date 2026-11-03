export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${(v * 100).toFixed(1)}%`);
export const num = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined ? "–" : v.toFixed(digits);
export const usd = (v: number | null | undefined) =>
  v === null || v === undefined ? "unknown" : `$${v < 0.01 && v > 0 ? v.toFixed(5) : v.toFixed(2)}`;
export const ms = (v: number | null | undefined) =>
  v === null || v === undefined ? "–" : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`;
