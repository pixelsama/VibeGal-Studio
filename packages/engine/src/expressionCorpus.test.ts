import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectExpressionReads, parseExpression } from "./expression";

const corpus = JSON.parse(readFileSync(new URL("../../contracts/fixtures/expression-corpus.json", import.meta.url), "utf8")) as {
  valid: Array<{ source: string; reads: string[] }>;
  invalid: string[];
};

describe("shared expression corpus", () => {
  for (const testCase of corpus.valid) it(`accepts ${testCase.source}`, () => expect(collectExpressionReads(parseExpression(testCase.source))).toEqual(testCase.reads));
  for (const source of corpus.invalid) it(`rejects ${source || "empty"}`, () => expect(() => parseExpression(source)).toThrow());
});
