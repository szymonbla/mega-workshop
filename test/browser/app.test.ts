import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { TestContext } from "node:test";
import type { Browser, Page } from "playwright";
import type { Curriculum, ImportJob } from "../../src/shared/types.ts";

declare global {
  interface Window {
    savedLabFrame: Element | null;
    oldFrame: Element | null;
  }
}

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { chromium } from "playwright";
import { dataHome } from "../../src/server/paths.ts";

let browser: Browser,
  child: ChildProcessByStdio<null, Readable, Readable>,
  base: string,
  directory: string;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "mega-browser-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MEX_ENV_FILE: join(directory, ".env"),
    PORT: "0",
  };
  delete env.OPENAI_API_KEY;
  delete env.OPENROUTER_API_KEY;
  child = spawn(process.execPath, ["test/fixtures/authenticated-server.ts"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  base = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("MEGA Workshop did not start")),
      15000,
    );
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
      const match = /http:\/\/localhost:\d+\//.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(`MEGA Workshop exited ${code}`));
    });
  });
  browser = await chromium.launch(
    process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {},
  );
});
after(async () => {
  await browser?.close();
  if (child && child.exitCode === null) {
    child.kill();
    await once(child, "exit");
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function openContext(t: TestContext) {
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === new URL(base).origin
      ? route.continue()
      : route.abort(),
  );
  if (process.env.STUDY_BROWSER_BASELINE === "1") {
    for (const name of ["app", "progress"]) {
      const body = await readFile(
        join(dataHome, `.audit/architecture/${name}.before.js`),
        "utf8",
      );
      await context.route(`**/study/${name}.js`, (route) =>
        route.fulfill({ body, contentType: "text/javascript" }),
      );
    }
  }
  await context.request.post(base + "study-api/auth/complete", {
    headers: {
      Origin: new URL(base).origin,
      "Content-Type": "application/json",
    },
    data: {},
  });
  return context;
}

async function waitTitle(page: Page, title: string) {
  await page.waitForFunction(
    (value) => document.querySelector("#title")?.textContent === value,
    title,
  );
}

async function chapter(page: Page, title: string) {
  await page.locator("#chapters button").filter({ hasText: title }).click();
  await waitTitle(page, title);
}

test("reader preserves old links, lab results, theme and audio interactions", {
  timeout: 60000,
}, async (t) => {
  const context = await openContext(t);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "#tokenization");
  await waitTitle(page, "Tokenization");
  assert.match(page.url(), /#\/lesson\/s01e01\/tokenization$/);
  await page.locator("#tab-practice").click();
  const lab = page.frameLocator('iframe[src="/ui/tokenization-round-trip/"]');
  await lab.locator("#text").fill("Saved experiment 🌍");
  await lab
    .locator("#headline-text")
    .filter({ hasText: "Decoding the IDs gives back the same text." })
    .waitFor();
  await page.evaluate(() => {
    window.savedLabFrame = document.querySelector(
      'iframe[src="/ui/tokenization-round-trip/"]',
    );
  });
  await chapter(page, "Non-determinism");
  await chapter(page, "Tokenization");
  await page.locator("#tab-practice").click();
  assert.equal(await lab.locator("#text").inputValue(), "Saved experiment 🌍");
  assert.equal(
    await page.evaluate(
      () =>
        window.savedLabFrame ===
        document.querySelector('iframe[src="/ui/tokenization-round-trip/"]'),
    ),
    true,
  );
  await page.locator("#theme-toggle").click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  assert.equal(await lab.locator("html").getAttribute("data-theme"), "light");
  await page.locator("#tab-read").click();
  await page.locator("#audio-collapse").click();
  await page.locator("#audio-speed").selectOption("1.5");
  await page.waitForFunction(() =>
    Number.isFinite(document.querySelector("audio")!.duration),
  );
  await page.locator("#audio-play").click();
  await page.waitForFunction(() => !document.querySelector("audio")!.paused);
  await page.evaluate(() => {
    document.querySelector("audio")!.currentTime = 2.5;
  });
  await page.locator(".spoken-word").waitFor();
  assert.equal(
    (await page.locator(".spoken-word").textContent())!.trim(),
    "LLMs",
  );
  await page.locator("#read-highlight").click();
  await page.waitForFunction(() => !document.querySelector(".spoken-word"));
  await page.locator("#read-highlight").click();
  await chapter(page, "Non-determinism");
  assert.equal(
    await page
      .locator("audio")
      .evaluate((audio: HTMLAudioElement) => audio.paused),
    true,
  );
  assert.equal(
    await page
      .locator("audio")
      .evaluate((audio: HTMLAudioElement) => audio.playbackRate),
    1.5,
  );
  await page.locator("#back-course").click();
  await page.locator("#course-overview").waitFor({ state: "visible" });
  await page.goBack();
  await waitTitle(page, "Non-determinism");
  await page.reload();
  await waitTitle(page, "Non-determinism");
  assert.equal(await page.locator("#audio-speed").inputValue(), "1.5");
  assert.deepEqual(errors, []);
});

test("legacy progress resumes and storage changes synchronize real tabs", {
  timeout: 60000,
}, async (t) => {
  const context = await openContext(t);
  const page = await context.newPage();
  await page.goto(base);
  await page.locator("#week-grid button").first().waitFor();
  await page.evaluate(() => {
    localStorage.setItem(
      "mega-study-v1",
      JSON.stringify({
        done: ["step-4"],
        again: ["step-5"],
        current: 3,
        notes: { "step-4": "Keep this note" },
      }),
    );
    localStorage.setItem("mega-study-last", "s01e01");
  });
  await page.reload();
  await page.locator("#resume").click();
  await waitTitle(page, "Tokenization");
  assert.equal(
    await page.locator("#progress-label").textContent(),
    "1 of 24 topics completed",
  );
  await page.locator("#review").click();
  assert.equal(await page.locator("#chapters button").count(), 1);
  await page.locator("#review").click();
  const second = await context.newPage();
  await second.goto(base);
  await second.evaluate(() =>
    localStorage.setItem("mega-study-v2:s01e01:status:step-5", "done"),
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#progress-label")!.textContent ===
      "2 of 24 topics completed",
  );
  await page.reload();
  await waitTitle(page, "Tokenization");
  assert.equal(
    await page.locator("#progress-label").textContent(),
    "2 of 24 topics completed",
  );
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("mega-study-v1") || "null").notes[
          "step-4"
        ],
    ),
    "Keep this note",
  );
  await page.locator("#back-course").click();
  await page.locator('[data-course="s02e03"]').click();
  await page.locator("#pending-lesson").waitFor({ state: "visible" });
  await page.locator("#pending-continue").click();
  await waitTitle(page, "Tokenization");
});

test("legacy numeric resume still opens the original topic after insertion and reordering", {
  timeout: 60000,
}, async (t) => {
  const context = await openContext(t);
  await context.route("**/study-api/curriculum", async (route) => {
    const response = await route.fetch();
    const data: Curriculum = await response.json();
    const lesson = data.weeks
      .flatMap((week) => week.lessons)
      .find((item) => item.id === "s01e01")!;
    lesson.sections = [
      {
        id: "inserted",
        slug: "inserted",
        title: "Inserted topic",
        kind: "topic",
        number: 1,
        html: "<p>Additional material</p>",
        markdown: "Additional material",
        labs: [],
        group: "New material",
        task: "",
        question: "",
        answer: "",
      },
      ...lesson.sections.reverse(),
    ];
    await route.fulfill({ response, json: data });
  });
  const page = await context.newPage();
  await page.goto(base);
  await page.locator("#resume").waitFor();
  await page.evaluate(() => {
    localStorage.setItem(
      "mega-study-v1",
      JSON.stringify({ current: 3, done: ["step-4"] }),
    );
    localStorage.setItem("mega-study-last", "s01e01");
  });
  await page.locator("#resume").click();
  await waitTitle(page, "Tokenization");
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("mega-study-v2:s01e01:current-section:"),
    ),
    "step-4",
  );
  await page.reload();
  await waitTitle(page, "Tokenization");
  await chapter(page, "Planning");
  assert.equal(await page.locator("#tab-practice").isVisible(), false);
  assert.equal(await page.locator("#article").isVisible(), true);
});

test("saving settings resets labs without returning the test credential", {
  timeout: 60000,
}, async (t) => {
  const context = await openContext(t);
  const page = await context.newPage();
  await page.goto(base + "#tokenization");
  await waitTitle(page, "Tokenization");
  await page.locator("#tab-practice").click();
  const lab = page.frameLocator('iframe[src="/ui/tokenization-round-trip/"]');
  await lab.locator("#text").fill("Will be reset on key change");
  await page.evaluate(() => {
    window.oldFrame = document.querySelector("iframe");
  });
  await page.locator("#settings").click();
  await page.locator("#provider").selectOption("openai");
  await page.locator("#api-key").fill("synthetic-browser-test-key");
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/study-api/settings"),
  );
  await page.locator("#key-form button[type=submit]").click();
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  assert.deepEqual(await response.json(), { ok: true });
  await page
    .locator("#config-status")
    .filter({ hasText: "Saved. API key verified." })
    .waitFor();
  assert.equal(await page.locator("#api-key").inputValue(), "");
  await page.waitForFunction(
    () => window.oldFrame !== document.querySelector("iframe"),
  );
  assert.equal(await page.locator("#api-key").isVisible(), false);
  assert.equal(
    await page.locator("#key-form button[type=submit]").isDisabled(),
    true,
  );
  await page
    .locator("#provider-key-status")
    .filter({ hasText: "OpenAI API key is saved" })
    .waitFor();
  await page.locator("#replace-key").click();
  const savedEnv = await readFile(join(directory, ".env"), "utf8");
  await page.locator("#api-key").fill("synthetic-rejected-key");
  await page.locator("#key-form button[type=submit]").click();
  await page
    .locator("#config-status")
    .filter({ hasText: "OpenAI rejected this API key" })
    .waitFor();
  assert.equal(await readFile(join(directory, ".env"), "utf8"), savedEnv);
  assert.equal(await page.locator("#api-key").isDisabled(), false);
  await page.locator("#api-key").fill("synthetic-browser-test-key");
  await page.locator("#key-form button[type=submit]").click();
  await page
    .locator("#config-status")
    .filter({ hasText: "Saved. API key verified." })
    .waitFor();
  await page.locator("#close-config").click();
  await lab.locator("#text").waitFor();
  assert.equal(await lab.locator("#text").inputValue(), "Hey, how are you?");
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(localStorage).includes("synthetic-browser-test-key"),
    ),
    false,
  );
});

test("mobile reader supports keyboard word seeking and highlight preferences", {
  timeout: 60000,
}, async (t) => {
  const context = await openContext(t);
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "#tokenization");
  await waitTitle(page, "Tokenization");
  await page.waitForFunction(() =>
    Number.isFinite(document.querySelector("audio")!.duration),
  );
  const word = page.locator("[data-audio-time]").nth(8);
  const expected = Number(await word.getAttribute("data-audio-time"));
  await word.focus();
  await word.press("Enter");
  await page.waitForFunction((time) => {
    const audio = document.querySelector("audio")!;
    return (
      !audio.paused && audio.currentTime >= time && audio.currentTime < time + 2
    );
  }, expected);
  await page.evaluate(() => document.querySelector("audio")!.pause());
  await page.locator("#audio-collapse").click();
  await page.locator("#read-highlight").click();
  await page.reload();
  await waitTitle(page, "Tokenization");
  assert.equal(
    await page.locator("#read-highlight").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(await page.locator(".spoken-word").count(), 0);
});

test("a new browser must connect to MEGA before seeing any lesson content", async (t) => {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForSelector("#lesson-import[open]");
  assert.equal(await page.locator("#article").textContent(), "");
  assert.equal(
    (await context.request.get(base + "study-api/curriculum")).status(),
    401,
  );
  assert.equal(
    (await context.request.get(base + "study/audio/tokenization.mp3")).status(),
    401,
  );
  await page.locator("#import-connected").click();
  await page.waitForSelector("#week-grid .course-lesson");
  await page.locator("#import-close").click();
  await page.locator('[data-course="s01e01"]').click();
  await page.waitForSelector("#article p");
  await page.locator("#import-button").click();
  await page.locator("#import-disconnect").click();
  await page.waitForSelector("#import-auth:not([hidden])");
  assert.equal(await page.locator("#article").textContent(), "");
  assert.equal(
    (await context.request.get(base + "study-api/lessons")).status(),
    401,
  );
});

test("import dialog shows server progress and resumes an interrupted job with the same link", async (t) => {
  const context = await openContext(t);
  const page = await context.newPage();
  const url = "https://hq.mega.dev/lessons/s01e02/";
  let job: ImportJob = {
    id: "s01e02",
    url,
    status: "interrupted",
    error: "The application stopped.",
    steps: [
      { id: "markdown", label: "Download Markdown", status: "done" },
      { id: "audio", label: "Download recording", status: "pending" },
    ],
  };
  let submitted;
  await page.route("**/study-api/imports", async (route) => {
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON();
      job = {
        ...job,
        status: "running",
        error: null,
        steps: [
          job.steps[0],
          { ...job.steps[1], status: "running", detail: "Downloading" },
        ],
      };
      await route.fulfill({ json: { job } });
    } else await route.fulfill({ json: { jobs: [job] } });
  });
  await page.goto(base);
  await page.locator("#import-button").click();
  await page.waitForSelector("#import-retry:not([hidden])");
  assert.match(
    (await page.locator("#import-steps").textContent()) || "",
    /Download Markdown/,
  );
  await page.locator("#import-retry").click();
  await page.waitForSelector("#import-steps [data-state=running]");
  assert.deepEqual(submitted, { url });
  await page.reload();
  await page.locator("#import-button").click();
  await page.waitForSelector("#import-steps [data-state=running]");
  assert.equal(await page.locator("#import-submit").isDisabled(), true);
});
