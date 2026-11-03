export type EstimateInput = {
  answerCount: number;
  repeats: number;
  averagePromptChars: number;
  maxTokens: number;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  locality: "local" | "cloud";
};

/**
 * An upper bound: output is assumed to reach the token limit.
 * Null when a cloud Model has no prices, so no figure is better than a wrong one.
 */
export function estimateCostUsd(e: EstimateInput): number | null {
  if (e.locality === "local") return 0;
  if (e.inputPricePerMillion === null || e.outputPricePerMillion === null) return null;
  const calls = e.answerCount * e.repeats;
  const inputTokens = e.averagePromptChars / 4;
  return (calls * (inputTokens * e.inputPricePerMillion + e.maxTokens * e.outputPricePerMillion)) / 1_000_000;
}
