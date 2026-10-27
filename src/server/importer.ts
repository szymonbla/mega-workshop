import { randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { errorMessage } from "../shared/errors.ts";
import type {
  Curriculum,
  ImportedSection,
  ImportJob,
  SourceMetadata,
  SyncState,
} from "../shared/types.ts";
import { buildMarkedSections } from "./curriculum.ts";
import {
  digest,
  imageLinks,
  renderImported,
  sectionsFromSource,
} from "./import-content.ts";
import { run } from "./import-process.ts";
import { AccessError, lessonAddress } from "./mega-source.ts";
import { audioScriptsRoot, privateDataPath, projectRoot } from "./paths.ts";
import type {
  Command,
  LessonSource,
  SessionRequest,
  SessionResponse,
} from "./types.ts";

const stages = [
  ["source", "Check MEGA access"],
  ["markdown", "Download Markdown"],
  ["images", "Download illustrations"],
  ["audio", "Download recording"],
  ["transcript", "Download transcript"],
  ["chapters", "Prepare chapters"],
  ["alignment", "Synchronize words and audio"],
  ["repository", "Download repository and exercises"],
  ["publish", "Check and add lesson"],
];
export async function writeJSON(file: string, value: unknown) {
  await mkdir(resolve(file, ".."), { recursive: true, mode: 0o700 });
  const temp = file + ".tmp";
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temp, file);
}
async function writeMaterial(file: string, value: string | Buffer) {
  const temporary = file + ".part";
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, file);
}
async function exists(file: string) {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}
const readJSON = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(file, "utf8")) as T;

export class LessonImporter {
  root: string;
  source: LessonSource;
  onPublish: () => void | Promise<void>;
  abort: AbortController;
  command: Command;
  sync: SyncState;
  directory: string;
  jobs: Map<string, ImportJob>;
  running: ImportJob | null;
  session: { hash: string; expires: number; token?: string } | null;
  closing = false;
  task?: Promise<void>;
  syncTask?: Promise<void>;
  constructor({
    root,
    source,
    onPublish = () => {},
    command = run,
    directory = join(root, "..", ".mega-study"),
  }: {
    root: string;
    source: LessonSource;
    onPublish?: () => void | Promise<void>;
    command?: Command;
    directory?: string;
  }) {
    privateDataPath(root);
    privateDataPath(directory);
    this.root = root;
    this.source = source;
    this.onPublish = onPublish;
    this.abort = new AbortController();
    this.command = (name, args, options = {}) =>
      command(name, args, { ...options, signal: this.abort.signal });
    this.sync = { status: "idle", total: 0, done: 0, failed: [], error: null };
    this.directory = directory;
    this.jobs = new Map();
    this.running = null;
    this.session = null;
  }
  async initialize() {
    await mkdir(join(this.directory, "jobs"), { recursive: true, mode: 0o700 });
    try {
      this.session = await readJSON(join(this.directory, "session.json"));
    } catch {}
    for (const name of await readdir(join(this.directory, "jobs"))) {
      if (!/^s0[1-4]e0[1-5]$/.test(name)) continue;
      try {
        const job = await readJSON<ImportJob>(
          join(this.directory, "jobs", name, "job.json"),
        );
        if (job.status === "running") {
          job.status = "interrupted";
          job.error = "The application stopped. Select Resume to continue.";
          job.steps.forEach((step) => {
            if (step.status === "running") step.status = "pending";
          });
        }
        this.jobs.set(job.id, job);
      } catch {}
    }
  }
  validSession(req: SessionRequest) {
    const token = /(?:^|;\s*)mega-study=([a-f0-9]{64})(?:;|$)/.exec(
      req.headers.cookie || "",
    )?.[1];
    return !!(
      token &&
      this.session &&
      this.session.expires > Date.now() &&
      digest(token) === this.session.hash
    );
  }
  async authorize(req: SessionRequest, id = "s01e01") {
    if (!this.validSession(req)) throw new AccessError();
    return this.source.check(id);
  }
  private connecting: Promise<void> | null = null;
  async connect(res: SessionResponse) {
    while (this.connecting) await this.connecting;
    this.connecting = this.saveConnection(res);
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }
  private async saveConnection(res: SessionResponse) {
    await this.source.check("s01e01");
    const token = this.session?.token || randomBytes(32).toString("hex");
    this.session = {
      hash: digest(token),
      token,
      expires: Date.now() + 30 * 24 * 3600 * 1000,
    };
    await writeJSON(join(this.directory, "session.json"), this.session);
    res.setHeader(
      "Set-Cookie",
      `mega-study=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`,
    );
  }
  async logout(res: SessionResponse) {
    if (this.running || this.sync.status === "running")
      throw Error("Wait for the import to finish before disconnecting.");
    this.session = null;
    await rm(join(this.directory, "session.json"), { force: true });
    res.setHeader(
      "Set-Cookie",
      "mega-study=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
    );
    await this.source.logout();
  }
  list() {
    return [...this.jobs.values()].map((job) => structuredClone(job));
  }
  async save(job: ImportJob) {
    job.updatedAt = new Date().toISOString();
    await writeJSON(join(this.directory, "jobs", job.id, "job.json"), job);
  }
  async synchronize(req: SessionRequest) {
    await this.authorize(req);
    if (this.closing) throw Error("The application is stopping.");
    if (this.sync.status === "running") return this.sync;
    this.sync = {
      status: "running",
      total: 0,
      done: 0,
      failed: [],
      error: null,
    };
    this.syncTask = this.syncAvailable(req).catch((error) => {
      this.sync.status = this.closing
        ? "interrupted"
        : error instanceof AccessError
          ? "login_required"
          : "failed";
      this.sync.error = errorMessage(error);
    });
    return this.sync;
  }
  async syncAvailable(req: SessionRequest) {
    if (this.task) await this.task;
    const curriculum = await readJSON<Curriculum>(
      join(this.root, "curriculum.json"),
    );
    const ids = curriculum.weeks.flatMap((week) =>
      week.lessons.map((lesson) => lesson.id),
    );
    const available = await this.source.availableLessons(ids);
    this.sync.total = available.length;
    for (const id of available) {
      if (this.closing) {
        this.sync.status = "interrupted";
        return;
      }
      const ready =
        (await exists(join(this.root, "content", id, "article.md"))) ||
        (id === "s01e01" && (await exists(join(this.root, "article.md"))));
      if (!ready) {
        const job = await this.start(
          `https://hq.mega.dev/lessons/${id}/`,
          req,
          true,
        );
        await this.task;
        if (job.status === "login_required")
          throw new AccessError(job.error || undefined);
        if (job.status !== "completed") this.sync.failed.push(id);
      }
      this.sync.done++;
    }
    this.sync.status = this.closing
      ? "interrupted"
      : this.sync.failed.length
        ? "failed"
        : "completed";
    if (this.sync.failed.length)
      this.sync.error =
        "Some lessons need attention. Check their errors and retry synchronization.";
  }
  async start(
    value: string,
    req: SessionRequest,
    automatic = false,
  ): Promise<ImportJob> {
    if (this.closing) throw Error("The application is stopping.");
    if (!automatic && this.sync.status === "running")
      throw Error("Automatic lesson download is in progress.");
    const { id, url } = lessonAddress(value);
    const curriculum = await readJSON<Curriculum>(
      join(this.root, "curriculum.json"),
    );
    if (
      !curriculum.weeks.some((week) =>
        week.lessons.some((lesson) => lesson.id === id),
      )
    )
      throw Error("This lesson is not in the course.");
    await this.authorize(req, id);
    const previous = this.jobs.get(id);
    if (previous?.status === "completed") return previous;
    if (this.currentJob()?.id === id) return this.currentJob()!;
    if (this.running)
      throw Error("Another lesson is being prepared. Wait for it to finish.");
    if (
      !previous &&
      (await exists(join(this.root, "content", id, "article.md")))
    )
      throw Error(
        "This lesson already has local materials. They have been preserved.",
      );
    if (!automatic && this.sync.status === "running")
      throw Error("Automatic lesson download is in progress.");
    if (this.currentJob()?.id === id) return this.currentJob()!;
    if (this.running) throw Error("Another lesson is being prepared.");
    const job: ImportJob = previous || {
      id,
      url,
      status: "running",
      steps: stages.map(([id, label]) => ({ id, label, status: "pending" })),
    };
    job.status = "running";
    job.error = null;
    this.jobs.set(id, job);
    this.running = job;
    try {
      await this.save(job);
    } catch (error) {
      this.running = null;
      job.status = "failed";
      throw error;
    }
    this.task = this.work(job)
      .catch(async (error) => {
        job.status = this.closing
          ? "interrupted"
          : error instanceof AccessError
            ? "login_required"
            : "failed";
        job.error = errorMessage(error);
        const step = job.steps.find((step) => step.status === "running");
        if (step) step.status = "failed";
        try {
          await this.save(job);
        } catch {
          job.error =
            "Could not save import progress. Check disk space and file permissions.";
        }
      })
      .finally(() => {
        this.running = null;
      });
    return job;
  }
  async close() {
    this.closing = true;
    this.abort.abort();
    await this.source.close?.();
    await this.task;
    await this.syncTask;
  }
  currentJob() {
    return this.running;
  }
  async work(job: ImportJob) {
    const directory = join(this.directory, "jobs", job.id),
      payload = join(directory, "payload");
    if (await exists(join(this.root, "content", job.id, "import.json"))) {
      job.steps.forEach((step) => {
        step.status = "done";
      });
      job.status = "completed";
      await this.onPublish();
      await this.save(job);
      return;
    }
    await mkdir(payload, { recursive: true, mode: 0o700 });
    const metadataFile = join(directory, "source.json");
    // Always recheck access, even when all downloads are cached from a prior run.
    const currentMetadata = await this.source.check(job.id);
    for (const step of job.steps) {
      if (step.status === "done") continue;
      step.status = "running";
      step.detail = "";
      await this.save(job);
      const detail = async (message: string) => {
        step.detail = message;
        await this.save(job);
      };
      if (step.id === "source") await writeJSON(metadataFile, currentMetadata);
      const metadata = await readJSON<SourceMetadata>(metadataFile);
      if (step.id === "markdown") {
        const body = await this.source.get(metadata.markdown, "markdown");
        if (!body.toString().startsWith("# ") || body.length < 200)
          throw Error("MEGA returned an incomplete article.");
        await writeMaterial(join(directory, "source.md"), body);
      }
      if (step.id === "images") {
        let markdown = await readFile(join(directory, "source.md"), "utf8");
        const images = imageLinks(markdown, job.id);
        await mkdir(join(payload, "images"), { recursive: true });
        for (const [index, image] of images.entries()) {
          const file = join(payload, "images", image.file);
          if (!(await exists(file)))
            await writeMaterial(
              file,
              await this.source.get(image.url, "image"),
            );
          markdown = markdown
            .split(image.url)
            .join(`/study/materials/${job.id}/images/${image.file}`);
          await detail(`${index + 1} of ${images.length} illustrations`);
        }
        markdown = markdown.replace(/^\[Open figure\]\([^\n]+\)\s*$/gm, "");
        await writeFile(join(payload, "article-source.md"), markdown, {
          mode: 0o600,
        });
        await writeJSON(join(payload, "images.json"), images);
      }
      if (step.id === "audio") {
        if (!metadata.audio)
          throw Error("The recording is not published yet. Retry later.");
        await writeMaterial(
          join(payload, "recording.mp3"),
          await this.source.get(metadata.audio, "audio"),
        );
      }
      if (step.id === "transcript") {
        if (metadata.transcript)
          await writeMaterial(
            join(payload, "transcript.md"),
            await this.source.get(metadata.transcript, "markdown"),
          );
        else
          await detail(
            "The source has no transcript. It will be generated during audio synchronization.",
          );
      }
      if (step.id === "chapters") {
        const sections = sectionsFromSource(
          await readFile(join(payload, "article-source.md"), "utf8"),
          metadata,
        );
        await mkdir(join(payload, "audio"), { recursive: true });
        for (const [index, section] of sections.entries()) {
          const file = join(payload, "audio", `${section.slug}.mp3`);
          if (!(await exists(file))) {
            await this.command("ffmpeg", [
              "-v",
              "error",
              "-nostdin",
              "-y",
              "-i",
              join(payload, "recording.mp3"),
              "-ss",
              String(section.start),
              "-t",
              String(section.end - section.start),
              "-codec:a",
              "libmp3lame",
              "-q:a",
              "3",
              file + ".tmp.mp3",
            ]);
            await rename(file + ".tmp.mp3", file);
          }
          await detail(`${index + 1} of ${sections.length} chapters`);
        }
        const article = sections.map((section) => section.markdown).join("");
        const parsed = buildMarkedSections(article, job.id);
        const exact = sections.map((section, i) => ({
          ...section,
          markdown: parsed[i].markdown,
          html: renderImported(parsed[i].markdown),
        }));
        await writeJSON(join(payload, "sections.json"), exact);
        await writeFile(join(payload, "article.md"), article, { mode: 0o600 });
      }
      if (step.id === "alignment") {
        const python = join(projectRoot, ".audio-venv", "bin", "python");
        let progress = Promise.resolve();
        await this.command(
          python,
          [join(audioScriptsRoot, "import-alignment.py"), payload],
          {
            onProgress: (text) => {
              const match = /(\d+\/\d+ sections synchronized)/.exec(text);
              if (match) progress = progress.then(() => detail(match[1]));
            },
          },
        );
        await progress;
        if (!metadata.transcript) {
          const sections = await readJSON<ImportedSection[]>(
            join(payload, "sections.json"),
          );
          const paragraphs = [];
          for (const section of sections) {
            const transcript = await readJSON<{ words: { word: string }[] }>(
              join(payload, "transcripts", section.slug + ".json"),
            );
            paragraphs.push(
              `## ${section.title}\n\n` +
                transcript.words.map((word) => word.word).join(" "),
            );
          }
          await writeFile(
            join(payload, "transcript.md"),
            paragraphs.join("\n\n"),
            { mode: 0o600 },
          );
        }
      }
      if (step.id === "repository") {
        const repository = join(directory, "repository");
        if (!(await exists(join(directory, "repository-ready.json")))) {
          await rm(repository, { recursive: true, force: true });
          await this.command("git", [
            "clone",
            "--depth",
            "1",
            "https://github.com/MEGA-DOT-DEV/examples.git",
            repository,
          ]);
          const commit = await this.command(
            "git",
            ["rev-parse", "--verify", "HEAD"],
            { cwd: repository },
          );
          await writeJSON(join(directory, "repository-ready.json"), { commit });
        }
        await detail("Installing exercise dependencies");
        await this.command(
          "npm",
          ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
          { cwd: repository },
        );
        const commit = await this.command("git", ["rev-parse", "HEAD"], {
          cwd: repository,
        });
        await writeJSON(join(payload, "repository.json"), { commit });
      }
      if (step.id === "publish") {
        await this.source.check(job.id);
        const sections = await readJSON<ImportedSection[]>(
          join(payload, "sections.json"),
        );
        for (const section of sections) {
          if (
            !(await exists(join(payload, "audio", `${section.slug}.mp3`))) ||
            !(await exists(join(payload, "alignment", `${section.slug}.json`)))
          )
            throw Error(
              "A chapter is incomplete. No materials were published.",
            );
        }
        await writeJSON(join(payload, "import.json"), {
          id: job.id,
          url: job.url,
          completedAt: new Date().toISOString(),
          chapters: sections.map(({ slug, start, end }) => ({
            slug,
            start,
            end,
          })),
          images: await readJSON(join(payload, "images.json")),
        });
        const destination = join(this.root, "content", job.id);
        await mkdir(join(this.root, "content"), { recursive: true });
        if (!(await exists(join(destination, "import.json"))))
          await rename(payload, destination);
        await this.onPublish();
      }
      step.status = "done";
      await this.save(job);
    }
    job.status = "completed";
    await this.save(job);
  }
}
