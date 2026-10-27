import type { SpawnOptions } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  Chapter,
  Section,
  SourceMetadata,
  Week,
} from "../shared/types.ts";

export interface Catalog {
  weeks: Week[];
  legacySections: Section[];
  audioBySlug: Map<string, Chapter>;
  files: Record<string, string>;
  assets?: Map<string, { file: string; type: string; id: string }>;
  materialPublicRoot?: string;
}
export interface LessonSource {
  check(id: string): Promise<SourceMetadata>;
  get(url: string, kind?: string): Promise<Buffer>;
  availableLessons(ids: string[]): Promise<string[]>;
  login(): Promise<void>;
  logout(): Promise<void>;
  close(): Promise<void>;
}
export type SessionRequest = Pick<IncomingMessage, "headers">;
export interface SessionResponse {
  setHeader(name: string, value: string): void;
}
export type RequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  context: { port: number },
) => Promise<boolean>;
export interface Viewer {
  port: number;
  url: string;
  close(): Promise<void>;
}
export interface Runtime {
  ENV_FILE: string;
  refreshEnv(): void;
  writeEnvFile(file: string, values: Record<string, string>): void;
  startViewer(options: {
    port: number;
    tries?: number;
    handleRequest: RequestHandler;
  }): Promise<Viewer>;
}
export interface CommandOptions extends SpawnOptions {
  onProgress?: (text: string) => void;
}
export type Command = (
  name: string,
  args: string[],
  options?: CommandOptions,
) => Promise<string>;
