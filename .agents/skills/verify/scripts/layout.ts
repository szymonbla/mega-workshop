import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";

// Exercise real controls; geometry is read-only and never sets application state.
export async function verifyLayout(
  page: Page,
  evidence: string,
  record: (action: string) => unknown,
  capture: (name: string) => Promise<void>,
) {
  const measurements: object[] = [];
  const box = (selector: string) =>
    page.locator(selector).evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y + window.scrollY,
        width: rect.width,
        height: rect.height,
      };
    });
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 844 });
    record(
      `Check tabs, audio, search, review, theme and settings at ${width}px`,
    );
    const tabs = await box(".workspace-tabs");
    for (const expanded of [false, true]) {
      if (
        (await page
          .locator("#audio-collapse")
          .getAttribute("aria-expanded")) !== String(expanded)
      )
        await page.locator("#audio-collapse").click();
      for (const panel of ["practice", "read", "practice", "read"]) {
        await page.locator(`#tab-${panel}`).click();
        const current = await box(".workspace-tabs");
        measurements.push({ width, expanded, panel, tabs: current });
        assert.deepEqual(
          current,
          tabs,
          "Workspace tabs must stay in place across audio and panel changes",
        );
      }
      await capture(`layout-${width}-${expanded ? "expanded" : "compact"}`);
    }
    const headingPositions = [];
    const headingTop = (await box(".lesson-heading")).y;
    for (const query of ["Tokenization", "no-such-topic-987", ""]) {
      await page.locator("#search").fill(query);
      headingPositions.push((await box(".lesson-heading")).y);
      assert.equal(
        (await box(".lesson-heading")).y,
        headingTop,
        "Search must not move the reader",
      );
    }
    record(`Search geometry at ${width}px: ${headingPositions.join(", ")}`);
    for (const action of [
      "#review",
      "#review",
      "#theme-toggle",
      "#theme-toggle",
    ]) {
      await page.locator(action).click();
      assert.equal(
        (await box(".lesson-heading")).y,
        headingTop,
        "Review and theme must not move the reader",
      );
    }
    await page.locator("#settings").click();
    await page.locator("#provider").selectOption("openrouter");
    await capture(`settings-${width}`);
    await page.locator("#close-config").click();
    if (
      (await page.locator("#audio-collapse").getAttribute("aria-expanded")) ===
      "true"
    )
      await page.locator("#audio-collapse").click();

    for (const lesson of ["s01e01", "s01e02"]) {
      await page.locator("#back-course").click();
      await page.locator(`[data-course="${lesson}"]`).click();
      const count = await page.locator("#chapters button").count();
      for (let index = 0; index < count; index++) {
        await page.locator("#chapters button").nth(index).click();
        const title = await page.locator("#title").textContent();
        record(`${width}px: ${lesson} / ${title}`);
        if (await page.locator("#tab-practice").isVisible()) {
          const before = await box(".workspace-tabs");
          await page.locator("#tab-practice").click();
          assert.deepEqual(await box(".workspace-tabs"), before);
          await page.locator("#tab-read").click();
          assert.deepEqual(await box(".workspace-tabs"), before);
        }
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        if (overflow > 1) {
          record(`Horizontal overflow: ${overflow}px`);
          await capture(`overflow-${width}-${lesson}-${index}`);
          assert.fail(
            `Horizontal overflow at ${width}px: ${lesson} / ${title}`,
          );
        }
      }
    }
    await page.locator("#back-course").click();
    await page.locator('[data-course="s01e01"]').click();
    await page
      .locator("#chapters button")
      .filter({ hasText: "Tokenization" })
      .click();
  }
  // Reproduce panel switching after the reader has scrolled the page on mobile.
  await page.locator("#tab-practice").click();
  const tabPosition = await page.locator(".workspace-tabs").boundingBox();
  assert.ok(tabPosition);
  await page.mouse.move(380, 400);
  await page.mouse.wheel(0, tabPosition.y);
  await page.waitForFunction(() => window.scrollY > 0);
  await capture("mobile-scrolled-practice");
  const beforeSwitch = await page.locator(".workspace-tabs").boundingBox();
  await page.locator("#tab-read").click();
  const afterSwitch = await page.locator(".workspace-tabs").boundingBox();
  record(`Scrolled mobile tabs: ${beforeSwitch?.y} → ${afterSwitch?.y}`);
  await capture("mobile-scrolled-read");
  assert.ok(beforeSwitch && afterSwitch);
  assert.ok(
    Math.abs(beforeSwitch.y - afterSwitch.y) < 1,
    "Switching to a shorter article must not move the tabs on screen",
  );
  await writeFile(
    join(evidence, "geometry.json"),
    JSON.stringify(measurements, null, 2),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
}
