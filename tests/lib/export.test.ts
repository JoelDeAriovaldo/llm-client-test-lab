import { describe, expect, it } from "vitest";
import { csvField, toCsv } from "@/lib/export";

describe("csvField", () => {
  it("quotes what needs quoting", () => {
    expect(csvField('a,"b"')).toBe('"a,""b"""');
    expect(csvField("a\nb")).toBe('"a\nb"');
    expect(csvField(null)).toBe("");
    expect(csvField(1.5)).toBe("1.5");
    expect(csvField({ a: 1 })).toBe('"{""a"":1}"');
  });
  it.each(["=SUM(A1)", "+1", "-1", "@x"])("stops spreadsheets running %s as a formula", (text) => {
    expect(csvField(text).startsWith("'")).toBe(true);
  });
  it("leaves negative numbers as numbers", () => {
    expect(csvField(-0.5)).toBe("-0.5");
  });
});

describe("toCsv", () => {
  it("writes a header and rows", () => {
    expect(toCsv([{ a: 1, b: "x" }])).toBe("a,b\n1,x\n");
    expect(toCsv([])).toBe("");
  });
});
