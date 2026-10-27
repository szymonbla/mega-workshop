import type { LabItem, Section } from "../shared/types.ts";
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
          : `Explore how “${title}” relates to “${nextSection.title}”. This example has no separate exercise brief; start with its instructions below.`,
      ],
      [
        "Try it below",
        name === "tokenization-round-trip"
          ? "Enter a short sentence in the text field. Look at the token boundaries and IDs, then try another language or add an emoji. No API key is needed."
          : "Read the example’s instructions and try its starting input. Then change one input or setting and compare the results. If it asks for a provider key, configure it in API settings; model requests use your provider’s billing.",
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
    guide.append(steps);
    if (specific && nextSection.answer) {
      const answer = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Show explanation after you try";
      const text = document.createElement("p");
      text.textContent = nextSection.answer;
      answer.append(summary, text);
      guide.append(answer);
    }
    const start = document.createElement("button");
    start.className = "primary example-start";
    start.textContent = "Try this example ↓";
    start.onclick = () => {
      host.scrollIntoView({ behavior: "smooth", block: "start" });
      host.querySelector<HTMLIFrameElement>("iframe:not([hidden])")?.focus();
    };
    guide.append(start);
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
        // Some labs disable document scrolling when embedded. Practice supplies
        // a viewport-sized frame, so its content must remain reachable.
        try {
          const content = frame.contentDocument;
          if (!content) return;
          const style = content.createElement("style");
          style.textContent = "html{overflow-y:auto!important}";
          content.head.append(style);
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
