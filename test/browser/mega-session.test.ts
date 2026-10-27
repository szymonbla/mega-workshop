import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MegaSource } from "../../src/server/mega-source.ts";

test("MEGA session cookies survive a browser restart and logout clears saved credentials", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mega-cookie-proof-"));
  const source = new MegaSource(directory);
  t.after(async () => {
    await source.close();
    await rm(directory, { recursive: true, force: true });
  });
  const contexts = await Promise.all([
    source.browser(),
    source.browser(),
    source.browser(),
  ]);
  assert.equal(contexts[0], contexts[1]);
  assert.equal(contexts[1], contexts[2]);
  await contexts[0].addCookies([
    {
      name: "synthetic-session",
      value: "synthetic-only",
      domain: "hq.mega.dev",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  await source.saveSession();
  assert.equal(
    (await stat(join(directory, "cookies.json"))).mode & 0o777,
    0o600,
  );
  await source.close();
  const restored = await source.browser();
  const cookie = (await restored.cookies()).find(
    (cookie) => cookie.name === "synthetic-session",
  );
  assert.equal(cookie?.value, "synthetic-only");
  assert.equal(cookie?.expires, -1);
  await source.logout();
  await assert.rejects(stat(join(directory, "cookies.json")), {
    code: "ENOENT",
  });
  assert.deepEqual(await (await source.browser()).cookies(), []);
});

test("login UI restores a saved connection in a fresh browser and survives a failed status poll", async (t) => {
  const { chromium } = await import("playwright");
  const { startStudy } = await import("../../src/server/server.ts");
  const { AccessError } = await import("../../src/server/mega-source.ts");
  const { sourceMetadata } = await import("../fixtures/synthetic.ts");
  const directory = await mkdtemp(join(tmpdir(), "mega-connection-ui-"));
  let signedIn = false;
  let networkFailure = false;
  const viewer = await startStudy({
    port: 0,
    root: join(directory, "study"),
    stateDirectory: join(directory, "state"),
    labsDirectory: join(directory, "labs"),
    source: {
      login: async () => {
        signedIn = true;
      },
      check: async () => {
        if (networkFailure) throw Error("net::ERR_INTERNET_DISCONNECTED");
        if (!signedIn) throw new AccessError();
        return sourceMetadata;
      },
      availableLessons: async () => [],
      get: async () => {
        throw Error("No remote materials in this test");
      },
      logout: async () => {
        signedIn = false;
      },
      close: async () => {},
    },
  });
  t.after(async () => {
    await viewer.close();
    await rm(directory, { recursive: true, force: true });
  });
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chrome",
  });
  t.after(() => browser.close());
  const first = await browser.newContext();
  const page = await first.newPage();
  await page.goto(viewer.url);
  await page.locator("#import-login").click();
  await page.locator("#import-connected").click();
  await page
    .locator("#import-sync-status")
    .filter({ hasText: "All 0 available lessons are ready." })
    .waitFor();
  await first.close();
  const second = await browser.newContext();
  const restored = await second.newPage();
  await restored.goto(viewer.url);
  await restored
    .locator("#import-button")
    .filter({ hasText: "Your lessons" })
    .waitFor();
  assert.equal(await restored.locator("#lesson-import").isVisible(), false);
  networkFailure = true;
  const failedPoll = await restored.waitForResponse(
    (response) =>
      response.url().endsWith("/auth/status") && response.status() === 400,
    { timeout: 22000 },
  );
  assert.match((await failedPoll.json()).error, /saved login has been kept/);
  assert.equal(await restored.locator("#lesson-import").isVisible(), false);
  networkFailure = false;
  await restored.locator("#import-button").click();
  await restored.locator("#import-disconnect").click();
  await restored.locator("#import-login").waitFor();
  await restored.reload();
  await restored.locator("#import-login").waitFor();
  await second.close();
});
