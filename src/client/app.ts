import { errorMessage } from "../shared/errors.ts";
import type {
  Lesson,
  Progress,
  ProviderStatus,
  Section,
  Week,
} from "../shared/types.ts";
import { createAudioPlayer } from "./audio-player.ts";
import { query } from "./dom.ts";
import { createImportUI } from "./import-ui.ts";
import { createLabs } from "./labs.ts";
import type { Selection } from "./navigation.ts";
import { resolveRoute, selectSection } from "./navigation.ts";
import { completion, createProgressStore } from "./progress.ts";

const $ = query;
let storage: Storage | undefined;
try {
  storage = localStorage;
} catch {}
const progress = createProgressStore(storage);
const player = createAudioPlayer({ root: document, storage });
const labs = createLabs({
  host: $("#lab-host"),
  tabs: $("#lab-tabs"),
  source: $("#source"),
  guide: $("#practice-guide"),
  getTheme: () => document.documentElement.dataset.theme || "dark",
});
let weeks: Week[] = [],
  courseLessons: Lesson[] = [],
  selection: Selection = { kind: "overview" },
  reviewOnly = false;
let state: Pick<Progress, "done" | "again"> = { done: [], again: [] };
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      (
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }) as Record<string, string>
      )[character],
  );

function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
  try {
    storage?.setItem("mega-theme", theme);
  } catch {}
  const label =
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  $("#theme-toggle").setAttribute("aria-label", label);
  $("#theme-toggle").title = label;
  labs.setTheme(theme);
}
let theme = "dark";
try {
  if (storage?.getItem("mega-theme") === "light") theme = "light";
} catch {}
applyTheme(theme);
$("#theme-toggle").onclick = () =>
  applyTheme(
    document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  );
addEventListener("storage", (event) => {
  if (
    event.key === "mega-theme" &&
    ["light", "dark"].includes(event.newValue || "")
  ) {
    if (document.documentElement.dataset.theme !== event.newValue)
      applyTheme(event.newValue!);
  }
  if (
    selection.kind === "overview" &&
    courseLessons.length &&
    progress.affects(event.key)
  )
    overview();
  else if (
    selection.kind === "reader" &&
    progress.affects(event.key, selection.lesson.id)
  ) {
    state = progress.read(selection.lesson);
    nav();
  }
});

function nav() {
  if (selection.kind !== "reader") return;
  const lessons = selection.lesson.sections;
  const current = lessons.indexOf(selection.section);
  const query = $("#search").value.toLocaleLowerCase("en");
  let group = "";
  $("#chapters").replaceChildren();
  lessons.forEach((l, i) => {
    if (
      query &&
      !`${l.title} ${l.group} ${l.labs.join(" ")}`
        .toLocaleLowerCase("en")
        .includes(query)
    )
      return;
    if (reviewOnly && (l.kind !== "topic" || !state.again.includes(l.id)))
      return;
    if (group !== l.group) {
      group = l.group;
      const heading = document.createElement("div");
      heading.className = "nav-group";
      heading.textContent = group;
      $("#chapters").append(heading);
    }
    const topic = l.kind === "topic";
    const complete = topic && state.done.includes(l.id),
      flagged = topic && state.again.includes(l.id);
    const b = document.createElement("button");
    b.className = `chapter ${i === current ? "active" : ""} ${complete ? "complete" : ""} ${flagged ? "flagged" : ""} ${topic ? "" : "reference"}`;
    b.setAttribute("aria-current", i === current ? "page" : "false");
    b.innerHTML = `<span class="num">${complete ? "✓" : flagged ? "↺" : topic ? String(l.number).padStart(2, "0") : "–"}</span><span>${escape(l.title)}${topic ? "" : `<small>${l.kind === "chapter" ? "Chapter overview" : l.kind === "summary" ? "Summary" : "Introduction"}</small>`}</span>`;
    b.onclick = () => go(i);
    $("#chapters").append(b);
  });
  if (!$("#chapters").children.length)
    $("#chapters").textContent = reviewOnly
      ? "No topics to review."
      : "No results.";
  const { done: count, total, again } = completion(lessons, state);
  $("#bar").style.width = `${total ? (count / total) * 100 : 0}%`;
  $("#progress-label").textContent = `${count} of ${total} topics completed`;
  $("#review").textContent = reviewOnly
    ? "← All topics"
    : `↺ Review (${again})`;
}
function hasPractice(section: Section) {
  return section.kind === "topic" && section.labs.length > 0;
}
function showPanel(name: string) {
  if (
    name === "practice" &&
    (selection.kind !== "reader" || !hasPractice(selection.section))
  )
    name = "read";
  for (const panel of ["read", "practice"]) {
    const selected = panel === name;
    $(`#panel-${panel}`).hidden = !selected;
    $(`#tab-${panel}`).setAttribute("aria-selected", String(selected));
    $(`#tab-${panel}`).tabIndex = selected ? 0 : -1;
  }
  player.refresh();
}
for (const id of ["#practice-read", "#practice-return"])
  $(id).onclick = () => {
    showPanel("read");
    $("#tab-read").focus();
  };
for (const name of ["read", "practice"])
  $("#tab-" + name).onclick = () => showPanel(name);
$(".workspace-tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const tabs = [
    ...$(".workspace-tabs").querySelectorAll<HTMLElement>("[role=tab]"),
  ].filter((t) => !t.hidden);
  let index = tabs.indexOf(document.activeElement as HTMLElement);
  index =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
          tabs.length;
  tabs[index].click();
  tabs[index].focus();
});
function go(index: number) {
  if (selection.kind !== "reader") return;
  const sections = selection.lesson.sections;
  const section = sections[Math.max(0, Math.min(index, sections.length - 1))];
  renderSection(selectSection(selection.lesson, section.id));
}

function renderSection(next: Exclude<Selection, { kind: "overview" }>) {
  if (next.kind !== "reader") return;
  selection = next;
  const { lesson, section } = next;
  $("#lesson-transcript").hidden = !lesson.transcriptUrl;
  if (lesson.transcriptUrl) $("#lesson-transcript").href = lesson.transcriptUrl;
  $("#saved").textContent = progress.visit(lesson, section)
    ? ""
    : "Could not save progress in this browser.";
  history.replaceState(null, "", `#/lesson/${lesson.id}/${section.slug}`);
  $("#title").textContent = section.title;
  $("#group").textContent = section.group;
  const topic = section.kind === "topic";
  $("#step-count").textContent = topic
    ? `Topic ${section.number} / ${completion(lesson.sections, state).total}`
    : section.kind === "chapter"
      ? "Chapter overview"
      : section.kind === "summary"
        ? "Summary"
        : "Introduction";
  $("#article").innerHTML = section.html || "";
  player.select(section);
  $("#article")
    .querySelectorAll("a")
    .forEach((link) => {
      const match =
        /github\.com\/MEGA-DOT-DEV\/examples\/tree\/main\/(?:examples|tools)\/([a-z0-9-]+)/.exec(
          link.href,
        );
      if (match && hasPractice(section)) {
        link.addEventListener("click", (event) => {
          event.preventDefault();
          labs.select(section, match[1]);
          showPanel("practice");
          $(".practice").scrollTop = 0;
        });
        link.title = "Open example with instructions";
      } else {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    });
  $("#article")
    .querySelectorAll("img")
    .forEach((image) => {
      image.loading = "lazy";
      image.alt = "Illustration from the MEGA.dev article";
    });

  $("#tab-practice").hidden = !hasPractice(section);
  $(".workspace-tabs").hidden = !hasPractice(section);
  labs.select(section);
  showPanel("read");
  nav();
  $(".reader").scrollTop = 0;
  $(".practice").scrollTop = 0;
}

async function status() {
  const response = await fetch("/api/status");
  if (!response.ok) throw Error("Could not load settings.");
  const data: ProviderStatus = await response.json();
  const configured = data.providers.filter((provider) => provider.set);
  $("#key-status").textContent = configured.length
    ? `${configured.map((provider) => provider.name).join(" + ")} · ready`
    : "Add an API key";
}
$("#search").oninput = nav;
$("#review").onclick = () => {
  reviewOnly = !reviewOnly;
  nav();
};
$("#settings").onclick = () => $("#config").showModal();
$("#close-config").onclick = () => $("#config").close();
$("#config").addEventListener("close", () => {
  $("#api-key").value = "";
});
$("#key-form").onsubmit = async (event) => {
  event.preventDefault();
  const button = $("#key-form button[type=submit]");
  button.disabled = true;
  $("#config-status").dataset.error = "false";
  $("#config-status").textContent = "Saving…";
  try {
    const response = await fetch("/study-api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: $("#provider").value,
        key: $("#api-key").value.trim(),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    $("#api-key").value = "";
    await status();
    $("#config-status").textContent =
      "Saved. All labs can access your key. The first request will verify it.";
    labs.reset();
  } catch (error) {
    $("#config-status").dataset.error = "true";
    $("#config-status").textContent = errorMessage(error);
  } finally {
    button.disabled = false;
  }
};

const counts = (lesson: Lesson) => progress.counts(lesson);
const resumeLesson = () => progress.resumeLesson(courseLessons);
function setView(view: Selection["kind"]) {
  player.pause();
  $("#course-overview").hidden = view !== "overview";
  $("#pending-lesson").hidden = view !== "pending";
  $(".layout").hidden = view !== "reader";
}
function overview(focus = false) {
  selection = { kind: "overview" };
  setView("overview");
  document.title = "Course overview · MEGA Workshop";
  const completed = courseLessons.filter((l) => counts(l).complete).length;
  $("#course-count").textContent = `${completed} / ${courseLessons.length}`;
  $("#course-progress").value = completed;
  const available = courseLessons.filter((l) => l.available).length;
  $("#availability").textContent =
    `${available} of ${courseLessons.length} lessons available`;
  const resume = resumeLesson();
  $("#resume-card").innerHTML = resume
    ? `<div><span class="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>${escape(resume.title)}</h2><p>Week ${resume.week} · Lesson ${resume.number} · ${counts(resume).done} of ${counts(resume).total} topics completed</p></div><button class="primary" id="resume">Continue learning →</button>`
    : "<p>Your learning path is ready. Lesson materials have not been added yet.</p>";
  if (resume) $("#resume").onclick = () => openCourse(resume.id);
  $("#week-grid").innerHTML = weeks
    .map((w) => {
      const done = w.lessons.filter((l) => counts(l).complete).length;
      return `<section class="week-card" aria-label="${escape(w.title)}"><div class="week-heading"><div><span class="eyebrow">WEEK ${String(w.number).padStart(2, "0")}</span><h2>${escape(w.title)}</h2></div><span>${done} / ${w.lessons.length}</span></div><progress max="5" value="${done}" aria-label="${escape(w.title)} completion"></progress><div class="course-lessons">${w.lessons
        .map((l) => {
          const c = counts(l),
            label = !l.available
              ? "Materials pending"
              : c.complete
                ? "Completed"
                : c.done
                  ? `${c.done} / ${c.total} topics`
                  : "Ready to start";
          return `<button class="course-lesson ${l.available ? "available" : "pending"}" data-course="${l.id}"><span class="lesson-number">${c.complete ? "✓" : String(l.number).padStart(2, "0")}</span><span class="lesson-summary"><strong>${escape(l.title)}</strong><small>${escape(l.id.toUpperCase())} · ${label}</small></span><span aria-hidden="true">${l.available ? "↗" : "–"}</span></button>`;
        })
        .join("")}</div></section>`;
    })
    .join("");
  $("#week-grid")
    .querySelectorAll<HTMLElement>("[data-course]")
    .forEach((b) => (b.onclick = () => openCourse(b.dataset.course!)));
  if (focus) $("#overview-title").focus();
}
function openCourse(id: string, slug?: string, push = true) {
  const next = resolveRoute(
    `#/lesson/${id}${slug ? "/" + slug : ""}`,
    courseLessons,
    progress.read,
  );
  if (next.kind === "overview") {
    showOverview(push);
    return;
  }
  if (push)
    history.pushState(null, "", `#/lesson/${id}${slug ? "/" + slug : ""}`);
  selection = next;
  const lesson = next.lesson;
  document.title = `${lesson.title} · MEGA Workshop`;
  if (next.kind === "pending") {
    setView("pending");
    $("#pending-code").textContent =
      `Week ${lesson.week} / Lesson ${lesson.number} · ${lesson.id.toUpperCase()}`;
    $("#pending-title").textContent = lesson.title;
    $("#pending-title").focus();
    $("#pending-release").textContent = lesson.releaseDate
      ? `Course release: ${lesson.releaseDate} · 05:00 CET. Materials have not been imported into this local reader.`
      : "";
    $("#pending-source").hidden = !lesson.sourceUrl;
    if (lesson.sourceUrl) $("#pending-source").href = lesson.sourceUrl;
    $("#pending-continue").hidden = !resumeLesson();
    return;
  }
  state = progress.read(lesson);
  reviewOnly = false;
  $("#search").value = "";
  $("#lesson-context").textContent =
    `Week ${lesson.week} · Lesson ${lesson.number} / 20`;
  setView("reader");
  renderSection(next);
  $("#title").tabIndex = -1;
  $("#title").focus();
}
function showOverview(push = true) {
  if (push) history.pushState(null, "", "#/course");
  overview(true);
}
function route() {
  const next = resolveRoute(location.hash, courseLessons, progress.read);
  if (next.kind === "overview") overview();
  else
    openCourse(
      next.lesson.id,
      next.kind === "reader" ? next.section.id : undefined,
      false,
    );
}
$("#course-home").onclick = () => showOverview();
$("#back-course").onclick = () => showOverview();
$("#pending-back").onclick = () => showOverview();
$("#pending-continue").onclick = () => {
  const next = resumeLesson();
  if (next) openCourse(next.id);
};
addEventListener("popstate", () => {
  if (courseLessons.length) route();
});
async function loadCourse() {
  try {
    const responses = await Promise.all([
      fetch("/study-api/curriculum"),
      fetch("/api/items"),
      fetch("/study-api/import-labs"),
    ]);
    if (responses.some((response) => !response.ok))
      throw Error("The server did not return the course content.");
    const [curriculum, items, importedItems] = await Promise.all(
      responses.map((response) => response.json()),
    );
    weeks = curriculum.weeks;
    courseLessons = weeks.flatMap((week) => week.lessons);
    labs.setItems([...items, ...importedItems]);
    route();
    status().catch(() => {
      $("#key-status").textContent = "API settings unavailable";
    });
  } catch (error) {
    setView("overview");
    $("#overview-title").textContent = "Could not load MEGA Workshop";
    $("#resume-card").textContent = errorMessage(error);
  }
}
const importer = createImportUI({
  onConnected: loadCourse,
  onDisconnected() {
    player.select({ audio: null });
    labs.clear();
    weeks = [];
    courseLessons = [];
    selection = { kind: "overview" };
    $("#article").replaceChildren();
    $("#chapters").replaceChildren();
    $("#week-grid").replaceChildren();
    $("#lab-host").replaceChildren();
    $("#resume-card").replaceChildren();
    setView("overview");
    $("#overview-title").textContent = "Connect MEGA to continue";
  },
});
$("#pending-import").onclick = () =>
  importer.open(
    selection.kind === "overview" ? undefined : selection.lesson.sourceUrl,
  );
await importer.initialize();
