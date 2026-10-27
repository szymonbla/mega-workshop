# MEGA Study verification map

Use a fresh helper-owned server with temporary `MEX_ENV_FILE`, no provider keys, and a new browser context. S01E01 has 31 sections, 24 counted topics; the extended helper additionally requires the locally imported S01E02. Session state is isolated and the external MEGA authentication service is simulated; local access checks and lesson data are real. The root README includes stale completion-button instructions: report that path as blocked rather than filling localStorage to make it pass.

Recipes use Playwright's `page` and `context` from the helper. Stable IDs come from the actual UI. Wait for rendered states, not sleeps. Record each action with `record`, then `capture` both intermediate and resulting states. Evidence belongs in the run directory. Every listed entry point needs its own proof before claiming the entire feature verified; the helper covers the subsets stated below, plus the login/import checks in the skill entry point.

- [Navigation and resume](navigation.md): course cards, topic list, resume, pending lessons, legacy links. Helper covers cards, topic list, persisted resume and pending return; other entries remain unverified.
- [Search and progress](progress.md): topic search, review filter, completion gap.
- [Practice labs](practice.md): Practice tab and article links, local tokenization and retained results.
- [Audio and reading](audio.md): playback, speed, seek and word controls.
- [Settings and appearance](settings.md): theme, provider-key save and cancellation.

Report failures with action, expected outcome and missing precondition. Never mark a skipped path as covered by another. No paid provider call is part of the baseline. Native local Node/Chrome is the target, not a container stand-in.
