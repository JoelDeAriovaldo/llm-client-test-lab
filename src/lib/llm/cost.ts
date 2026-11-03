/** Null means unknown, which isn't the same as free: a local Model costs 0. */
export function callCost(args: {
  locality: "local" | "cloud";
  providerCostUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
}): number | null {
  if (args.locality === "local") return 0;
  if (args.providerCostUsd !== null) return args.providerCostUsd;
  if (
    args.inputTokens === null ||
    args.outputTokens === null ||
    args.inputPricePerMillion === null ||
    args.outputPricePerMillion === null
  ) {
    return null;
  }
  return (args.inputTokens * args.inputPricePerMillion + args.outputTokens * args.outputPricePerMillion) / 1_000_000;
}
