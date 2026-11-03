import { createHash } from "node:crypto";

export const PARSER_ID = "json-v1";

export function harnessHash(v: { promptTemplate: string; usedMarkingScheme: boolean; parser: string }) {
  return createHash("sha256")
    .update(JSON.stringify([v.promptTemplate, v.usedMarkingScheme, v.parser]))
    .digest("hex");
}
