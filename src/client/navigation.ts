export interface RouteLesson {
  id: string;
  available: boolean;
  sections: { id: string; slug: string }[];
}
export type Selection<
  L extends RouteLesson = import("../shared/types.ts").Lesson,
> =
  | { kind: "overview" }
  | { kind: "pending"; lesson: L }
  | { kind: "reader"; lesson: L; section: L["sections"][number] };
export function selectSection<L extends RouteLesson>(
  lesson: L,
  target?: string,
  progress: { currentSectionId?: string | null } = {},
): Exclude<Selection<L>, { kind: "overview" }> {
  const section =
    lesson.sections.find(
      (item) => item.id === target || item.slug === target,
    ) ||
    lesson.sections.find((item) => item.id === progress.currentSectionId) ||
    lesson.sections[0];
  return section
    ? { kind: "reader", lesson, section }
    : { kind: "pending", lesson };
}

export function resolveRoute<L extends RouteLesson>(
  hash: string,
  lessons: L[],
  readProgress: (lesson: L) => { currentSectionId?: string | null },
): Selection<L> {
  const path = hash.replace(/^#/, "");
  if (!path || path === "/course") return { kind: "overview" };
  const match = /^\/lesson\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/.exec(path);
  const id = match ? match[1] : "s01e01";
  const target = match ? match[2] : path;
  const lesson = lessons.find((item) => item.id === id);
  if (!lesson) return { kind: "overview" };
  if (!lesson.available) return { kind: "pending", lesson };
  return selectSection(lesson, target, readProgress(lesson));
}
