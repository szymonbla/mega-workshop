import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import test from "node:test";
import { createStudyHandler } from "../src/server/http.ts";
import {
  renderImported,
  sectionsFromSource,
} from "../src/server/import-content.ts";
import { LessonImporter } from "../src/server/importer.ts";
import {
  AccessError,
  lessonAddress,
  parseLessonPage,
} from "../src/server/mega-source.ts";
import type { Command, LessonSource } from "../src/server/types.ts";

const markdown =
  "# Sample lesson\n\n" +
  "Introduction. ".repeat(25) +
  "\n\n## Context\n\nContext matters.\n";
const metadata = {
  markdown: "https://hq.mega.dev/lessons/s01e02/lesson.md",
  audio: "https://hq.mega.dev/lessons/s01e02/audio/test.mp3",
  transcript: "https://hq.mega.dev/lessons/s01e02/transcript.md",
  duration: 20,
  chapters: [
    { slug: "introduction", start: 0, title: "Introduction" },
    { slug: "context", start: 10, title: "Context" },
  ],
};
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "mega-import-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "study");
  await mkdir(root);
  await writeFile(
    join(root, "curriculum.json"),
    JSON.stringify({ weeks: [{ lessons: [{ id: "s01e02" }] }] }),
  );
  let allowed = true,
    failTranscript = true,
    published = 0;
  const downloads: string[] = [];
  const source: LessonSource = {
    availableLessons: async () => [],
    login: async () => {},
    close: async () => {},
    check: async () => {
      if (!allowed) throw new AccessError();
      return metadata;
    },
    get: async (url) => {
      downloads.push(url);
      if (url.endsWith("transcript.md") && failTranscript)
        throw Error("Download interrupted");
      return Buffer.from(
        url.endsWith("lesson.md")
          ? markdown
          : url.endsWith("transcript.md")
            ? "Transcript"
            : "audio",
      );
    },
    logout: async () => {
      allowed = false;
    },
  };
  const command: Command = async (name, args) => {
    if (name === "ffmpeg") {
      await writeFile(args.at(-1)!, "clip");
      return "";
    }
    if (name.endsWith("/python")) {
      const payload = args[1];
      await mkdir(join(payload, "alignment"), { recursive: true });
      for (const section of JSON.parse(
        await readFile(join(payload, "sections.json"), "utf8"),
      ))
        await writeFile(
          join(payload, "alignment", section.slug + ".json"),
          "{}",
        );
    }
    if (name === "git" && args[0] === "clone") {
      await mkdir(join(args.at(-1)!, ".git"), { recursive: true });
      await writeFile(join(args.at(-1)!, ".git", "HEAD"), "commit");
    }
    return name === "git" ? "test-commit" : "";
  };
  const importer = new LessonImporter({
    root,
    source,
    command,
    onPublish: () => {
      published++;
    },
  });
  await importer.initialize();
  let cookie = "";
  await importer.connect({
    setHeader: (_, value) => {
      cookie = value.split(";")[0];
    },
  });
  return {
    root,
    directory,
    source,
    command,
    importer,
    req: { headers: { cookie } },
    downloads,
    allow: (value: boolean) => {
      allowed = value;
    },
    fail: (value: boolean) => {
      failTranscript = value;
    },
    published: () => published,
  };
}
async function idle(importer: LessonImporter) {
  for (let i = 0; i < 200 && importer.running; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(importer.running, null);
}

test("only canonical MEGA lesson URLs are accepted", () => {
  assert.equal(
    lessonAddress("https://hq.mega.dev/lessons/s01e02/?x=1#context").id,
    "s01e02",
  );
  for (const value of [
    "http://hq.mega.dev/lessons/s01e02",
    "https://hq.mega.dev.evil.test/lessons/s01e02",
    "https://user@hq.mega.dev/lessons/s01e02",
    "https://hq.mega.dev/lessons/s01e99",
    "https://127.0.0.1/lessons/s01e02",
  ])
    assert.throws(() => lessonAddress(value));
});
test("MEGA login and inaccessible lesson pages cannot masquerade as content", () => {
  assert.throws(
    () =>
      parseLessonPage(
        "<form>Log in</form>",
        "https://hq.mega.dev/lessons/s01e02/",
      ),
    AccessError,
  );
  assert.throws(
    () =>
      parseLessonPage(
        '<a href="/logout">Out</a>Coming tomorrow',
        "https://hq.mega.dev/lessons/s01e02/",
      ),
    AccessError,
  );
  const page =
    '<a href="/logout">Out</a><a href="/lessons/s01e02/lesson.md">Markdown</a><audio src="/lessons/s01e02/audio/a.mp3"></audio><input class="lesson-audio-seek" max="20"><div class="lesson-audio-chapters"><button data-start="0"><span>0:00</span><span>Introduction</span></button></div>';
  assert.equal(
    parseLessonPage(page, "https://hq.mega.dev/lessons/s01e02/").audio,
    "https://hq.mega.dev/lessons/s01e02/audio/a.mp3",
  );
});
test("source chapter boundaries preserve text and reject mismatches; HTML is sanitized", () => {
  const sections = sectionsFromSource(markdown, metadata);
  assert.equal(sections.length, 2);
  assert.equal(sections[1].start, 10);
  assert.equal(
    sections.map((s) => s.markdown.replace(/^<!--.*?-->\n/, "")).join(""),
    markdown,
  );
  assert.throws(() =>
    sectionsFromSource(markdown, {
      ...metadata,
      chapters: [metadata.chapters[0], { slug: "missing", start: 10 }],
    }),
  );
  const rendered = renderImported(
    '<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">x</a>',
  );
  assert.doesNotMatch(rendered, /script|onerror|javascript/);
});
test("failed downloads resume after restart, publish atomically and deduplicate", async (t) => {
  const f = await fixture(t);
  await f.importer.start("https://hq.mega.dev/lessons/s01e02/", f.req);
  await idle(f.importer);
  assert.equal(f.importer.list()[0].status, "failed");
  assert.equal(f.published(), 0);
  await assert.rejects(stat(join(f.root, "content", "s01e02", "article.md")));
  const count = f.downloads.length;
  f.fail(false);
  const restarted = new LessonImporter({
    root: f.root,
    source: f.source,
    command: f.command,
    onPublish: () => {},
  });
  await restarted.initialize();
  await restarted.start("https://hq.mega.dev/lessons/s01e02/", f.req);
  await idle(restarted);
  assert.equal(restarted.list()[0].status, "completed");
  assert.deepEqual(f.downloads.slice(count), [metadata.transcript]);
  assert.ok(
    (
      await readFile(join(f.root, "content", "s01e02", "article.md"), "utf8")
    ).includes("Context matters"),
  );
  const after = f.downloads.length;
  await restarted.start("https://hq.mega.dev/lessons/s01e02/", f.req);
  assert.equal(f.downloads.length, after);
  f.allow(false);
  await assert.rejects(
    restarted.start("https://hq.mega.dev/lessons/s01e02/", f.req),
    AccessError,
  );
});
test("content, image, audio ranges and labs require both local session and current MEGA access", async (t) => {
  const f = await fixture(t);
  const publicRoot = join(f.root, "public");
  await mkdir(publicRoot);
  await writeFile(join(publicRoot, "index.html"), "Shell");
  await writeFile(join(publicRoot, "image.png"), "image");
  await writeFile(join(publicRoot, "clip.mp3"), "recording");
  const catalog = {
    weeks: [],
    legacySections: [],
    audioBySlug: new Map(),
    files: { "/": "index.html", "/study/figures/figure-1.png": "image.png" },
    assets: new Map([
      [
        "/study/materials/s01e02/audio/context.mp3",
        {
          file: join(publicRoot, "clip.mp3"),
          type: "audio/mpeg",
          id: "s01e02",
        },
      ],
    ]),
  };
  const handler = createStudyHandler({
    catalog,
    publicRoot,
    importer: f.importer,
  });
  const server = createServer(async (req, res) => {
    if (
      !(await handler(req, res, {
        port: (server.address() as AddressInfo).port,
      }))
    ) {
      res.writeHead(200);
      res.end("lab");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const path of [
    "/study-api/curriculum",
    "/study/figures/figure-1.png",
    "/study/materials/s01e02/audio/context.mp3",
    "/api/items",
    "/ui/test/",
  ])
    assert.equal((await fetch(base + path)).status, 401, path);
  assert.equal((await fetch(base)).status, 200);
  const audio = await fetch(
    base + "/study/materials/s01e02/audio/context.mp3",
    { headers: { ...f.req.headers, Range: "bytes=0-2" } },
  );
  assert.equal(audio.status, 206);
  assert.equal(await audio.text(), "rec");
  assert.equal(audio.headers.get("cache-control"), "no-store");
  const forged = await fetch(base + "/study-api/auth/complete", {
    method: "POST",
    headers: {
      Origin: "https://evil.example",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(forged.status, 403);
  f.allow(false);
  assert.equal(
    (
      await fetch(base + "/study/figures/figure-1.png", {
        headers: f.req.headers,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + "/study/materials/s01e02/audio/context.mp3", {
        method: "HEAD",
        headers: f.req.headers,
      })
    ).status,
    401,
  );
});

test("automatic sync imports all available lessons, deduplicates concurrent requests and skips ready materials", async (t) => {
  const f = await fixture(t);
  f.fail(false);
  await writeFile(
    join(f.root, "curriculum.json"),
    JSON.stringify({
      weeks: [{ lessons: [{ id: "s01e01" }, { id: "s01e02" }] }],
    }),
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let scans = 0;
  f.source.availableLessons = async (ids) => {
    scans++;
    assert.deepEqual(ids, ["s01e01", "s01e02"]);
    await gate;
    return ids;
  };
  await assert.rejects(f.importer.synchronize({ headers: {} }), AccessError);
  await Promise.all([
    f.importer.synchronize(f.req),
    f.importer.synchronize(f.req),
  ]);
  await assert.rejects(
    f.importer.start("https://hq.mega.dev/lessons/s01e02/", f.req),
    /Automatic/,
  );
  release();
  await f.importer.syncTask;
  assert.equal(scans, 1);
  assert.equal(f.importer.sync.status, "completed");
  assert.equal(f.importer.sync.done, 2);
  assert.deepEqual(
    f.importer.list().map((job) => job.status),
    ["completed", "completed"],
  );
  for (const id of ["s01e01", "s01e02"])
    assert.ok(
      (await stat(join(f.root, "content", id, "import.json"))).size > 0,
    );
  const count = f.downloads.length;
  await f.importer.synchronize(f.req);
  await f.importer.syncTask;
  assert.equal(f.downloads.length, count);
  assert.equal(f.importer.sync.total, 2);
});

test("automatic sync continues after failure and resumes unfinished stages on the next connection", async (t) => {
  const f = await fixture(t);
  f.fail(false);
  await writeFile(
    join(f.root, "curriculum.json"),
    JSON.stringify({
      weeks: [{ lessons: [{ id: "s01e01" }, { id: "s01e02" }] }],
    }),
  );
  f.source.availableLessons = async () => ["s01e01", "s01e02"];
  const get = f.source.get;
  let fail = true;
  f.source.get = async (url, kind) => {
    if (
      fail &&
      kind === "markdown" &&
      url.endsWith("transcript.md") &&
      f.importer.running?.id === "s01e01"
    )
      throw Error("Temporary download failure");
    return get(url, kind);
  };
  await f.importer.synchronize(f.req);
  await f.importer.syncTask;
  assert.equal(f.importer.sync.status, "failed");
  assert.deepEqual(f.importer.sync.failed, ["s01e01"]);
  assert.equal(
    f.importer.list().find((job) => job.id === "s01e02")!.status,
    "completed",
  );
  fail = false;
  const before = f.downloads.length;
  const restarted = new LessonImporter({
    root: f.root,
    source: f.source,
    command: f.command,
  });
  await restarted.initialize();
  await restarted.synchronize(f.req);
  await restarted.syncTask;
  assert.equal(restarted.sync.status, "completed");
  assert.deepEqual(f.downloads.slice(before), [metadata.transcript]);
});

test("automatic sync preserves legacy local material and stops on expired access", async (t) => {
  const f = await fixture(t);
  f.fail(false);
  await writeFile(
    join(f.root, "curriculum.json"),
    JSON.stringify({
      weeks: [{ lessons: [{ id: "s01e01" }, { id: "s01e02" }] }],
    }),
  );
  await writeFile(join(f.root, "article.md"), "Synthetic existing material.");
  f.source.availableLessons = async () => ["s01e01", "s01e02"];
  const check = f.source.check;
  f.source.check = async (id) => {
    if (id === "s01e02") throw new AccessError("Session expired");
    return check(id);
  };
  await f.importer.synchronize(f.req);
  await f.importer.syncTask;
  assert.equal(f.importer.sync.status, "login_required");
  assert.equal(f.downloads.length, 0);
  assert.equal(
    await readFile(join(f.root, "article.md"), "utf8"),
    "Synthetic existing material.",
  );
});
