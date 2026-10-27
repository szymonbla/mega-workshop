import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadStudyCatalog } from "../src/server/catalog.ts";
import { createStudyHandler } from "../src/server/http.ts";
import {
  lessonFixture,
  sectionFixture,
  writeFixture,
} from "./fixtures/synthetic.ts";

const root = fileURLToPath(new URL("../dist/", import.meta.url));

async function serve(
  t: TestContext,
  saveSettings: (name: string, value: string) => void,
) {
  const section = sectionFixture();
  const catalog = {
    weeks: [
      {
        title: "Week 1",
        number: 1,
        lessons: [lessonFixture({ id: "course", sections: [section] })],
      },
    ],
    legacySections: [section],
    audioBySlug: new Map(),
    files: { "/": "index.html" },
  };
  const handler = createStudyHandler({
    catalog,
    publicRoot: join(root, "public"),
    saveSettings,
  });
  const server = createServer(async (req, res) => {
    if (
      !(await handler(req, res, {
        port: (server.address() as AddressInfo).port,
      }))
    ) {
      res.writeHead(202, { "Content-Type": "text/plain" });
      res.end("viewer fallback");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: string, headers: Record<string, string> = {}) =>
    fetch(url + "/study-api/settings", {
      method: "POST",
      headers: { Origin: url, "Content-Type": "application/json", ...headers },
      body,
    });
  return { url, post, catalog };
}

test("Study routes retain their responses and leave foreign routes to the viewer", async (t) => {
  const { url, catalog } = await serve(t, () => {});
  const curriculum = await fetch(url + "/study-api/curriculum");
  assert.equal(curriculum.status, 200);
  assert.equal(curriculum.headers.get("cache-control"), "no-store");
  assert.equal(curriculum.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await curriculum.json(), { weeks: catalog.weeks });
  assert.deepEqual(
    await (await fetch(url + "/study-api/lessons")).json(),
    catalog.legacySections,
  );
  const fallback = await fetch(url + "/api/items");
  assert.equal(fallback.status, 202);
  assert.equal(await fallback.text(), "viewer fallback");
  const invalidHost = await new Promise<{
    status: number | undefined;
    body: unknown;
  }>((resolve, reject) => {
    const req = request(
      url + "/api/items",
      { headers: { Host: "foreign.example" } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: JSON.parse(body) }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(invalidHost.status, 403);
  assert.deepEqual(invalidHost.body, { error: "Invalid host." });
  assert.equal(
    (await fetch(url + "/study-api/lessons", { method: "POST" })).status,
    404,
  );
  assert.equal((await fetch(url + "/study/missing")).status, 404);
  assert.equal((await fetch(url + "/", { method: "POST" })).status, 405);
  const page = await fetch(url);
  assert.equal(
    await page.text(),
    readFileSync(join(root, "public/index.html"), "utf8"),
  );
  assert.ok(
    page.headers.get("content-security-policy")?.includes("frame-src 'self'"),
  );
});

test("settings validation and write failures keep their HTTP contract", async (t) => {
  const writes: { name: string; value: string }[] = [];
  let fail = false;
  const { post } = await serve(t, (name, value) => {
    if (fail) throw Error("private filesystem details");
    writes.push({ name, value });
  });
  const body = JSON.stringify({
    provider: "openai",
    key: "synthetic-test-key",
  });
  assert.equal(
    (await post(body, { Origin: "https://foreign.example" })).status,
    403,
  );
  assert.equal(
    (await post(body, { "Content-Type": "text/plain" })).status,
    403,
  );
  assert.equal(
    (
      await post(
        JSON.stringify({ provider: "unknown", key: "synthetic-test-key" }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await post(JSON.stringify({ provider: "openai", key: "short" }))).status,
    400,
  );
  assert.equal((await post(" ".repeat(8193))).status, 413);
  assert.equal((await post("{")).status, 500);
  assert.deepEqual(writes, []);
  const success = await post(body);
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), { ok: true });
  assert.deepEqual(writes, [
    { name: "OPENAI_API_KEY", value: "synthetic-test-key" },
  ]);
  fail = true;
  const failed = await post(body);
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), {
    error: "Could not save or read data. Check file permissions.",
  });
});

test("S01E01 keeps audio and the legacy endpoint data when moved within the curriculum", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mega-catalog-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFixture(dir);
  const manifest = JSON.parse(
    readFileSync(join(dir, "curriculum.json"), "utf8"),
  );
  [manifest.weeks[0].lessons[0], manifest.weeks[0].lessons[1]] = [
    manifest.weeks[0].lessons[1],
    manifest.weeks[0].lessons[0],
  ];
  writeFileSync(join(dir, "curriculum.json"), JSON.stringify(manifest));
  const catalog = loadStudyCatalog(dir);
  const lesson = catalog.weeks[0].lessons[1];
  assert.equal(lesson.id, "s01e01");
  assert.equal(catalog.legacySections, lesson.sections);
  assert.ok(lesson.sections.every((section) => section.audio === null));
  assert.deepEqual(catalog.weeks[0].lessons[0].sections, []);
});

test("importing the server neither listens nor registers shutdown handlers", () => {
  const script = `const before = ['SIGINT','SIGTERM'].map(s => process.listenerCount(s));
    const {startStudy} = await import('./src/server/server.ts');
    if (typeof startStudy !== 'function') throw Error('Missing startStudy');
    if (JSON.stringify(before) !== JSON.stringify(['SIGINT','SIGTERM'].map(s => process.listenerCount(s)))) throw Error('Import registered signals');`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});
