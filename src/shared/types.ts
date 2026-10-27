export interface SectionIdentity {
  id: string;
  slug: string;
  sourceHeading: string;
  title: string;
  group: string;
  kind: string;
  legacyIndex?: number;
  guide?: string;
}
export interface Cue {
  start: number;
  end: number;
  word: number;
}
export interface Passage {
  start: number;
  end: number;
  kind: string;
  figure: number;
}
export interface Alignment {
  version: number;
  markdownSha256: string;
  audioSha256: string;
  words: string[];
  cues: Cue[];
  passages: Passage[];
}
export interface Chapter {
  slug: string;
  start: number;
  end: number;
  title?: string;
}
export interface Section {
  id: string;
  slug: string;
  title: string;
  group: string;
  kind: string;
  number: number | null;
  legacyIndex?: number;
  markdown: string;
  html?: string;
  labs: string[];
  task: string;
  question: string;
  answer: string;
  labBase?: string;
  audio?: (Chapter & { src: string; alignment: Alignment | null }) | null;
}
export interface Lesson {
  id: string;
  title: string;
  week: number;
  number: number;
  available: boolean;
  sections: Section[];
  sourceUrl?: string;
  releaseDate?: string;
  transcriptUrl?: string;
}
export interface Week {
  title: string;
  number: number;
  lessons: Lesson[];
}
export interface Curriculum {
  weeks: Week[];
}
export interface SourceMetadata {
  markdown: string;
  transcript: string | null;
  audio: string | null;
  chapters: { slug: string; start: number; title?: string }[];
  duration: number;
}
export interface ImportedSection {
  id: string;
  slug: string;
  title?: string;
  markdown: string;
  html: string;
  start: number;
  end: number;
}
export interface ImportManifest {
  chapters: Chapter[];
  images: { file: string }[];
}
export interface LabItem {
  name: string;
  title: string;
  kind?: string;
  ui?: boolean;
  base?: string;
}
export interface Progress {
  notes: Record<string, string>;
  done: string[];
  again: string[];
  current: number;
  currentSectionId: string | null;
}
export interface ImportStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  detail?: string;
}
export interface ImportJob {
  id: string;
  url: string;
  status: "running" | "interrupted" | "completed" | "failed" | "login_required";
  steps: ImportStep[];
  error?: string | null;
  updatedAt?: string;
}
export interface SyncState {
  status: "idle" | ImportJob["status"];
  total: number;
  done: number;
  failed: string[];
  error: string | null;
}
export interface ImportsResponse {
  jobs: ImportJob[];
  sync: SyncState;
}
export interface ProviderStatus {
  providers: { name: string; envKey: string; set: boolean }[];
}
