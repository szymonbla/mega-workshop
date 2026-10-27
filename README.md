# MEGA Workshop

A local study app for people learning with MEGA.dev. Read lessons, listen to audio, take notes, track your progress, and open exercises in one place.

This repository contains the app and synthetic test data. It does not include course materials. You need your own MEGA account with access to the lessons you want to import.

## Why this exists

Working through a course often means switching between lesson pages, recordings, notes, and exercises. It is easy to lose your place or spend time finding the right part of a lesson.

MEGA Workshop brings those activities together. You can read a section, listen while following the text, try an exercise, and return to where you left off. The aim is simple: spend less time managing learning materials and more time learning.

The app runs on your computer and keeps imported materials there. It is intended for personal study with your own course access.

## What you can do

- Browse lessons and move between sections.
- Read lesson text alongside its illustrations.
- Listen to lesson audio with text highlighting and section playback.
- Keep notes and track completed sections.
- Open practical exercises from the lesson.
- Connect your MEGA account and import the lessons available to you.

After you connect your account, the app checks the course catalog and downloads available lessons in the background. It skips completed imports and can resume unfinished ones. You can also use **Check for new lessons / retry downloads** to check again.

Keep the server running while lessons are being prepared. Closing the import panel does not stop the queue. A failed lesson does not block the others; an expired session requires signing in again.

## Quick start

You need Node.js 22.18 or later.

```sh
git clone https://github.com/szymonbla/mega-workshop.git
cd mega-workshop
npm run setup
npm start
```

Open http://localhost:4830 in your browser. To use another port, run `PORT=4831 npm start`.

A fresh installation starts with an empty library. To import your lessons, complete the setup below, then click **Connect MEGA** in the app and sign in with your own account.

## Set up lesson imports

Running the empty app only requires Node.js. Importing and preparing lessons also requires Chromium, `ffmpeg` on your PATH, and a Python environment for audio alignment:

```sh
npm run setup:import
python3 -m venv .audio-venv
.audio-venv/bin/python -m pip install stable-ts mlx-whisper
```

Install `ffmpeg` separately using your system's package manager.

The current audio alignment tool uses MLX and is designed for macOS with Apple Silicon. Audio import on Windows and Linux has not been verified and needs a different transcription backend. Starting the app does not require this audio setup.

Some exercises use an AI provider. Add your own key through **API settings** when needed. Provider usage is billed to your account. The reader itself does not require an API key.

## Where your data lives

Imported lessons, images, audio, transcripts, login sessions, browser profiles, and downloaded exercises are stored under `.study-data/`. Git ignores this directory. Internal data paths and browser storage keys keep their original names so existing sessions, notes, and progress still work after the rename to MEGA Workshop.

| Location | Contents |
| --- | --- |
| `.study-data/study/` | Imported lessons, images, audio, and alignment files |
| `.study-data/.mega-study/` | Login session, browser profile, import state, and downloaded exercises |
| `.study-data/course-examples/` | Optional installation of earlier exercises |
| `.study-data/.audit/` | Local browser verification screenshots and traces |
| `.env` | API keys; also ignored by Git |
| Browser local storage | Notes and learning progress |

Set `STUDY_DATA_HOME` to store imported data outside the project. Within the project, learning data must stay under `.study-data/`. Notes and progress belong to the browser you use; clearing its local storage removes them.

Share the code through Git or an archive made with `git archive`. A ZIP of the whole working folder may also contain your private lessons and session files. Each person should install the app and connect their own account.

## Development and checks

The app uses a Node.js server and plain browser JavaScript. To run the checks:

```sh
npm test
npm run audit:content
python3 -m unittest discover -s study -p 'test_*.py'
```

GitHub Actions runs these checks on pushes and pull requests. Tests use synthetic course data.

The content audit checks tracked files and files that could be added to Git. It rejects private data paths, media, archives, binaries, and symlinks in the files to be published. Review text changes too: the audit cannot tell where every sentence came from.

Full browser verification requires a local library with the first two lessons and the exercise installation:

```sh
BROWSER_CHANNEL=chrome .agents/skills/verify/scripts/verify.mjs
```

See the [browser verification instructions](.agents/skills/verify/SKILL.md) for details. This check uses an isolated session, makes no paid model calls, and saves its output under `.study-data/.audit/`.
