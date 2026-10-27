import type { Section, SectionIdentity } from "../shared/types.ts";
export function buildLessons(
  article: string,
  identities: SectionIdentity[] = [],
  guides: Record<string, string[]> = {},
): Section[] {
  const byHeading = new Map<string, SectionIdentity>();
  const ids = new Set(),
    slugs = new Set(),
    legacyIndexes = new Set();
  for (const identity of identities) {
    if (
      typeof identity.id !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(identity.id) ||
      ids.has(identity.id) ||
      typeof identity.slug !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(identity.slug) ||
      slugs.has(identity.slug) ||
      ids.has(identity.slug) ||
      slugs.has(identity.id)
    ) {
      throw Error("Section IDs and slugs must be unique and URL-safe.");
    }
    if (
      typeof identity.sourceHeading !== "string" ||
      !identity.sourceHeading ||
      byHeading.has(identity.sourceHeading)
    ) {
      throw Error("Each section must have a unique sourceHeading.");
    }
    if (
      !["topic", "introduction", "chapter", "summary"].includes(
        identity.kind,
      ) ||
      typeof identity.title !== "string" ||
      typeof identity.group !== "string" ||
      (identity.guide !== undefined && !Object.hasOwn(guides, identity.guide))
    ) {
      throw Error(`Invalid section metadata for ${identity.id}.`);
    }
    if (identity.legacyIndex !== undefined) {
      if (
        !Number.isInteger(identity.legacyIndex) ||
        identity.legacyIndex < 0 ||
        legacyIndexes.has(identity.legacyIndex)
      ) {
        throw Error(
          "Legacy section indexes must be unique nonnegative integers.",
        );
      }
      legacyIndexes.add(identity.legacyIndex);
    }
    ids.add(identity.id);
    slugs.add(identity.slug);
    byHeading.set(identity.sourceHeading, identity);
  }

  const chunks: { heading: string; markdown: string }[] = [];
  let heading = "Getting Started",
    buffer: string[] = [];
  const flush = () => {
    if (buffer.join("\n").trim())
      chunks.push({ heading, markdown: buffer.join("\n") });
    buffer = [];
  };
  for (const line of article.split("\n")) {
    if (line.startsWith("## ")) {
      flush();
      heading = line.slice(3);
    }
    const match = /^(?:- )?\*\*([^*]+)\*\*/.exec(line);
    const key = match?.[1].replace(/:$/, "");
    if (key && (byHeading.has(key) || Object.hasOwn(guides, key))) {
      flush();
      heading = key;
    }
    buffer.push(line);
  }
  flush();

  const seen = new Set();
  let topicNumber = 0;
  const sections = chunks.map(({ heading, markdown }) => {
    const identity = byHeading.get(heading);
    if (!identity)
      throw Error(
        `Register section "${heading}" in section-identities.json before importing it.`,
      );
    if (seen.has(identity.id))
      throw Error(`Section "${heading}" appears more than once.`);
    seen.add(identity.id);
    const guide = identity.guide ? guides[identity.guide] : undefined;
    return {
      id: identity.id,
      slug: identity.slug,
      title: identity.title,
      group: identity.group,
      kind: identity.kind,
      number: identity.kind === "topic" ? ++topicNumber : null,
      ...(identity.legacyIndex !== undefined
        ? { legacyIndex: identity.legacyIndex }
        : {}),
      markdown,
      labs: [
        ...new Set(
          [
            ...markdown.matchAll(
              /https:\/\/github.com\/MEGA-DOT-DEV\/examples\/tree\/main\/(?:examples|tools)\/([a-z0-9-]+)/g,
            ),
          ].map((match) => match[1]),
        ),
      ],
      task:
        guide?.[1] ||
        "Read this section. Write down one thing you want to test in practice.",
      question:
        guide?.[2] ||
        "How would you explain the main idea of this section in your own words?",
      answer:
        guide?.[3] ||
        "Compare your answer with the text. Give a concrete example and identify one thing you are still unsure about.",
    };
  });
  for (const identity of identities) {
    if (!seen.has(identity.id))
      throw Error(
        `Section "${identity.sourceHeading}" is missing. Update its sourceHeading or remove its registry entry explicitly.`,
      );
  }
  return sections;
}
