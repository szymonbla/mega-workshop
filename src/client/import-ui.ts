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
  function activity(text: string, busy = false) {
    $("#connection-detail").textContent = text;
    $("#connection-activity").dataset.busy = String(busy);
  }
  function startup(step: number, title: string, detail: string) {
    if ($("#startup").hidden) return;
    $("#startup-title").textContent = title;
    $("#startup-detail").textContent = detail;
    $("#startup")
      .querySelectorAll("li")
      .forEach((item, index) => {
        item.setAttribute(
          "data-state",
          index < step ? "done" : index === step ? "active" : "pending",
        );
      });
    activity(detail, true);
  }
  $("#connection-retry").onclick = () => location.reload();
  $("#download-details").onclick = () => {
    if (!dialog.open) dialog.showModal();
    void refresh();
  };

  let authenticated = false,
    selected: ImportJob | null = null,
    timer: ReturnType<typeof setInterval>,
    busy = false,
    lastComplete = "";
  const message = (text: string) => {
    $("#import-message").textContent = text;
  };
  function reportError(error: unknown) {
    const detail = errorMessage(error);
    message(
      /timeout|aborted/i.test(detail)
        ? "This is taking longer than expected. Check your connection and retry. Your saved lessons are safe."
        : /fetch|network/i.test(detail)
          ? "Could not reach the application. Make sure it is still running, then retry."
          : detail,
    );
    activity("This step could not finish. See the message below and retry.");
    $("#connection-retry").hidden = false;
  }
  async function api<T = { ok: boolean }>(
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(
      `/study-api/${path}`,
      body === undefined
        ? { signal: AbortSignal.timeout(60000) }
        : {
            signal: AbortSignal.timeout(60000),
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
    $("#startup").hidden = true;
    $("#download-notice").hidden = true;
    activity(
      "Sign in to MEGA. We will then find and prepare your available lessons.",
    );
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
    $("#connection-retry").hidden = true;
    $("#import-sync").hidden = false;
    $("#import-auth").hidden = true;
    $("#import-form").hidden = false;
    $("#import-disconnect").hidden = false;
    $("#import-close").hidden = false;
    $("#import-button").textContent = "Add lesson";
    startup(
      1,
      "Finding your lessons",
      "Checking access and starting background downloads. Existing lessons stay on this computer.",
    );
    activity("Checking your available lessons…", true);
    await api("imports/sync", {});
    startup(
      2,
      "Opening your workspace",
      "Loading your course, reading materials and exercises. This can take a moment.",
    );
    activity("Opening your course…", true);
    await onConnected();
    $("#startup").hidden = true;
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
      const preparing = syncing || job?.status === "running";
      const detail =
        job?.status === "running"
          ? `${job.id.toUpperCase()} · ${job.steps.find((step) => step.status === "running")?.label || "Preparing lesson"}`
          : $("#import-sync-status").textContent || "Your workspace is ready.";
      activity(detail, preparing);
      $("#download-notice").hidden = !preparing;
      $("#download-detail").textContent =
        `${detail} You can read ready lessons while we work.`;
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
      reportError(error);
      activity(
        "Could not update download progress. We will try again shortly.",
      );
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
      reportError(error);
      $("#import-submit").disabled = false;
    }
  }
  $("#import-sync").onclick = async () => {
    try {
      await api("imports/sync", {});
      await refresh();
    } catch (error) {
      reportError(error);
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
    activity("Opening a private MEGA browser window…", true);
    message("Opening a private MEGA browser window…");
    try {
      await api("auth/login", {});
      activity(
        "Waiting for you to sign in. Return here and select Continue when you are ready.",
      );
      message(
        "Finish signing in in the MEGA browser window, then select Continue.",
      );
    } catch (error) {
      reportError(error);
    } finally {
      $("#connection-activity").dataset.busy = "false";
      $("#import-login").disabled = false;
    }
  };
  $("#import-connected").onclick = async () => {
    $("#import-connected").disabled = true;
    activity("Verifying your MEGA connection…", true);
    try {
      await api("auth/complete", {});
      message("Connected to MEGA.");
      await connected();
    } catch (error) {
      reportError(error);
    } finally {
      $("#connection-activity").dataset.busy = "false";
      $("#import-connected").disabled = false;
    }
  };
  $("#import-disconnect").onclick = async () => {
    try {
      await api("auth/logout", {});
      lock();
      message("Disconnected from MEGA.");
    } catch (error) {
      reportError(error);
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
        let status = await api<{ authenticated: boolean }>("auth/status");
        if (!status.authenticated) {
          startup(
            0,
            "Restoring your MEGA connection",
            "Looking for your saved login so you do not have to sign in again.",
          );
          status = await api<{ authenticated: boolean }>("auth/restore", {});
        }
        if (status.authenticated) await connected();
        else lock();
      } catch (error) {
        lock();
        reportError(error);
        activity(
          "We could not finish connecting. Try signing in again, or reload to retry.",
        );
      }
      let ticks = 0;
      timer = setInterval(async () => {
        await refresh();
        if (++ticks % 5 === 0 && authenticated) {
          try {
            const status = await api<{ authenticated: boolean }>("auth/status");
            if (!status.authenticated) lock();
          } catch (error) {
            reportError(error);
          }
        }
      }, 3000);
      addEventListener("pagehide", () => clearInterval(timer), { once: true });
    },
  };
}
