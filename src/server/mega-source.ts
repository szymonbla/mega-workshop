import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import type { BrowserContext } from "playwright";
import { chromium } from "playwright";
import type { SourceMetadata } from "../shared/types.ts";

export class AccessError extends Error {
  status = 401;
  constructor(
    message = "Log in to MEGA in the browser window, then select “Continue”.",
  ) {
    super(message);
    this.status = 401;
  }
}
export class LessonUnavailableError extends AccessError {}

export function lessonAddress(value: string) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Paste a MEGA lesson link.");
  }
  const match = /^\/lessons\/(s0[1-4]e0[1-5])\/?$/.exec(url.pathname);
  if (
    url.origin !== "https://hq.mega.dev" ||
    url.username ||
    url.password ||
    !match
  )
    throw new Error("Use a lesson link from https://hq.mega.dev/lessons/.");
  return { id: match[1], url: `https://hq.mega.dev/lessons/${match[1]}/` };
}
export function parseLessonPage(html: string, url: string): SourceMetadata {
  const { document } = parseHTML(html);
  if (
    !document.querySelector(
      'a[href="/logout"], a[href="https://hq.mega.dev/logout"]',
    )
  )
    throw new AccessError();
  const markdown = document
    .querySelector('a[href$="/lesson.md"]')
    ?.getAttribute("href");
  if (!markdown)
    throw new LessonUnavailableError(
      "This account cannot open this lesson yet. Check its publication date and your MEGA access.",
    );
  const absolute = (value: string | null | undefined) =>
    value ? new URL(value, url).href : null;
  const chapters = [
    ...document.querySelectorAll(".lesson-audio-chapters button[data-start]"),
  ].map((button, i) => ({
    slug:
      button.getAttribute("data-heading") || (i === 0 ? "introduction" : ""),
    start: Number(button.getAttribute("data-start")),
    title:
      button.querySelector("span:last-child")?.textContent || "Introduction",
  }));
  return {
    markdown: new URL(markdown, url).href,
    transcript: absolute(
      document.querySelector('a[href$="/transcript.md"]')?.getAttribute("href"),
    ),
    audio: absolute(document.querySelector("audio[src]")?.getAttribute("src")),
    chapters,
    duration: Number(
      document.querySelector(".lesson-audio-seek")?.getAttribute("max"),
    ),
  };
}
export class MegaSource {
  directory: string;
  context: BrowserContext | null;
  opening: Promise<void> | null;
  visible = false;
  checks: Map<string, Promise<SourceMetadata>>;
  constructor(directory: string) {
    this.directory = directory;
    this.context = null;
    this.opening = null;
    this.checks = new Map();
  }
  async browser(visible = false) {
    while (this.opening) await this.opening;
    this.opening = this.openBrowser(visible);
    try {
      await this.opening;
    } finally {
      this.opening = null;
    }
    if (!this.context)
      throw Error("The MEGA browser closed before it was ready.");
    return this.context;
  }
  private async openBrowser(visible: boolean) {
    if (visible && this.context && !this.visible) {
      await this.context.close();
      this.context = null;
    }
    if (!this.context) {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      const channel =
        process.env.BROWSER_CHANNEL ||
        (process.platform === "darwin" &&
        existsSync("/Applications/Google Chrome.app")
          ? "chrome"
          : undefined);
      this.context = await chromium.launchPersistentContext(
        join(this.directory, "browser"),
        {
          headless: !visible,
          acceptDownloads: false,
          ...(channel ? { channel } : {}),
        },
      );
      const context = this.context;
      try {
        const cookies = JSON.parse(
          await readFile(join(this.directory, "cookies.json"), "utf8"),
        );
        await context.addCookies(cookies);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          await context.close();
          this.context = null;
          throw error;
        }
      }
      this.visible = visible;
      context.on("close", () => {
        if (this.context === context) this.context = null;
      });
    }
  }
  private saving: Promise<void> = Promise.resolve();
  async saveSession() {
    const context = this.context;
    if (!context) return;
    const pending = this.saving
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const file = join(this.directory, "cookies.json");
        await writeFile(
          file + ".tmp",
          JSON.stringify(await context.cookies()),
          { mode: 0o600 },
        );
        await rename(file + ".tmp", file);
      });
    this.saving = pending;
    await pending;
  }
  async login() {
    const context = await this.browser(true);
    const page = context.pages()[0] || (await context.newPage());
    await page.goto("https://hq.mega.dev/lessons", {
      waitUntil: "domcontentloaded",
    });
    await page.bringToFront();
  }
  async get(url: string, kind = "text") {
    const address = new URL(url);
    if (
      address.origin !== "https://hq.mega.dev" ||
      !/^\/(lessons|figures)\//.test(address.pathname)
    )
      throw Error("Unexpected material URL.");
    const context = await this.browser();
    const response = await context.request.get(address.href, {
      maxRedirects: 0,
      timeout: 120000,
    });
    try {
      if (
        response.status() === 401 ||
        (response.status() === 403 && kind !== "lesson") ||
        (response.status() >= 300 && response.status() < 400)
      )
        throw new AccessError();
      if ([403, 404].includes(response.status()) && kind === "lesson")
        throw new LessonUnavailableError("This lesson is not published yet.");
      if (!response.ok())
        throw Error(
          `MEGA could not return a material (HTTP ${response.status()}). Retry this step.`,
        );
      const type = response.headers()["content-type"] || "";
      if (kind === "audio" && !/audio\//.test(type)) throw new AccessError();
      if (kind === "image" && !/image\/(png|jpeg|webp)/.test(type))
        throw Error("MEGA did not return a supported image.");
      const body = await response.body();
      if (
        kind === "markdown" &&
        /<!doctype|<html/i.test(body.toString().slice(0, 500))
      )
        throw new AccessError();
      return body;
    } finally {
      await response.dispose();
    }
  }
  async check(id: string): Promise<SourceMetadata> {
    if (this.checks.has(id)) return this.checks.get(id)!;
    const { url } = lessonAddress(`https://hq.mega.dev/lessons/${id}/`);
    const pending = this.get(url, "lesson")
      .then(async (body) => {
        const metadata = parseLessonPage(body.toString(), url);
        await this.saveSession();
        return metadata;
      })
      .finally(() => this.checks.delete(id));
    this.checks.set(id, pending);
    return pending;
  }
  async availableLessons(ids: string[]) {
    const available = [];
    for (const id of ids) {
      try {
        await this.check(id);
        available.push(id);
      } catch (error) {
        if (!(error instanceof LessonUnavailableError)) throw error;
      }
    }
    if (ids.includes("s01e01")) await this.check("s01e01");
    return available;
  }
  async logout() {
    if (this.opening) await this.opening;
    const context = await this.browser();
    await this.saving.catch(() => {});
    await rm(join(this.directory, "cookies.json"), { force: true });
    await context.clearCookies();
    await context.close();
  }
  async close() {
    if (this.opening) await this.opening;
    await this.saving.catch(() => {});
    await this.context?.close();
  }
}
