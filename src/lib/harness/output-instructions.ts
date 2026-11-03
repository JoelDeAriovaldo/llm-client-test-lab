import type { Line } from "./render";
import type { Scheme } from "@/lib/marking-lab/schemas";

/** Stands in for the per-Answer output instructions in a Run's promptTemplate. */
export const OUTPUT_INSTRUCTIONS_PLACEHOLDER = "{{output instructions: added by the app for each Answer}}";

/** Added after every prompt, so an edited template can't break the parser. */
export function outputInstructions(lines: Line[], scheme: Scheme | null): string {
  const shape = Object.fromEntries(
    lines.map((line) => {
      if (!scheme) return [line.label, { total: 0 }];
      const points = scheme.lines.find((l) => l.label === line.label)?.points ?? [];
      return [line.label, { marks: points.map(() => 0) }];
    }),
  );
  const rule = scheme
    ? "For each line, \"marks\" has one integer per marking point, in the order listed, each from 0 up to that point's marks."
    : "For each line, \"total\" is the integer mark you award, from 0 up to the line's marks.";
  return [
    "Reply with only a JSON object, in exactly this shape:",
    JSON.stringify({ lines: shape, reason: "one or two sentences explaining the marks" }),
    rule,
    "Include every line shown above and no others.",
  ].join("\n");
}

/** The JSON schema requested from endpoints that support structured output. */
export function outputJsonSchema(lines: Line[], scheme: Scheme | null) {
  const lineSchema = scheme
    ? {
        type: "object",
        properties: { marks: { type: "array", items: { type: "integer" } } },
        required: ["marks"],
        additionalProperties: false,
      }
    : {
        type: "object",
        properties: { total: { type: "integer" } },
        required: ["total"],
        additionalProperties: false,
      };
  return {
    type: "object",
    properties: {
      lines: {
        type: "object",
        properties: Object.fromEntries(lines.map((l) => [l.label, lineSchema])),
        required: lines.map((l) => l.label),
        additionalProperties: false,
      },
      reason: { type: "string" },
    },
    required: ["lines", "reason"],
    additionalProperties: false,
  };
}
