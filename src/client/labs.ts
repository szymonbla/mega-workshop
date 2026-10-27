import type { LabItem, Section } from "../shared/types.ts";
/** Only offer examples actually linked in this section's rendered article. */
export function linkedLabs(section: Section): string[] {
  const article = document.createElement("template");
  article.innerHTML = section.html || "";
  const names = new Set<string>();
  for (const link of article.content.querySelectorAll("a[href]")) {
    try {
      const url = new URL(link.getAttribute("href")!);
      const match =
        /^\/MEGA-DOT-DEV\/examples\/tree\/main\/(?:examples|tools)\/([a-z0-9-]+)(?:\/|$)/.exec(
          url.pathname,
        );
      if (
        url.origin === "https://github.com" &&
        match &&
        section.labs.includes(match[1])
      )
        names.add(match[1]);
    } catch {}
  }
  return [...names];
}

export function createLabs({
  host,
  tabs,
  source,
  guide,
  getTheme,
}: {
  host: HTMLElement;
  tabs: HTMLElement;
  source: HTMLAnchorElement;
  guide: HTMLElement;
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
      if (frame.contentDocument)
        frame.contentDocument.documentElement.dataset.theme = theme;
    } catch {}
  }
  function select(
    nextSection: Section,
    name = nextSection.kind === "topic" ? nextSection.labs[0] || "" : "",
  ) {
    section = nextSection;
    name = nextSection.labs.includes(name) ? name : "";
    selected = name;
    guide.replaceChildren();
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
      button.setAttribute("aria-pressed", String(lab === name));
      button.onclick = () => select(nextSection, lab);
      tabs.append(button);
    }
    source.hidden = !name;
    if (!name) return;
    const item = items.find(
      (item) =>
        item.name === name && (item.base || "") === (nextSection.labBase || ""),
    );
    const title = item?.title || name;
    const heading = document.createElement("h3");
    heading.textContent = title;
    guide.append(heading);
    const specific =
      Boolean(nextSection.task) &&
      ![
        "Apply one idea from this section to your own example.",
        "Read this section. Write down one thing you want to test in practice.",
      ].includes(nextSection.task);
    const steps = document.createElement("ol");
    const instructions = [
      [
        "Your goal",
        specific
          ? nextSection.task
          : `Try the example linked in “${nextSection.title}”. Follow the instructions in the workspace below.`,
      ],
      [
        "Try it below",
        name === "tokenization-round-trip"
          ? "Enter a short sentence in the text field. Look at the token boundaries and IDs, then try another language or add an emoji. No API key is needed."
          : "Try the starting input, then change one thing and compare the results.",
      ],
      [
        "Check your understanding",
        specific && nextSection.question
          ? nextSection.question
          : "What changed in the result, and how does it relate to the lesson? Explain one observation in your own words before moving on.",
      ],
    ];
    for (const [label, instruction] of instructions) {
      const step = document.createElement("li");
      const labelElement = document.createElement("strong");
      labelElement.textContent = label;
      const text = document.createElement("p");
      text.textContent = instruction;
      step.append(labelElement, text);
      steps.append(step);
    }
    const instructionsPanel = document.createElement("details");
    instructionsPanel.className = "practice-instructions";
    const instructionsSummary = document.createElement("summary");
    instructionsSummary.textContent = "Step-by-step guide";
    instructionsPanel.append(instructionsSummary, steps);
    guide.append(instructionsPanel);
    if (specific && nextSection.answer) {
      const answer = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Show explanation after you try";
      const text = document.createElement("p");
      text.textContent = nextSection.answer;
      answer.append(summary, text);
      instructionsPanel.append(answer);
    }
    tabs.hidden = nextSection.labs.length < 2;
    const choice = document.getElementById("lab-choice");
    if (choice) choice.hidden = tabs.hidden;
    const exampleTitle = document.getElementById("example-title");
    if (exampleTitle) exampleTitle.textContent = title;
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
      frame.addEventListener("load", () => {
        themeFrame(frame, getTheme());
        try {
          const content = frame.contentDocument;
          const view = frame.contentWindow;
          if (!content || !view) return;
          const style = content.createElement("link");
          style.rel = "stylesheet";
          style.href = "/study/lab.css";
          content.documentElement.dataset.workshopLab = name;
          const resize = () => {
            const page = content.querySelector<HTMLElement>(".mx-page");
            if (page && !frame.hidden) {
              frame.style.setProperty(
                "--lab-height",
                `${Math.ceil(page.getBoundingClientRect().height) + 2}px`,
              );
            }
          };
          style.onload = resize;
          content.head.append(style);
          const observer = new ResizeObserver(resize);
          const page = content.querySelector(".mx-page");
          if (page) observer.observe(page);
          frame.addEventListener("load", () => observer.disconnect(), {
            once: true,
          });
        } catch {}
      });
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
