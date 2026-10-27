import assert from "node:assert/strict";
import test from "node:test";
import { responseSummary } from "../src/client/lab-feedback.ts";

test("response summary separates readable output from reasoning and reports usage", () => {
  const summary = responseSummary({
    status: 200,
    response: {
      model: "synthetic-model",
      output: [
        { type: "reasoning", summary: [] },
        {
          type: "message",
          content: [
            { type: "output_text", text: "First paragraph." },
            { type: "output_text", text: "Second paragraph." },
          ],
        },
      ],
      usage: { input_tokens: 12, output_tokens: 8 },
    },
  });
  assert.equal(summary.text, "First paragraph.\n\nSecond paragraph.");
  assert.equal(summary.error, false);
  assert.match(summary.meta, /12 input tokens/);
});
test("errors, refusals and non-text outputs are not presented as normal text answers", () => {
  assert.equal(
    responseSummary({
      status: 429,
      response: { error: { message: "Rate limited" } },
    }).error,
    true,
  );
  assert.equal(
    responseSummary({
      status: 429,
      response: { error: { message: "Rate limited" } },
    }).text,
    "Rate limited",
  );
  assert.equal(
    responseSummary({
      status: 200,
      response: {
        output: [
          {
            content: [{ type: "refusal", refusal: "I cannot help with that." }],
          },
        ],
      },
    }).text,
    "I cannot help with that.",
  );
  assert.match(
    responseSummary({
      status: 200,
      response: { output: [{ type: "function_call" }] },
    }).text,
    /no text answer/,
  );
  assert.match(
    responseSummary({
      status: 200,
      response: { status: "incomplete", output_text: "Partial" },
    }).meta,
    /Incomplete/,
  );
});
