import type { Progress } from "../shared/types.ts";

type ProgressSection = { id: string; kind?: string; legacyIndex?: number };
type ProgressLesson = { id: string; sections: ProgressSection[] };
export function legacyKey(id: string) {
  return id === "s01e01" ? "mega-study-v1" : `mega-study-v1:${id}`;
}

export function progressKey(id: string, field: string, section = "") {
  return `mega-study-v2:${id}:${field}:${section}`;
}

export function readProgress(
  storage: Pick<Storage, "getItem">,
  id: string,
  sections: ProgressSection[],
): Progress {
  const state: Progress = {
    notes: {},
    done: [],
    again: [],
    current: 0,
    currentSectionId: null,
  };
  const get = (key: string) => {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  };
  try {
    const old = JSON.parse(get(legacyKey(id)) || "null");
    if (
      old?.notes &&
      typeof old.notes === "object" &&
      !Array.isArray(old.notes)
    )
      state.notes = { ...old.notes };
    if (Array.isArray(old?.done)) state.done = old.done;
    if (Array.isArray(old?.again)) state.again = old.again;
    if (Number.isInteger(old?.current)) state.current = old.current;
  } catch {}
  for (const section of sections) {
    const note = get(progressKey(id, "note", section.id));
    if (note !== null) state.notes[section.id] = note;
    const status = get(progressKey(id, "status", section.id));
    if (status === "done" || status === "again" || status === "pending") {
      state.done = state.done.filter((value) => value !== section.id);
      state.again = state.again.filter((value) => value !== section.id);
      if (status !== "pending") state[status].push(section.id);
    }
  }
  const current = get(progressKey(id, "current"));
  if (current !== null && Number.isInteger(Number(current)))
    state.current = Number(current);
  const savedId = get(progressKey(id, "current-section"));
  const hasLegacyOrder = sections.some((section) =>
    Number.isInteger(section.legacyIndex),
  );
  const resumed =
    savedId !== null
      ? sections.find((section) => section.id === savedId)
      : hasLegacyOrder
        ? sections.find((section) => section.legacyIndex === state.current)
        : sections[Math.max(0, Math.min(state.current, sections.length - 1))];
  state.currentSectionId = (resumed || sections[0])?.id ?? null;
  return state;
}

export function completion(
  sections: ProgressSection[],
  progress: Pick<Progress, "done" | "again">,
) {
  const topics = sections.filter((section) => section.kind === "topic");
  const done = topics.filter((section) =>
    progress.done.includes(section.id),
  ).length;
  const again = topics.filter((section) =>
    progress.again.includes(section.id),
  ).length;
  return {
    done,
    again,
    total: topics.length,
    complete: topics.length > 0 && done === topics.length,
  };
}

export function createProgressStore(
  storage?: Pick<Storage, "getItem" | "setItem">,
) {
  const unsaved = new Map<string, string>();
  const getItem = (key: string): string | null => {
    if (unsaved.has(key)) return unsaved.get(key)!;
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  function write(key: string, value: string) {
    try {
      if (!storage) throw Error("Storage unavailable");
      storage.setItem(key, value);
      unsaved.delete(key);
      return true;
    } catch {
      unsaved.set(key, String(value));
      return false;
    }
  }
  const read = (lesson: ProgressLesson) =>
    readProgress({ getItem }, lesson.id, lesson.sections);
  return {
    read,
    counts: (lesson: ProgressLesson) =>
      completion(lesson.sections, read(lesson)),
    completeLesson(lesson: ProgressLesson) {
      let saved = true;
      for (const section of lesson.sections) {
        if (section.kind !== "topic") continue;
        if (!write(progressKey(lesson.id, "status", section.id), "done"))
          saved = false;
      }
      return { saved, state: read(lesson) };
    },
    visit(lesson: ProgressLesson, section: ProgressSection) {
      const saved = write(
        progressKey(lesson.id, "current-section"),
        section.id,
      );
      const savedLast = write("mega-study-last", lesson.id);
      return saved && savedLast;
    },
    mark(lesson: ProgressLesson, sectionId: string, status: string) {
      if (
        !["done", "again", "pending"].includes(status) ||
        !lesson.sections.some(
          (section) => section.id === sectionId && section.kind === "topic",
        )
      ) {
        throw Error(
          "Only a learning topic can be marked done, again or pending.",
        );
      }
      const saved = write(progressKey(lesson.id, "status", sectionId), status);
      return { saved, state: read(lesson) };
    },
    affects(key: string | null, lessonId?: string) {
      if (key === null) return true;
      if (lessonId)
        return (
          key === legacyKey(lessonId) ||
          key.startsWith(`mega-study-v2:${lessonId}:`)
        );
      return key.startsWith("mega-study-");
    },
    resumeLesson<L extends { id: string; available: boolean }>(lessons: L[]) {
      const id = getItem("mega-study-last");
      return (
        lessons.find((lesson) => lesson.id === id && lesson.available) ||
        lessons.find((lesson) => lesson.available)
      );
    },
  };
}
