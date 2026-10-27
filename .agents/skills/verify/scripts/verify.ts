#!/usr/bin/env node
import assert from "node:assert/strict";
import type { ChildProcessByStdio } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { dataHome } from "../../../../src/server/paths.ts";
import { errorMessage } from "../../../../src/shared/errors.ts";
import type {
  Curriculum,
  ProviderStatus,
} from "../../../../src/shared/types.ts";
import { verifyLayout } from "./layout.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const evidenceRoot = resolve(dataHome, ".audit/verify");
await mkdir(evidenceRoot, { recursive: true });
const evidence = await mkdtemp(join(evidenceRoot, "run-"));
const scratch = await mkdtemp(join(tmpdir(), "mega-verify-"));
const env: NodeJS.ProcessEnv = {
  ...process.env,
  PORT: "0",
  MEX_ENV_FILE: join(scratch, ".env"),
};
delete env.OPENAI_API_KEY;
delete env.OPENROUTER_API_KEY;
interface Report {
  feature: string;
  externalBoundary: string;
  entry: string;
  node: string;
  root: string;
  scratch: string;
  actions: { at: string; action: string }[];
  errors: string[];
  blockedExternalRequests: string[];
  result: string;
  doctor?: {
    pid?: number;
    base: string;
    lessons: number;
    providersConfigured: boolean;
  };
  importedLesson?: {
    id: string;
    chapters: number;
    images: number;
    wordMaps: number;
  };
  failure?: string;
  cleanup?: {
    serverStopped: boolean;
    scratchRemoved: boolean;
    errors: string[];
  };
}
const report: Report = {
  feature: "authentication, navigation, imported lesson, audio and exercises",
  externalBoundary:
    "MEGA authentication is simulated; no real account, email login or new remote import is exercised",
  entry: "course card → topic → overview → resume",
  node: process.version,
  root,
  scratch,
  actions: [],
  errors: [],
  blockedExternalRequests: [],
  result: "failed",
};
let child!: ChildProcessByStdio<null, Readable, Readable>,
  browser: Browser | undefined,
  context: BrowserContext | undefined,
  page: Page,
  serverLog = "";
const record = (action: string) =>
  report.actions.push({ at: new Date().toISOString(), action });
async function capture(name: string) {
  await page.screenshot({
    path: join(evidence, `${name}.png`),
    fullPage: true,
  });
  await writeFile(
    join(evidence, `${name}.aria.txt`),
    await page.locator("body").ariaSnapshot(),
  );
}
async function doctor(base: string) {
  assert.equal(child.exitCode, null);
  const response = await context!.request.get(base + "study-api/curriculum");
  assert.equal(response.status(), 200);
  const catalog: Curriculum = await response.json();
  assert.equal(catalog.weeks.length, 4);
  const lessons = catalog.weeks.flatMap((week) => week.lessons);
  assert.equal(lessons.length, 20);
  assert.ok(
    lessons
      .find((lesson) => lesson.id === "s01e01")!
      .sections.some((section) => section.slug === "tokenization"),
  );
  const status: ProviderStatus = await context!.request
    .get(base + "api/status")
    .then((r) => r.json());
  assert.ok(
    status.providers.every((provider) => !provider.set),
    "Verification must have no configured provider",
  );
  report.doctor = {
    pid: child.pid,
    base,
    lessons: lessons.length,
    providersConfigured: false,
  };
  await writeFile(
    join(evidence, "doctor.json"),
    JSON.stringify(report.doctor, null, 2),
  );
}
try {
  child = spawn(process.execPath, [".agents/skills/verify/scripts/server.ts"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (data) => {
    serverLog += data;
  });
  const base = await new Promise<string>((resolveURL, reject) => {
    const timer = setTimeout(
      () => reject(Error("MEGA Workshop startup timed out")),
      15000,
    );
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(`MEGA Workshop exited: ${code}`));
    });
    child.stdout.on("data", (data) => {
      serverLog += data;
      const match = /MEGA Workshop → (http:\/\/localhost:\d+\/)/.exec(
        serverLog,
      );
      if (match) {
        clearTimeout(timer);
        resolveURL(match[1]);
      }
    });
  });
  browser = await chromium.launch(
    process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {},
  );
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: evidence, size: { width: 1440, height: 1000 } },
  });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === new URL(base).origin)
      return route.continue();
    report.blockedExternalRequests.push(route.request().url());
    return route.abort();
  });
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  let automaticSyncRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/study-api/imports/sync")
    )
      automaticSyncRequests++;
  });
  page.on("pageerror", (error) => report.errors.push(error.message));
  record(
    "Verify anonymous content and audio are denied, then open the connection screen",
  );
  for (const path of [
    "study-api/curriculum",
    "study/figures/figure-1.png",
    "study/audio/tokenization.mp3",
    "study/materials/s01e02/audio/introduction.mp3",
  ]) {
    assert.equal((await context!.request.get(base + path)).status(), 401, path);
  }
  await page.goto(base);
  await page.locator("#lesson-import[open]").waitFor();
  await capture("00-login-required");
  record("Click Continue before MEGA login: access must remain blocked");
  await page.locator("#import-connected").click();
  await page
    .locator("#import-message")
    .filter({ hasText: "Log in to MEGA" })
    .waitFor();
  assert.equal(await page.locator("#article").textContent(), "");
  record("Click Log in to MEGA (simulated external boundary), then Continue");
  await page.locator("#import-login").click();
  await page
    .locator("#import-message")
    .filter({ hasText: "Finish signing in" })
    .waitFor();
  await page.locator("#import-connected").click();
  await page.locator("#import-form:not([hidden])").waitFor();
  await page
    .locator("#import-sync-status")
    .filter({ hasText: "All 2 available lessons are ready." })
    .waitFor();
  assert.equal(automaticSyncRequests, 1);
  record(
    "Login automatically synchronizes available lessons; existing local materials are preserved",
  );
  await capture("00-automatic-sync");
  await page.locator("#import-close").click();
  await doctor(base);
  record("Open course overview");
  await page.locator('[data-course="s01e01"]').waitFor();
  assert.equal(await page.locator("[data-course]").count(), 20);
  await capture("01-overview");
  record("Click S01E01 course card, then Tokenization in the topic list");
  await page.locator('[data-course="s01e01"]').click();
  await page
    .locator("#chapters button")
    .filter({ hasText: "Tokenization" })
    .click();
  await page.waitForFunction(
    () => document.querySelector("#title")?.textContent === "Tokenization",
  );
  assert.match(page.url(), /#\/lesson\/s01e01\/tokenization$/);
  await capture("02-topic");
  await verifyLayout(page, evidence, record, capture);
  record(
    "Play audio, enter Practice, and verify a compact workspace without outer scrolling",
  );
  await page.locator("#audio-mini-play").click();
  await page.waitForFunction(
    () => !document.querySelector<HTMLAudioElement>("audio")!.paused,
  );
  await page.locator("#tab-practice").click();
  assert.equal(await page.locator(".topic-audio").isVisible(), false);
  assert.equal(
    await page
      .locator("audio")
      .evaluate((audio: HTMLAudioElement) => audio.paused),
    true,
  );
  const localLab = page.frameLocator(
    'iframe[src="/ui/tokenization-round-trip/"]',
  );
  await localLab.locator("#text").fill("Practice without distractions 🌍");
  await localLab
    .locator("#headline-text")
    .filter({ hasText: "Decoding the IDs gives back the same text." })
    .waitFor();
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator("#tab-practice").scrollIntoViewIfNeeded();
    const geometry = await page.locator(".practice").evaluate((panel) => {
      const frame = panel.querySelector("iframe:not([hidden])")!;
      return {
        overflow: panel.scrollHeight - panel.clientHeight,
        height: frame.getBoundingClientRect().height,
        width: document.documentElement.scrollWidth - innerWidth,
      };
    });
    assert.ok(geometry.overflow <= 1, JSON.stringify(geometry));
    assert.ok(geometry.height > 450, JSON.stringify(geometry));
    assert.ok(geometry.width <= 1, JSON.stringify(geometry));
    await page.locator(".task summary").click();
    assert.equal(await page.locator("#task").isVisible(), true);
    await page.locator(".task summary").click();
    await capture(`02-practice-${viewport.width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#tab-read").click();
  assert.equal(await page.locator(".topic-audio").isVisible(), true);
  await page
    .locator('#article a[href*="/examples/tokenization-round-trip"]')
    .click();
  assert.equal(
    await localLab.locator("#text").inputValue(),
    "Practice without distractions 🌍",
  );
  await page.locator("#tab-read").click();

  record("Return to overview, reload, then click Continue learning");
  await page.locator("#back-course").click();
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector("#import-sync-status")?.textContent ===
      "All 2 available lessons are ready.",
  );
  assert.equal(
    automaticSyncRequests,
    2,
    "Reopening with a valid session automatically checks for new lessons",
  );
  await page.locator("#resume").click();
  await page.waitForFunction(
    () => document.querySelector("#title")?.textContent === "Tokenization",
  );
  const storage = await page.evaluate(() =>
    Object.fromEntries(Object.entries(localStorage)),
  );
  assert.equal(storage["mega-study-v2:s01e01:current-section:"], "step-4");
  await writeFile(
    join(evidence, "storage.json"),
    JSON.stringify(storage, null, 2),
  );
  await capture("03-resumed");
  record("Complete one topic and undo it after reload using the topic control");
  await page.locator("#complete-topic").click();
  assert.equal(
    await page.locator("#progress-label").textContent(),
    "1 of 24 topics completed",
  );
  await page.reload();
  await page
    .locator('#complete-topic[aria-pressed="true"]')
    .waitFor({ state: "visible" });
  await capture("03-topic-completed");
  await page.locator("#complete-topic").click();
  assert.equal(
    await page.locator("#progress-label").textContent(),
    "0 of 24 topics completed",
  );
  await page.reload();
  await page
    .locator('#complete-topic[aria-pressed="false"]')
    .waitFor({ state: "visible" });
  assert.equal(
    await page.locator("#progress-label").textContent(),
    "0 of 24 topics completed",
  );

  record(
    "Complete S01E01 through the button, then reload and verify persisted course progress",
  );
  await page.locator("#complete-lesson").click();
  assert.equal(
    await page.locator("#progress-label").textContent(),
    "24 of 24 topics completed",
  );
  assert.equal(await page.locator("#complete-lesson").isDisabled(), true);
  await capture("03-completed");
  record("Undo one topic from a completed lesson, then complete it again");
  await page.locator("#complete-topic").click();
  assert.equal(
    await page.locator("#progress-label").textContent(),
    "23 of 24 topics completed",
  );
  assert.equal(await page.locator("#complete-lesson").isDisabled(), false);
  await page.locator("#complete-topic").click();
  assert.equal(await page.locator("#complete-lesson").isDisabled(), true);

  await page.reload();
  await page.locator("#complete-lesson:disabled").waitFor({ state: "visible" });
  assert.equal(
    await page.locator("#progress-label").textContent(),
    "24 of 24 topics completed",
  );
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("mega-study-v2:s01e01:status:step-4"),
    ),
    "done",
  );
  await page.locator("#back-course").click();
  assert.match(
    await page.locator('[data-course="s01e01"]').innerText(),
    /Completed/,
  );
  assert.equal(await page.locator("#course-count").textContent(), "1 / 20");
  await capture("03-completed-overview");
  await page.locator('[data-course="s01e01"]').click();
  record("Open pending S02E03, then Continue available lesson");
  await page.locator("#back-course").click();
  await page.locator('[data-course="s02e03"]').click();
  await page.locator("#pending-lesson").waitFor({ state: "visible" });
  await capture("04-pending");
  await page.locator("#pending-continue").click();
  await page.waitForFunction(
    () => document.querySelector("#title")?.textContent === "Tokenization",
  );
  record("Open S01E02 imported materials through the course card");
  await page.locator("#back-course").click();
  await page.locator('[data-course="s01e02"]').click();
  await page
    .locator("#chapters button")
    .filter({ hasText: "Harness Personalization" })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("#title")?.textContent ===
      "Harness Personalization",
  );
  const catalog: Curriculum = await (
    await context!.request.get(base + "study-api/curriculum")
  ).json();
  const imported = catalog.weeks
    .flatMap((w) => w.lessons)
    .find((l) => l.id === "s01e02")!;
  assert.equal(imported.sections.length, 7);
  assert.ok(
    imported.sections.every((s) => (s.audio?.alignment?.cues.length ?? 0) > 0),
  );
  const imagePaths = [
    ...new Set(
      imported.sections.flatMap((s) =>
        [...(s.html || "").matchAll(/<img[^>]+src="([^"]+)"/g)].map(
          (m) => m[1],
        ),
      ),
    ),
  ];
  assert.equal(imagePaths.length, 22);
  for (const path of imagePaths)
    assert.equal(
      (await context!.request.get(new URL(path, base).href)).status(),
      200,
    );
  for (const image of await page.locator("#article img").all()) {
    await image.scrollIntoViewIfNeeded();
    await image.evaluate(async (element) => {
      await (element as HTMLImageElement).decode();
    });
  }
  await page.locator("#title").scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLImageElement>("#article img")].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  const transcript = await context!.request.get(
    new URL(imported.transcriptUrl!, base).href,
  );
  assert.equal(transcript.status(), 200);
  assert.ok((await transcript.text()).length > 1000);
  const recording = await context!.request.get(
    new URL(imported.sections[1].audio!.src, base).href,
    { headers: { Range: "bytes=0-9" } },
  );
  assert.equal(recording.status(), 206);
  assert.equal((await recording.body()).length, 10);
  report.importedLesson = {
    id: imported.id,
    chapters: imported.sections.length,
    images: imagePaths.length,
    wordMaps: imported.sections.filter((s) => s.audio?.alignment).length,
  };
  await capture("05-imported-reader");
  record(
    "Play imported chapter, verify advancing audio, pause and seek with a timed word",
  );
  await page.locator("#audio-mini-play").click();
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLAudioElement>("#topic-audio")!.currentTime >
        0.3 &&
      !document.querySelector<HTMLAudioElement>("#topic-audio")!.paused,
  );
  await page.locator("#audio-mini-play").click();
  await page.locator("#audio-collapse").click();
  const word = page.locator("[data-audio-time]").nth(8);
  const wordTime = Number(await word.getAttribute("data-audio-time"));
  await word.focus();
  await word.press("Enter");
  await page.waitForFunction((time) => {
    const audio = document.querySelector<HTMLAudioElement>("#topic-audio")!;
    return (
      !audio.paused && audio.currentTime >= time && audio.currentTime < time + 3
    );
  }, wordTime);
  await capture("06-imported-audio");
  await page.locator("#audio-play").click();
  record("Open an imported exercise without making a paid request");
  await page.locator("#tab-practice").click();
  const lab = page.frameLocator(
    'iframe[src="/study-labs/s01e02/ui/context-self-report/"]',
  );
  await lab.getByText("The agent's context", { exact: true }).waitFor();
  record(
    "Verify wheel scrolling moves the exercise inside the fitted Practice panel",
  );
  await page.waitForFunction(() => {
    const frame = document.querySelector<HTMLIFrameElement>(
      "#lab-host iframe:not([hidden])",
    )!;
    return (
      frame.clientHeight > 450 &&
      frame.clientHeight <= document.querySelector("#lab-host")!.clientHeight
    );
  });
  await lab.locator("summary").first().click();
  await lab.getByText("The agent's context", { exact: true }).hover();
  const scrollBefore = await lab
    .locator("html")
    .evaluate(() =>
      [...document.querySelectorAll("*")].reduce(
        (sum, el) => sum + el.scrollTop,
        0,
      ),
    );
  await page.mouse.wheel(0, 500);
  await page.waitForFunction((before) => {
    const content = document.querySelector<HTMLIFrameElement>(
      "#lab-host iframe:not([hidden])",
    )!.contentDocument!;
    return (
      [...content.querySelectorAll("*")].reduce(
        (sum, el) => sum + el.scrollTop,
        0,
      ) >
      before + 10
    );
  }, scrollBefore);
  await capture("07-imported-exercise");
  record("Check Practice at phone width without horizontal page overflow");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#tab-practice").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const frame = document.querySelector<HTMLIFrameElement>(
      "#lab-host iframe:not([hidden])",
    )!;
    return (
      frame.clientHeight > 450 &&
      frame.clientHeight <= document.querySelector("#lab-host")!.clientHeight
    );
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await capture("07-mobile-practice");
  await page.setViewportSize({ width: 1440, height: 1000 });
  record("Open pending lesson import form and reject a non-MEGA URL");
  await page.locator("#back-course").click();
  await page.locator('[data-course="s02e03"]').click();
  await page.locator("#pending-import").click();
  assert.equal(
    await page.locator("#import-url").inputValue(),
    "https://hq.mega.dev/lessons/s02e03/",
  );
  await page.locator("#import-url").fill("https://example.com/lesson");
  await page.locator("#import-submit").click();
  await page
    .locator("#import-message")
    .filter({ hasText: "Use a lesson link" })
    .waitFor();
  await capture("08-invalid-import");
  record(
    "Disconnect and verify loaded content and direct URLs are locked again",
  );
  await page.locator("#import-disconnect").click();
  await page.locator("#import-auth:not([hidden])").waitFor();
  assert.equal(await page.locator("#article").textContent(), "");
  assert.equal(
    (await context!.request.get(base + "study-api/curriculum")).status(),
    401,
  );
  assert.equal(
    (
      await context!.request.get(
        new URL(imported.sections[1].audio!.src, base).href,
      )
    ).status(),
    401,
  );
  assert.equal(
    (
      await context!.request.get(
        base + "study-labs/s01e02/ui/context-self-report/",
      )
    ).status(),
    401,
  );
  await capture("09-disconnected");
  assert.deepEqual(report.errors, []);
  report.result = "passed";
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
  if (page!) await capture("failure").catch(() => {});
} finally {
  const cleanupErrors: string[] = [];
  for (const operation of [
    () => context?.tracing.stop({ path: join(evidence, "trace.zip") }),
    () => context?.close(),
    () => browser?.close(),
    async () => {
      if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
        return;
      await new Promise<void>((resolveExit) => {
        const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolveExit();
        });
        child.kill("SIGTERM");
      });
    },
    () => rm(scratch, { recursive: true, force: true }),
  ]) {
    try {
      await operation();
    } catch (error) {
      cleanupErrors.push(errorMessage(error));
    }
  }
  report.cleanup = {
    serverStopped:
      !child?.pid || child.exitCode !== null || child.signalCode !== null,
    scratchRemoved: await stat(scratch).then(
      () => false,
      (error) => error.code === "ENOENT",
    ),
    errors: cleanupErrors,
  };
  if (
    cleanupErrors.length ||
    !report.cleanup.serverStopped ||
    !report.cleanup.scratchRemoved
  ) {
    report.result = "failed";
    process.exitCode = 1;
  }
  await writeFile(join(evidence, "server.log"), serverLog);
  await writeFile(
    join(evidence, "report.json"),
    JSON.stringify(report, null, 2),
  );
  assert.ok((await stat(join(evidence, "report.json"))).size > 0);
  console.log(
    JSON.stringify(
      { result: report.result, evidence, cleanup: report.cleanup },
      null,
      2,
    ),
  );
}
