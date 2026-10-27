import assert from "node:assert/strict";
import test from "node:test";
import { verifyProviderKey } from "../src/server/verify-key.ts";

for (const provider of ["openai", "openrouter"] as const) {
  test(`${provider} checks the authenticated endpoint without generating tokens`, async () => {
    let cancelled = false;
    const result = await verifyProviderKey(
      provider,
      "synthetic-test-key",
      async (url, init) => {
        assert.equal(
          url,
          provider === "openai"
            ? "https://api.openai.com/v1/models"
            : "https://openrouter.ai/api/v1/key",
        );
        assert.equal(init?.method, "GET");
        assert.equal(
          new Headers(init?.headers).get("Authorization"),
          "Bearer synthetic-test-key",
        );
        assert.equal(init?.redirect, "error");
        assert.ok(init?.signal instanceof AbortSignal);
        assert.equal(init?.body, undefined);
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        );
      },
    );
    assert.equal(result, undefined);
    assert.equal(cancelled, true);
  });
  for (const [upstream, status, message] of [
    [401, 400, "rejected"],
    [403, 400, "permissions"],
    [402, 400, "billing"],
    [429, 429, "limit"],
    [500, 502, "unavailable"],
    [302, 502, "unavailable"],
  ] as const) {
    test(`${provider} handles ${upstream} without returning upstream secrets`, async () => {
      const result = await verifyProviderKey(
        provider,
        "synthetic-test-key",
        async () => new Response("synthetic-test-key", { status: upstream }),
      );
      assert.equal(result?.status, status);
      assert.ok(result?.error.includes(message));
      assert.ok(result?.error.includes("not saved"));
      assert.ok(!result?.error.includes("synthetic-test-key"));
    });
  }
}
for (const name of ["TimeoutError", "AbortError", "TypeError"]) {
  test(`verification handles ${name} without leaking request details`, async () => {
    const result = await verifyProviderKey(
      "openai",
      "synthetic-test-key",
      async () => {
        const error = Error("synthetic-test-key");
        error.name = name;
        throw error;
      },
    );
    assert.equal(result?.status, name === "TypeError" ? 502 : 504);
    assert.ok(!result?.error.includes("synthetic-test-key"));
  });
}
