# Audio and reading

Learners play a section, seek, change speed, and follow highlighted words.

## Sub-features

- `play`: compact and expanded playback controls.
- `seek`: slider and word-based seeking.
- `preferences`: speed and highlighting survive reload.
- `switch`: changing topic stops the old recording.

## How to get to it (user POV)

Open Tokenization. Play in the compact strip, or expand the player for speed and seek controls. Click a timed word in the article or focus it and press Enter/Space. Following text and Back to audio control scrolling.

## Driving it with Playwright

Preconditions: locally stored, Git-ignored audio and alignment files, Read tab visible, metadata loaded (`Number.isFinite(document.querySelector('audio').duration)`).

- **Compact play.** Click `#audio-mini-play`; use read-only evaluation to require `!audio.paused` and advancing `currentTime`. Click again to pause.
- **Expanded play.** Click `#audio-collapse`, then `#audio-play`; require playback and capture highlighted text. Click Play/Pause again to stop.
- **Speed/seek.** `await page.locator('#audio-speed').selectOption('1.5')`; focus `#audio-seek` and `press('ArrowRight')`; require time to advance. Never set `audio.currentTime` in evaluation to prove seeking.
- **Word seek.** Focus `page.locator('[data-audio-time]').nth(8)`, read its time attribute, and `press('Enter')`; require playback near that time. Repeat via click and Space for those entry points. Pause through the UI.
- **Preferences.** Click `#read-highlight`, reload, and require `aria-pressed="false"` and speed `1.5`. Turn highlighting on again; start playback and require a `.spoken-word` while aligned speech plays.
- **Switch.** While playing, click the Non-determinism topic; require paused audio and new section source. Capture before and after.
- **Follow.** Play aligned text, scroll `.reader` manually until follow pauses, then click `#read-follow` when it reads Back to audio; require Following text and the highlighted sentence in view.

## Gotchas

Word timing is automatic; not every audio instant has a matched word. Missing audio/alignment is a failed precondition, not permission to mock it. A media element advancing proves browser playback, not physical speaker output. Controls hidden by a collapsed player must be expanded first. Also exercise at 390×844 for mobile changes.
