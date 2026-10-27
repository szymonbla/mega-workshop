import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Alignment, Section } from "../shared/types.ts";

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

export function loadReadAlong(
  root: string,
  section: Pick<Section, "slug" | "markdown">,
): Alignment | null {
  const file = join(root, "alignment", `${section.slug}.json`);
  if (!existsSync(file)) return null;
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (
    data.version !== 1 ||
    data.markdownSha256 !== hash(section.markdown) ||
    data.audioSha256 !==
      hash(readFileSync(join(root, "public", "audio", `${section.slug}.mp3`)))
  )
    return null;
  return data;
}
