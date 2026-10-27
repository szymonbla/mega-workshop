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
import { createLabs, linkedLabs } from "./labs.ts";
import { linkLabel } from "./link-labels.ts";
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
  const topicDone = state.done.includes(selection.section.id);
  $("#complete-topic").hidden = selection.section.kind !== "topic";
  $("#complete-topic").setAttribute("aria-pressed", String(topicDone));
  $("#complete-topic").textContent = topicDone
    ? "✓ Completed · Undo"
    : "Mark topic complete";
  const { done: count, total, again, complete } = completion(lessons, state);
  $("#complete-lesson").disabled = complete || total === 0;
  $("#complete-lesson").textContent = complete
    ? "✓ Lesson completed"
    : "Complete lesson";
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
  $("main").classList.toggle("practicing", name === "practice");
  if (name === "practice") player.pause();
  player.refresh();
  if ($(".workspace-tabs").getBoundingClientRect().bottom < 0)
    $(".workspace-tabs").scrollIntoView({ block: "start" });
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
      const practice = Boolean(
        match && hasPractice(section) && section.labs.includes(match[1]),
      );
      const badge = document.createElement("span");
      badge.className = "link-badge";
      badge.textContent = linkLabel(
        link.href,
        link.textContent || "",
        practice,
      );
      link.append(" ", badge);
      if (match && practice) {
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
  window.scrollTo({ top: 0, behavior: "instant" });
  $(".reader").scrollTop = 0;
  $(".practice").scrollTop = 0;
}

let providerStatus: ProviderStatus | undefined;
let replacingKey = false;
let savingKey = false;
let loadingKeys = false;
const selectedKeyName = () =>
  $("#provider").value === "openai" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY";
function renderKeySettings() {
  const saved = providerStatus?.providers.find(
    (p) => p.envKey === selectedKeyName(),
  )?.set;
  const locked = loadingKeys || !providerStatus || (saved && !replacingKey);
  const name = $("#provider").value === "openai" ? "OpenAI" : "OpenRouter";
  $("#provider-key-status").textContent = loadingKeys
    ? "Checking saved keys…"
    : !providerStatus
      ? "Could not load saved keys. Close settings and try again."
      : saved
        ? `${name} API key is saved on this computer. ${replacingKey ? "Your current key stays active until the replacement is verified and saved." : "All labs can use it. Only one key per provider can be saved."}`
        : `No ${name} API key saved.`;
  $("#key-entry").hidden = !!locked;
  $("#api-key").disabled = !!locked || savingKey;
  $("#key-form button[type=submit]").disabled = !!locked || savingKey;
  $("#key-form button[type=submit]").textContent = replacingKey
    ? "Verify and replace key"
    : "Verify and save key";
  $("#replace-key").hidden = !saved || replacingKey || loadingKeys;
  $("#cancel-key-change").hidden = !replacingKey;
  $("#cancel-key-change").disabled = savingKey;
  $("#provider").disabled = savingKey || loadingKeys;
  $("#close-config").disabled = savingKey;
  for (const option of $("#provider").options) {
    const keyName =
      option.value === "openai" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY";
    const name = option.value === "openai" ? "OpenAI" : "OpenRouter";
    option.textContent =
      name +
      (providerStatus?.providers.find((p) => p.envKey === keyName)?.set
        ? " · Key saved"
        : "");
  }
}
async function status() {
  const response = await fetch("/api/status");
  if (!response.ok) throw Error("Could not load settings.");
  providerStatus = await response.json();
  const configured = providerStatus!.providers.filter(
    (provider) => provider.set,
  );
  $("#key-status").textContent = configured.length
    ? `${configured.map((provider) => provider.name).join(" + ")} · key saved`
    : "Add an API key";
  renderKeySettings();
}
function resetKeyEditor() {
  replacingKey = false;
  $("#api-key").value = "";
  $("#config-status").textContent = "";
  $("#config-status").dataset.error = "false";
  renderKeySettings();
}
$("#search").oninput = nav;
$("#complete-topic").onclick = () => {
  if (selection.kind !== "reader" || selection.section.kind !== "topic") return;
  const done = progress
    .read(selection.lesson)
    .done.includes(selection.section.id);
  const result = progress.mark(
    selection.lesson,
    selection.section.id,
    done ? "pending" : "done",
  );
  state = result.state;
  nav();
  $("#saved").textContent = result.saved
    ? done
      ? "Topic marked incomplete. Progress saved."
      : "Topic completed. Progress saved."
    : "Could not save progress in this browser. This change is kept for this session only.";
};
$("#complete-lesson").onclick = () => {
  if (selection.kind !== "reader") return;
  const result = progress.completeLesson(selection.lesson);
  state = result.state;
  player.pause();
  nav();
  $("#saved").textContent = result.saved
    ? "Lesson completed. Progress saved in this browser."
    : "Lesson completed for this session only. Could not save progress in this browser.";
};
$("#review").onclick = () => {
  reviewOnly = !reviewOnly;
  nav();
};
$("#settings").onclick = async () => {
  loadingKeys = true;
  resetKeyEditor();
  $("#config").showModal();
  try {
    await status();
  } catch {
    providerStatus = undefined;
  } finally {
    loadingKeys = false;
    renderKeySettings();
  }
};
$("#close-config").onclick = () => $("#config").close();
$("#config").addEventListener("close", resetKeyEditor);
$("#config").addEventListener("cancel", (event) => {
  if (savingKey) event.preventDefault();
});
$("#replace-key").onclick = () => {
  replacingKey = true;
  renderKeySettings();
  $("#api-key").focus();
};
$("#cancel-key-change").onclick = resetKeyEditor;
const clearKeyError = () => {
  if ($("#config-status").dataset.error === "true") {
    $("#config-status").textContent = "";
    $("#config-status").dataset.error = "false";
  }
};
$("#api-key").oninput = clearKeyError;
$("#provider").onchange = resetKeyEditor;
$("#key-form").onsubmit = async (event) => {
  event.preventDefault();
  const button = $("#key-form button[type=submit]");
  if (button.disabled) return;
  savingKey = true;
  renderKeySettings();
  $("#config-status").dataset.error = "false";
  $("#config-status").textContent = "Verifying key with provider…";
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
    replacingKey = false;
    // Saving succeeded even if refreshing the header temporarily fails.
    const savedProvider = providerStatus?.providers.find(
      (p) => p.envKey === selectedKeyName(),
    );
    if (savedProvider) savedProvider.set = true;
    await status().catch(() => {});
    $("#config-status").textContent =
      "Saved. API key verified. Model access and available credits depend on your account.";
    labs.reset();
  } catch (error) {
    $("#config-status").dataset.error = "true";
    $("#config-status").textContent = errorMessage(error);
  } finally {
    savingKey = false;
    renderKeySettings();
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
      fetch("/study-api/curriculum", { signal: AbortSignal.timeout(60000) }),
      fetch("/api/items", { signal: AbortSignal.timeout(60000) }),
      fetch("/study-api/import-labs", { signal: AbortSignal.timeout(60000) }),
    ]);
    if (responses.some((response) => !response.ok))
      throw Error("The server did not return the course content.");
    const [curriculum, items, importedItems] = await Promise.all(
      responses.map((response) => response.json()),
    );
    weeks = curriculum.weeks;
    courseLessons = weeks.flatMap((week) => week.lessons);
    for (const lesson of courseLessons)
      for (const section of lesson.sections) section.labs = linkedLabs(section);
    labs.setItems([...items, ...importedItems]);
    route();
    status().catch(() => {
      $("#key-status").textContent = "API settings unavailable";
    });
  } catch (error) {
    setView("overview");
    $("#overview-title").textContent = "Could not load MEGA Workshop";
    $("#resume-card").textContent = errorMessage(error);
    throw error;
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
