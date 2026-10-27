---
name: verify
description: Verify MEGA Workshop's local web UI through real browser actions, with isolated configuration, screenshots, traces and cleanup. Use after changes to the reader, course navigation, labs, audio or settings.
---

# Verify MEGA Workshop

Read [the feature map](features/README.md) first. This skill covers the root `mega-workshop` application; the nested `course-examples` CLI is a secondary surface with its own tests. Do not treat a passing browser journey as proof of CLI behavior.

## Launch

From the workspace root, use Node >=22.18. When dependencies are missing, run `npm run setup` (downloads dependencies). For Chromium run `npx playwright install chromium` once; this also downloads files. Alternatively use the installed Google Chrome via `BROWSER_CHANNEL=chrome`. Neither setup command is an offline operation.

Run the isolated authentication, navigation and imported-lesson proof:

```sh
BROWSER_CHANNEL=chrome .agents/skills/verify/scripts/verify.mjs
```

Without installed Chrome, after installing Chromium:

```sh
.agents/skills/verify/scripts/verify.mjs
```

The executable helper launches `scripts/server.mjs`, which calls the production `startStudy` function with a test substitute for the external MEGA authentication service, with `PORT=0` and a unique temporary `MEX_ENV_FILE`, removes inherited OpenAI/OpenRouter keys, and reads the actual URL from `MEGA Workshop → http://localhost:<port>/`. It does not read or change the user's `.env`. No real MEGA login is performed. The helper clicks the actual login and connection controls against the test substitute. It requires locally stored, Git-ignored S01E01 files and an already imported S01E02 with its repository. Missing S01E02 is a failed prerequisite, not permission to fabricate its content. Its session and import-job state stay under scratch; it never opens the user’s MEGA browser profile. Ready means the catalog includes Tokenization and the browser renders the 20 course cards, not just an open socket.

The helper owns the server and browser until its `finally` cleanup. Runs can coexist: each gets an OS-assigned port, temporary configuration, empty browser context and unique evidence directory. Do not drive an existing user instance on port 4830. Run this helper in the foreground and let it finish, including on assertion failure; do not abandon its process.

## Doctor

The read-only `doctor(base)` runs after the browser has completed the isolated login flow. Anonymous requests must return 401 before login. It checks that its child is alive, fetches `/study-api/curriculum`, requires four weeks, 20 lessons and S01E01 Tokenization, and fetches `/api/status` to require no configured provider. The URL comes from this child, not a guessed port. `doctor.json` records PID, address and counts; `report.json` records the absolute checkout and Node version. This is a local source checkout, not a deployed build with a version endpoint.

If an action fails, inspect `server.log`, `doctor.json` and `report.json` before changing selectors. Re-run the helper for a fresh doctor and instance. A failed launch must remain a failure, not attach to another process. A missing browser is a prerequisite failure: choose the documented Chrome channel or install Chromium.

## Drive

Use the existing Playwright workflow documented in the root README and `study/browser/app.test.mjs`. The helper uses the same server isolation and browser library. No collaborative-browser dependency is required for this documented repository workflow.

The helper proves anonymous denial, login controls, automatic synchronization on connection and reload (using two already-local lessons), course-card navigation, topic selection, resume, pending return, imported S01E02 images/transcript/audio/word seeking/exercise loading, invalid-link rejection, and logout denial. It does not verify real MEGA email login, a fresh remote import, or paid exercises. Exact selectors and assertions are in [navigation](features/navigation.md). For additional journeys, extend the helper's `try` body using the feature recipes, retaining its launch/doctor/evidence/finally lifecycle. `page`, `context`, `base`, `scratch`, `capture(name)` and `record(action)` are available there. Do not replace real clicks with internal state setters.

Existing regression suite: `BROWSER_CHANNEL=chrome npm run test:browser`. Some regression cases deliberately seed storage, replace catalog responses or set audio time; those tests alone do not prove a real user journey. For task acceptance, follow the map's actions. Default proof needs no model calls; tokenization is local. Paid experiments are outside this baseline.

## Evidence

Every run prints its unique `.study-data/.audit/verify/run-*` directory. Keep `report.json` (actions, outcome, errors, cleanup), `doctor.json`, `server.log`, screenshots, ARIA snapshots, `storage.json` and `trace.zip`. Inspect a trace with `npx playwright show-trace .study-data/.audit/verify/run-*/trace.zip`, replacing the glob with the exact printed run path if there is more than one run.

Capture actions and resulting states, not only a final screen. Verify side effects by reading storage and reloading/reopening through the UI; settings proof additionally reads the isolated env file and mode. Use real rendered data and requests. Mock only an external production boundary when the task needs one; label that proof. Never mock the course catalog to claim user-path coverage.

The helper blocks off-origin browser requests and records them; the external logo may be absent in screenshots. All application JS, curriculum and audio are served unchanged. This block does not intercept server-side network traffic: absence of provider credentials and choosing navigation/local-tokenization paths are essential. This is not a universal dry-run mode. Do not click paid experiment buttons to test the block. Do not save real secrets in traces or artifacts.

## Cleanup

The helper saves the browser trace, closes its browser, terminates only its child PID (SIGTERM with a five-second SIGKILL fallback), and removes only its temporary configuration directory. All cleanup steps are attempted even after a failure. It then writes `report.json`, confirms that file still exists, and reports whether the server stopped and scratch was removed. Evidence stays outside scratch and survives teardown. Inspect the screenshots/trace after successful execution as well as the JSON result. Do not use process-name kills or delete the Git-ignored evidence directory during cleanup.

## Helpers

`scripts/verify.mjs` is executable; both invocations above run launch → anonymous denial → login UI → doctor → browser journeys → capture → cleanup. A nonzero exit means failed proof or cleanup. It is intentionally one feature proof, not a claim that every mapped feature passes. Read the matching feature file before adding coverage. Use `/maintain-verification-skill` when app changes require updating this map.
