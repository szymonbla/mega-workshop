# Search and progress

Learners filter the topic list and see saved completion and review counts.

## Sub-features

- `search`: matching, empty and cleared query.
- `review`: review-only list and return to all topics.
- `completion`: Complete lesson marks every learning topic done.

## How to get to it (user POV)

Open S01E01 and use Find a topic or Review in the sidebar. Complete lesson appears below the progress counter and marks all topics in the current lesson done. It becomes disabled with the label Lesson completed.

## Driving it with Playwright

Preconditions: fresh browser at `base + '#/lesson/s01e01/tokenization'`.

- **Search.** `await page.locator('#search').fill('Tokenization')`; require one `#chapters button` containing Tokenization. Fill `no-such-topic-987`; require `#chapters` text `No results.`. Fill an empty string; require the topic list to return.
- **Review.** Click `#review`; require `No topics to review.` on empty storage. Click again; require the full list.
- **Completion.** Click `#complete-lesson`; require 24 of 24 topics completed and a disabled button. Reload and verify the count and stored status persist. Return through `#back-course`; require Completed on S01E01 and 1 / 20 lessons completed. The helper covers this journey.

## Gotchas

Individual topic marking and creating review flags still have no UI controls. Whole-lesson completion clears existing review flags for its topics. Reference sections do not count toward 24 topics. Search and Review filters combine, so clear search before testing Review alone.
