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
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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

test("startup explains delayed connection and course loading before revealing the workspace", async (t) => {
  const context = await openContext(t);
  let releaseStatus!: () => void;
  let releaseCourse!: () => void;
  const statusGate = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  const courseGate = new Promise<void>((resolve) => {
    releaseCourse = resolve;
  });
  t.after(() => {
    releaseStatus();
    releaseCourse();
  });
  await context.route("**/study-api/auth/status", async (route) => {
    await statusGate;
    await route.continue();
  });
  await context.route("**/study-api/import-labs", async (route) => {
    await courseGate;
    await route.continue();
  });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator("#startup").waitFor({ state: "visible" });
  assert.match(
    await page.locator("#startup-detail").innerText(),
    /saved MEGA connection/,
  );
  assert.equal(await page.locator("#course-overview").isVisible(), false);
  releaseStatus();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".startup-stages li:last-child")
        ?.getAttribute("data-state") === "active",
  );
  assert.match(
    await page.locator("#startup-detail").innerText(),
    /Loading your course/,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".loading-orbit")
      .evaluate(
        (element) => getComputedStyle(element, "::before").animationName,
      ),
    "none",
  );
  releaseCourse();
  await page.locator("#startup").waitFor({ state: "hidden" });
  await page.locator("#week-grid .course-lesson").first().waitFor();
});

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
        labs: ["responses-request"], // Stale metadata without an article link.
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
  await chapter(page, "Inserted topic");
  assert.equal(await page.locator("#tab-practice").isVisible(), false);
  assert.equal(await page.locator("#panel-practice").isVisible(), false);
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

test("a browser without a saved connection must connect before seeing lesson content", async (t) => {
  // Earlier tests leave a restorable session on this shared test server.
  const connected = await openContext(t);
  const logout = await connected.request.post(base + "study-api/auth/logout", {
    headers: { Origin: new URL(base).origin },
    data: {},
  });
  assert.equal(logout.status(), 200);
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

test("practice presents pending, readable answer, changed input and failed retry (synthetic API)", {
  timeout: 60000,
}, async (t) => {
  const context = await openContext(t);
  const page = await context.newPage();
  let complete: (() => void) | undefined;
  let requestNumber = 0;
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  const evidence = join(dataHome, ".audit", "practice-feedback");
  await mkdir(evidence, { recursive: true });
  // Simulate the example API response; no provider request leaves this browser.
  await context.route(
    "**/api/items/responses-request/call/run",
    async (route) => {
      requestNumber++;
      if (requestNumber === 1) {
        await new Promise<void>((resolve) => {
          complete = resolve;
          requestStarted();
        });
        await route.fulfill({
          json: {
            ok: true,
            result: {
              status: 200,
              response: {
                model: "synthetic-model",
                output: [
                  {
                    type: "message",
                    content: [
                      {
                        type: "output_text",
                        text: "A model can summarize a document.\nCheck the summary against the original.",
                      },
                    ],
                  },
                ],
                usage: { input_tokens: 12, output_tokens: 18 },
              },
            },
          },
        });
      } else
        await route.fulfill({
          json: { ok: false, error: "Synthetic connection failure" },
        });
    },
  );
  await page.goto(base + "#/lesson/s01e01/request");
  await page
    .locator("#chapters button")
    .filter({ hasText: "Model Requests" })
    .click();
  await page.locator("#tab-practice").click();
  const lab = page.frameLocator('iframe[src="/ui/responses-request/"]');
  await lab.locator("#run").filter({ hasText: "Get model response" }).waitFor();
  await lab.locator("#run").click();
  await lab.locator('.workshop-answer[data-state="loading"]').waitFor();
  assert.equal(await lab.locator("#run").isDisabled(), true);
  await started;
  await page.screenshot({
    path: join(evidence, "waiting.png"),
    fullPage: true,
  });
  assert.ok(complete);
  complete();
  await lab.locator('.workshop-answer[data-state="ready"]').waitFor();
  assert.match(
    await lab.locator(".workshop-answer-text").innerText(),
    /A model can summarize/,
  );
  assert.equal(
    await lab.locator(".workshop-response-details").getAttribute("open"),
    null,
  );
  await lab.locator(".workshop-result-nav button").click();
  await page.screenshot({
    path: join(evidence, "answer-desktop.png"),
    fullPage: true,
  });
  await lab.locator(".workshop-response-details summary").click();
  assert.match(await lab.locator("#result").innerText(), /synthetic-model/);
  await lab.locator(".workshop-response-details summary").click();
  await lab.locator("#prompt").fill("A different prompt");
  assert.match(
    await lab.locator(".workshop-response-status").innerText(),
    /input has changed/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await lab.locator(".workshop-result-nav button").click();
  await page.screenshot({
    path: join(evidence, "answer-mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await lab
      .locator("html")
      .evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await lab.locator("#run").click();
  await lab.locator('.workshop-answer[data-state="error"]').waitFor();
  assert.match(
    await lab.locator(".workshop-answer-text").innerText(),
    /Synthetic connection failure/,
  );
  assert.doesNotMatch(
    await lab.locator(".workshop-answer-text").innerText(),
    /A model can summarize/,
  );
  assert.equal(
    await lab.locator(".workshop-response-details").isVisible(),
    false,
  );
});

test("context budget distinguishes a live calculation from an API answer", async (t) => {
  const context = await openContext(t);
  const page = await context.newPage();
  await page.goto(base + "#/lesson/s01e01/context-budget");
  await waitTitle(page, "Context Budget");
  await page.locator("#tab-practice").click();
  const lab = page.frameLocator('iframe[src="/ui/context-window-budget/"]');
  await lab
    .locator("#headline")
    .filter({ hasText: "This request uses" })
    .waitFor();
  const previous = await lab.locator("#headline").textContent();
  await lab.locator("#filler-10k").click();
  await page.waitForFunction((before) => {
    const frame = document.querySelector<HTMLIFrameElement>(
      'iframe[src="/ui/context-window-budget/"]',
    );
    const text =
      frame?.contentDocument?.querySelector("#headline")?.textContent;
    return Boolean(text?.includes("This request uses") && text !== before);
  }, previous);
  assert.notEqual(await lab.locator("#headline").textContent(), previous);
  await lab.locator(".workshop-result-nav button").click();
  assert.equal(
    await lab.locator(".workshop-result-heading").innerText(),
    "Your result · live calculation",
  );
});
