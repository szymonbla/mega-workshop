# Search and progress

Learners filter the topic list and see saved completion and review counts.

## Sub-features

- `search`: matching, empty and cleared query.
- `review`: review-only list and return to all topics.
- `completion`: mark understood or revisit; currently blocked at the UI.

## How to get to it (user POV)

Open S01E01 and use Find a topic or Review in the sidebar. README describes completion actions beneath the lesson, but the current UI does not render them.

## Driving it with Playwright

Preconditions: fresh browser at `base + '#/lesson/s01e01/tokenization'`.

- **Search.** `await page.locator('#search').fill('Tokenization')`; require one `#chapters button` containing Tokenization. Fill `no-such-topic-987`; require `#chapters` text `No results.`. Fill an empty string; require the topic list to return.
- **Review.** Click `#review`; require `No topics to review.` on empty storage. Click again; require the full list.
- **Completion.** Attempt to find the README's understood/revisit controls beneath the lesson. Report failure if absent. Do not call `progress.mark` or inject status keys to pass. With working controls in a future change, click a status, reload, check the counter and stored value, then use Review to prove revisit filtering.

## Gotchas

There is no real UI path to create completion/review state in the inspected version. Populated review and completion journeys are blocked; the existing regression's seeded storage is not proof of these actions. Reference sections do not count toward 24 topics. Search and Review filters combine, so clear search before testing Review alone.
