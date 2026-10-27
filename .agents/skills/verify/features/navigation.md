# Navigation and resume

Learners browse twenty lessons, open a topic, and return to their last reading position.

## Sub-features

- `course`: four weeks and twenty lesson cards.
- `reader`: available lesson and topic selection.
- `resume`: last topic survives reload.
- `pending`: explicit unavailable materials and return to available lesson.
- `links`: direct and legacy topic URLs.

## How to get to it (user POV)

Open `/` or `/#/course`; select a lesson card, then a topic. Continue learning resumes reading. Header Course overview and reader All 20 lessons both return to the map. Pending lessons offer a back button and Continue available lesson. Direct links include `/#/lesson/s01e01/tokenization` and legacy `/#tokenization`.

## Driving it with Playwright

Preconditions: fresh isolated instance, locally stored, Git-ignored S01E01 content, no stored progress.

- **Course.** `await page.goto(base)`; wait for `[data-course="s01e01"]`, require 20 `[data-course]` buttons. Capture the overview.
- **Reader.** Click `[data-course="s01e01"]`, then `page.locator('#chapters button').filter({hasText: 'Tokenization'})`. Require `#title` to read `Tokenization` and URL to end in `#/lesson/s01e01/tokenization`.
- **Resume.** Click `#back-course`, reload, click `#resume`; require Tokenization again. Read (do not set) localStorage key `mega-study-v2:s01e01:current-section:` and require `step-4`. Helper records this and screenshots.
- **Pending.** Return using `#back-course`, click `[data-course="s02e03"]`; require visible `#pending-lesson`. Click `#pending-continue`; require Tokenization. Separately use `#pending-back` to prove its course return.
- **Other entries.** Open each direct URL above with `page.goto`; require Tokenization and canonical URL. Click `#course-home` and require visible `#course-overview`. Test browser Back after a course transition with `page.goBack()` and require the prior view.

## Gotchas

Materials are never shipped in this repository. Pending is expected, not a locked prerequisite. Resume saves a stable section ID, not a numeric position. Topic changes replace history; do not assume every topic click adds a Back entry. No completion status is created merely by reading.

## Startup and connection feedback

The initial HTML displays an animated startup screen before authentication requests finish. It follows real stages: saved connection, lesson synchronization, then course loading. `test/browser/app.test.ts` holds the status and course responses to verify that the screen stays visible until content is ready; it also checks reduced-motion behavior. A failed request shows connection guidance and Retry connection. Sign-in has an activity indicator while opening the browser or verifying access. Background downloads show the current lesson/step and View progress without blocking ready lessons. These states do not claim real MEGA authentication coverage.
