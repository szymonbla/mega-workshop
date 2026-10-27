import type { LabItem, Section } from "../shared/types.ts";
export function createLabs({
  host,
  tabs,
  source,
  getTheme,
}: {
  host: HTMLElement;
  tabs: HTMLElement;
  source: HTMLAnchorElement;
  getTheme: () => string;
}) {
  const document = host.ownerDocument;
  const frames = new Map<string, HTMLIFrameElement>();
  let items: LabItem[] = [],
    section: Section | null = null,
    selected = "";
  function themeFrame(frame: HTMLIFrameElement, theme: string) {
    try {
      (
        frame.contentWindow as
          | (Window & { mxTheme?: { set(theme: string): void } })
          | null
      )?.mxTheme?.set(theme);
    } catch {}
  }
  function select(
    nextSection: Section,
    name = nextSection.kind === "topic" ? nextSection.labs[0] || "" : "",
  ) {
    section = nextSection;
    selected = name;
    for (const frame of frames.values()) frame.hidden = true;
    tabs.replaceChildren();
    for (const lab of section.labs) {
      const button = document.createElement("button");
      button.textContent =
        items.find(
          (item) =>
            item.name === lab &&
            (item.base || "") === (nextSection.labBase || ""),
        )?.title || lab;
      button.className = lab === name ? "selected" : "";
      button.onclick = () => select(nextSection, lab);
      tabs.append(button);
    }
    source.hidden = !name;
    if (!name) return;
    const item = items.find(
      (item) =>
        item.name === name && (item.base || "") === (nextSection.labBase || ""),
    );
    source.href = `https://github.com/MEGA-DOT-DEV/examples/tree/main/${item?.kind === "tool" ? "tools" : "examples"}/${name}`;
    const base = section.labBase || "";
    const frameKey = `${base}/${name}`;
    if (!frames.has(frameKey)) {
      const frame = document.createElement("iframe");
      frame.title = `Lab: ${item?.title || name}`;
      frame.src = item?.ui
        ? `${base}/ui/${name}/`
        : `${base}/index.html#/${name}`;
      frame.loading = "eager";
      frame.addEventListener("load", () => themeFrame(frame, getTheme()));
      frames.set(frameKey, frame);
      host.append(frame);
    }
    frames.get(frameKey)!.hidden = false;
  }
  return {
    select,
    setItems(value: LabItem[]) {
      items = value;
    },
    setTheme(theme: string) {
      for (const frame of frames.values()) themeFrame(frame, theme);
    },
    clear() {
      for (const frame of frames.values()) frame.remove();
      frames.clear();
      section = null;
    },
    reset() {
      for (const frame of frames.values()) frame.remove();
      frames.clear();
      if (section) select(section, selected);
    },
  };
}
