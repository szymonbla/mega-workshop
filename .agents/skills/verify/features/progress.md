# Search and progress

Learners filter the topic list and see saved completion and review counts.

## Sub-features

- `search`: matching, empty and cleared query.
- `review`: review-only list and return to all topics.
- `completion`: Complete lesson marks every learning topic done. Mark topic complete saves the current topic and advances to the next section in reading order; Undo stays on the current topic. Completing all topics in a chapter triggers small confetti; completing the lesson triggers large confetti. Reduced-motion preferences disable confetti.

## How to get to it (user POV)

Open S01E01 and use Find a topic or Review in the sidebar. Complete lesson appears below the progress counter and marks all topics in the current lesson done. It becomes disabled with the label Lesson completed.

## Driving it with Playwright

Preconditions: fresh browser at `base + '#/lesson/s01e01/tokenization'`.

- **Search.** `await page.locator('#search').fill('Tokenization')`; require one `#chapters button` containing Tokenization. Fill `no-such-topic-987`; require `#chapters` text `No results.`. Fill an empty string; require the topic list to return.
- **Review.** Click `#review`; require `No topics to review.` on empty storage. Click again; require the full list.
- **Topic completion.** Click `#complete-topic` beside the topic title; require 1 of 24 topics completed and the next section. Reload to verify the new reading position, return to Tokenization, require `aria-pressed="true"`, and click again to undo. Reload again and require 0 of 24. After completing the whole lesson, undo one topic and require 23 of 24 and the whole-lesson button enabled. The helper covers these actions and completes a chapter with real topic clicks to check small confetti, then checks large confetti through both lesson completion paths.
- **Completion.** Click `#complete-lesson`; require 24 of 24 topics completed and a disabled button. Reload and verify the count and stored status persist. Return through `#back-course`; require Completed on S01E01 and 1 / 20 lessons completed. The helper covers this journey.

## Gotchas

Topic completion is reversible, including for legacy progress. Creating review flags still has no UI control. Whole-lesson completion clears existing review flags for its topics. Reference sections do not count toward 24 topics. Search and Review filters combine, so clear search before testing Review alone.
