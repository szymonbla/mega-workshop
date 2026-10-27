import { errorMessage } from "../shared/errors.ts";
import type { ImportJob, ImportsResponse } from "../shared/types.ts";
import { query } from "./dom.ts";
export function createImportUI({
  onConnected,
  onDisconnected,
}: {
  onConnected: () => Promise<void>;
  onDisconnected: () => void;
}) {
  const $ = query;
  const dialog = $("#lesson-import");
  let authenticated = false,
    selected: ImportJob | null = null,
    timer: ReturnType<typeof setInterval>,
    busy = false,
    lastComplete = "";
  const message = (text: string) => {
    $("#import-message").textContent = text;
  };
  async function api<T = { ok: boolean }>(
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(
      `/study-api/${path}`,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) lock();
      throw Error(data.error || "The request failed. Try again.");
    }
    return data as T;
  }
  function lock() {
    if (authenticated) onDisconnected();
    authenticated = false;
    $("#import-sync").hidden = true;
    $("#import-auth").hidden = false;
    $("#import-form").hidden = true;
    $("#import-disconnect").hidden = true;
    $("#import-button").textContent = "Connect MEGA";
    $("#import-close").hidden = true;
    if (!dialog.open) dialog.showModal();
  }
  async function connected() {
    authenticated = true;
    $("#import-sync").hidden = false;
    $("#import-auth").hidden = true;
    $("#import-form").hidden = false;
    $("#import-disconnect").hidden = false;
    $("#import-close").hidden = false;
    $("#import-button").textContent = "Add lesson";
    await api("imports/sync", {});
    await onConnected();
    await refresh();
  }
  function render(job: ImportJob | null) {
    selected = job;
    $("#import-steps").replaceChildren();
    if (!job) return;
    $("#import-job-title").textContent = job.id.toUpperCase();
    for (const step of job.steps) {
      const row = document.createElement("li");
      row.dataset.state = step.status;
      const mark = document.createElement("span");
      mark.textContent = { done: "✓", running: "◉", failed: "!", pending: "○" }[
        step.status
      ];
      mark.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.textContent = step.label;
      const detail = document.createElement("small");
      detail.textContent =
        step.status === "done"
          ? "Done"
          : step.detail ||
            {
              running: "In progress",
              failed: "Needs attention",
              pending: "Waiting",
            }[step.status] ||
            "";
      text.append(detail);
      row.append(mark, text);
      $("#import-steps").append(row);
    }
    $("#import-retry").hidden = ![
      "failed",
      "interrupted",
      "login_required",
    ].includes(job.status);
    $("#import-disconnect").disabled = job.status === "running";
    $("#import-open").hidden = job.status !== "completed";
    $("#import-open").href = `#/lesson/${job.id}`;
    $("#import-submit").disabled = job.status === "running";
    message(
      job.error ||
        (job.status === "completed"
          ? "Your lesson is ready."
          : job.status === "running"
            ? "You can close this panel. Preparation continues in the background."
            : ""),
    );
    $("#import-button").textContent =
      job.status === "running" ? "Preparing lesson…" : "Add lesson";
  }
  async function refresh() {
    if (!authenticated || busy) return;
    busy = true;
    try {
      const { jobs, sync } = await api<ImportsResponse>("imports");
      const job =
        jobs.find((job) => job.status === "running") ||
        jobs.find((job) => job.id === selected?.id) ||
        jobs.at(-1);
      if (job) render(job);
      const completed = jobs
        .filter((job) => job.status === "completed")
        .map((job) => job.id + job.updatedAt)
        .join("|");
      if (completed !== lastComplete) {
        lastComplete = completed;
        await onConnected();
      }
      const syncing = sync?.status === "running";
      $("#import-sync").disabled = syncing;
      $("#import-submit").disabled = syncing || job?.status === "running";
      $("#import-disconnect").disabled = syncing || job?.status === "running";
      $("#import-retry").disabled = syncing;
      $("#import-sync-status").textContent = syncing
        ? sync.total
          ? `Preparing all available lessons: ${sync.done} of ${sync.total} processed.`
          : "Checking which lessons are available to your account…"
        : sync?.status === "completed"
          ? `All ${sync.total} available lessons are ready.`
          : sync?.error || "";
      $("#import-button").textContent = syncing
        ? "Downloading lessons…"
        : "Your lessons";
      $("#import-failures").replaceChildren();
      for (const failed of jobs.filter((job) =>
        ["failed", "interrupted", "login_required"].includes(job.status),
      )) {
        const row = document.createElement("li");
        row.textContent = `${failed.id.toUpperCase()}: ${failed.error || "Download interrupted."}`;
        $("#import-failures").append(row);
      }
    } catch (error) {
      message(errorMessage(error));
    } finally {
      busy = false;
    }
  }
  async function start(url: string) {
    $("#import-submit").disabled = true;
    try {
      const { job } = await api<{ job: ImportJob }>("imports", { url });
      render(job);
      await refresh();
    } catch (error) {
      message(errorMessage(error));
      $("#import-submit").disabled = false;
    }
  }
  $("#import-sync").onclick = async () => {
    try {
      await api("imports/sync", {});
      await refresh();
    } catch (error) {
      message(errorMessage(error));
    }
  };
  $("#import-button").onclick = () => {
    if (!dialog.open) dialog.showModal();
    refresh();
  };
  $("#import-close").onclick = () => dialog.close();
  dialog.addEventListener("cancel", (event) => {
    if (!authenticated) event.preventDefault();
  });
  $("#import-login").onclick = async () => {
    $("#import-login").disabled = true;
    message("Opening a private MEGA browser window…");
    try {
      await api("auth/login", {});
      message(
        "Finish signing in in the MEGA browser window, then select Continue.",
      );
    } catch (error) {
      message(errorMessage(error));
    } finally {
      $("#import-login").disabled = false;
    }
  };
  $("#import-connected").onclick = async () => {
    $("#import-connected").disabled = true;
    try {
      await api("auth/complete", {});
      message("Connected to MEGA.");
      await connected();
    } catch (error) {
      message(errorMessage(error));
    } finally {
      $("#import-connected").disabled = false;
    }
  };
  $("#import-disconnect").onclick = async () => {
    try {
      await api("auth/logout", {});
      lock();
      message("Disconnected from MEGA.");
    } catch (error) {
      message(errorMessage(error));
    }
  };
  $("#import-form").onsubmit = (event) => {
    event.preventDefault();
    start($("#import-url").value);
  };
  $("#import-retry").onclick = () => selected && start(selected.url);
  $("#import-open").onclick = () => {
    dialog.close();
    location.hash = `#/lesson/${selected?.id}`;
    dispatchEvent(new PopStateEvent("popstate"));
  };
  return {
    open(url?: string) {
      $("#import-url").value = url || "";
      if (!dialog.open) dialog.showModal();
    },
    async initialize() {
      try {
        const status = await api<{ authenticated: boolean }>("auth/status");
        if (status.authenticated) await connected();
        else lock();
      } catch (error) {
        lock();
        message(errorMessage(error));
      }
      let ticks = 0;
      timer = setInterval(async () => {
        await refresh();
        if (++ticks % 5 === 0 && authenticated) {
          try {
            const status = await api<{ authenticated: boolean }>("auth/status");
            if (!status.authenticated) lock();
          } catch {
            lock();
          }
        }
      }, 3000);
      addEventListener("pagehide", () => clearInterval(timer), { once: true });
    },
  };
}
