import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserContext } from "playwright";
import {
  AccessError,
  LessonUnavailableError,
  MegaSource,
  parseLessonPage,
} from "../src/server/mega-source.ts";
import { sourceMetadata } from "./fixtures/synthetic.ts";

test("discovery skips unreleased lessons but never treats session or network failures as success", async () => {
  const source = new MegaSource("/unused");
  source.check = async (id) => {
    if (id === "s01e02") throw new LessonUnavailableError();
    return sourceMetadata;
  };
  assert.deepEqual(
    await source.availableLessons(["s01e01", "s01e02", "s01e03"]),
    ["s01e01", "s01e03"],
  );
  for (const error of [new AccessError(), Error("Network failure")]) {
    source.check = async () => {
      throw error;
    };
    await assert.rejects(source.availableLessons(["s01e01"]), error);
  }
});
test("authenticated pending lessons differ from a login page", () => {
  assert.throws(
    () =>
      parseLessonPage(
        '<a href="/logout">Sign out</a><p>Not yet released</p>',
        "https://hq.mega.dev/lessons/s01e02/",
      ),
    LessonUnavailableError,
  );
  assert.throws(
    () =>
      parseLessonPage(
        "<form>Sign in</form>",
        "https://hq.mega.dev/lessons/s01e02/",
      ),
    (error) =>
      error instanceof AccessError &&
      !(error instanceof LessonUnavailableError),
  );
});

test("HTTP 403/404 on unpublished lesson slots do not prevent downloading accessible lessons", async () => {
  const source = new MegaSource("/unused");
  let expired = false;
  source.browser = async () =>
    ({
      request: {
        get: async (url: string) => {
          const status = expired
            ? 401
            : url.includes("s01e02")
              ? 403
              : url.includes("s01e03")
                ? 404
                : 200;
          return {
            status: () => status,
            ok: () => status === 200,
            headers: () => ({ "content-type": "text/html" }),
            body: async () =>
              Buffer.from(
                '<a href="/logout">Out</a><a href="/lessons/s01e01/lesson.md">Text</a>',
              ),
            dispose: async () => {},
          };
        },
      },
    }) as unknown as BrowserContext;
  assert.deepEqual(
    await source.availableLessons(["s01e01", "s01e02", "s01e03"]),
    ["s01e01"],
  );
  expired = true;
  await assert.rejects(source.availableLessons(["s01e01"]), AccessError);
});
