/** Present API output as readable text while retaining the exact response. */
export function responseSummary(value: unknown): {
  text: string;
  error: boolean;
  meta: string;
} {
  const record = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const envelope = record(value);
  const response = record(envelope.response);
  const failure = record(response.error);
  const error = Number(envelope.status) >= 400 || Boolean(response.error);
  if (error)
    return {
      error: true,
      text:
        typeof failure.message === "string"
          ? failure.message
          : "The provider could not complete this request. Check the request details below, then adjust your settings or try again.",
      meta: `HTTP ${envelope.status ?? "error"}`,
    };
  const parts: string[] = [];
  if (typeof response.output_text === "string")
    parts.push(response.output_text);
  else if (Array.isArray(response.output)) {
    for (const item of response.output) {
      const content = record(item).content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        const entry = record(part);
        if (entry.type === "output_text" && typeof entry.text === "string")
          parts.push(entry.text);
        if (entry.type === "refusal" && typeof entry.refusal === "string")
          parts.push(entry.refusal);
      }
    }
  }
  const usage = record(response.usage);
  const meta = [
    typeof response.model === "string" ? response.model : "",
    typeof usage.input_tokens === "number"
      ? `${usage.input_tokens} input tokens`
      : "",
    typeof usage.output_tokens === "number"
      ? `${usage.output_tokens} output tokens`
      : "",
    response.status === "incomplete"
      ? "Incomplete response — see technical details"
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    error: false,
    text:
      parts.join("\n\n") ||
      "The provider returned no text answer. Open the technical details to inspect tool calls or other output.",
    meta,
  };
}

export function installLabFeedback(
  document: Document,
  name: string,
): () => void {
  const page = document.querySelector(".mx-page");
  if (!page) return () => {};
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text = "",
  ) => {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  };
  if (name !== "responses-request") {
    const target = document.querySelector<HTMLElement>("#headline");
    if (!target) return () => {};
    const local = [
      "context-window-budget",
      "tokenization-round-trip",
      "chat-template",
    ].includes(name);
    const navigation = make("div", "workshop-result-nav");
    const label = make(
      "span",
      "",
      local
        ? "Results update as you change the input"
        : "Find the result below the controls",
    );
    const jump = make("button", "", "View result ↓");
    jump.type = "button";
    jump.onclick = () =>
      target.scrollIntoView({ behavior: "auto", block: "center" });
    navigation.append(label, jump);
    page.prepend(navigation);
    const heading = make(
      "h2",
      "workshop-result-heading",
      local ? "Your result · live calculation" : "Your result",
    );
    target.before(heading);
    target.classList.add("workshop-live-result");
    target.setAttribute("aria-live", "polite");
    const update = () => {
      const available = !target.hidden && Boolean(target.textContent?.trim());
      heading.hidden = !available;
      jump.disabled = !available;
      if (!available)
        label.textContent = local
          ? "Preparing the calculation…"
          : "Run the example to see a result";
      else
        label.textContent = local
          ? "Results update as you change the input"
          : "A result is available below";
    };
    const observer = new MutationObserver(update);
    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
    update();
    return () => observer.disconnect();
  }
  const result = document.querySelector<HTMLElement>("#result");
  const notice = document.querySelector<HTMLElement>("#notice");
  const run = document.querySelector<HTMLButtonElement>("#run");
  if (!result || !notice || !run) return () => {};
  const resultSection = result.closest("section")!;
  resultSection.querySelector("h2")!.textContent = "2. Read the model’s answer";
  const hint = resultSection.querySelector(".mx-hint");
  if (hint)
    hint.textContent =
      "Start with the answer. Open the technical details to explore how the API returned it.";
  run.textContent = "Get model response";
  const costHint = run.closest("section")?.querySelector(".mx-hint");
  if (costHint)
    costHint.textContent =
      "Uses your API provider. Each click sends one paid request.";
  const inputLabel = document.querySelector('label[for="prompt"]');
  if (inputLabel) inputLabel.textContent = "1. Write a message to the model";
  const state = make("div", "workshop-response-status", "Ready to try");
  state.setAttribute("role", "status");
  const card = make("div", "workshop-answer");
  card.id = "workshop-answer";
  card.setAttribute("aria-label", "Model answer");
  const text = make(
    "div",
    "workshop-answer-text",
    "Write a message above, then choose Get model response. The answer will appear here.",
  );
  const meta = make("p", "workshop-answer-meta");
  card.append(state, text, meta);
  const details = make("details", "workshop-response-details");
  details.append(
    make(
      "summary",
      "",
      "Technical details · request, response and token usage",
    ),
  );
  result.before(card, details);
  details.append(notice, result);
  details.hidden = true;
  const navigation = make("div", "workshop-result-nav");
  const status = make("span", "", "Ready · one request per click");
  const jump = make("button", "", "View answer ↓");
  jump.type = "button";
  jump.onclick = () =>
    card.scrollIntoView({ behavior: "auto", block: "center" });
  navigation.append(status, jump);
  run.after(navigation);
  let lastResult = "",
    waiting = false,
    submitted = "";
  const signature = () =>
    [...page.querySelectorAll<HTMLInputElement>("input, textarea")]
      .map((input) => input.value)
      .join("\n");
  const inputChanged = () => {
    if (card.dataset.state === "ready" && submitted !== signature()) {
      state.textContent = "Previous response · input has changed";
      status.textContent = "Run again to answer the updated input";
    }
  };
  page.addEventListener("input", inputChanged);
  const update = () => {
    if (run.disabled) {
      if (!waiting) submitted = signature();
      waiting = true;
      card.dataset.state = "loading";
      card.setAttribute("aria-busy", "true");
      state.textContent = "Waiting for the model…";
      status.textContent = "Request in progress";
      run.textContent = "Waiting for response…";
      text.textContent =
        "Your request is running. The answer will appear here when it is ready.";
      meta.textContent = "";
      details.hidden = true;
      return;
    }
    run.textContent = "Get model response";
    card.setAttribute("aria-busy", "false");
    const raw = result.querySelector("pre")?.textContent || "";
    // A failed retry must not make the previous answer look like a new one.
    const failure = notice.querySelector(".mx-callout");
    if (waiting && failure) {
      card.dataset.state = "error";
      state.textContent = "Request failed";
      status.textContent = "Could not get an answer";
      text.textContent =
        notice.textContent || "Check API settings and try again.";
      meta.textContent =
        "No new answer was received. Review the error before retrying.";
      details.hidden = true;
      waiting = false;
      return;
    }
    if (raw && (raw !== lastResult || waiting)) {
      try {
        const summary = responseSummary(JSON.parse(raw));
        card.dataset.state = summary.error ? "error" : "ready";
        state.textContent = summary.error
          ? "Request failed"
          : "Response received";
        status.textContent = summary.error
          ? "Could not get an answer"
          : "Response received · view it below";
        text.textContent = summary.text;
        meta.textContent = summary.meta;
        details.hidden = false;
        details.open = false;
        lastResult = raw;
        inputChanged();
      } catch {
        state.textContent = "Response available in technical details";
        text.textContent =
          "This result could not be formatted as a text answer. Open the technical details below.";
        details.hidden = false;
      }
    }
    waiting = false;
  };
  const observer = new MutationObserver(update);
  observer.observe(result, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  observer.observe(notice, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  observer.observe(run, { attributes: true, attributeFilter: ["disabled"] });
  update();
  return () => {
    observer.disconnect();
    page.removeEventListener("input", inputChanged);
  };
}
