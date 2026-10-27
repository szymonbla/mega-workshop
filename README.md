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

The app remembers your connection in `.study-data/.mega-study/` (or under `STUDY_DATA_HOME` if configured). It saves MEGA cookies privately, including session cookies, and restores the local app session when you reopen it. Disconnecting removes the saved login. MEGA may still require you to sign in again when its session expires or is revoked.

Keep the server running while lessons are being prepared. Closing the import panel does not stop the queue. A failed lesson does not block the others; an expired session requires signing in again.

## Quick start

You need Node.js 24 or later.

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

The app uses TypeScript 7.0.2 with its native Go compiler for strict type checking, native Node.js execution on the server, and esbuild for browser modules. `npm run typecheck` invokes the native compiler through `tsc --noEmit`; npm installs the platform binary, so a separate Go installation is not required. Biome formats and checks the TypeScript code. The structure follows the small, explicit modules used in [Limen](https://github.com/overment/limen/tree/main/src).

- `src/server/`: HTTP server, course catalog, imports, audio and exercise workers.
- `src/client/`: browser UI, navigation, progress and audio playback.
- `src/shared/`: shared domain and API types.
- `public/`: HTML and CSS sources.
- `test/`: unit and integration tests, fixtures and browser regressions.
- `scripts/`: build, development runner, content audit and Python audio alignment tools.
- `dist/public/`: generated browser assets, excluded from Git.

`npm start` builds browser assets and starts the server. `npm run dev` rebuilds frontend modules and static assets when edited and restarts the server on server changes; reload the browser to see frontend changes. `npm run build` only generates browser assets. Node executes server `.ts` files directly, so there is no separate server compilation step.

To run the checks:

```sh
npm run check
npm run test:audio
```

Use `npm run format` to format code, `npm run lint` for Biome checks, and `npm run typecheck` for TypeScript checking. Python remains necessary only for the MLX/stable-ts audio integration.

GitHub Actions runs these checks on pushes and pull requests. Tests use synthetic course data.

The content audit checks tracked files and files that could be added to Git. It rejects private data paths, media, archives, binaries, and symlinks in the files to be published. Review text changes too: the audit cannot tell where every sentence came from.

Full browser verification requires a local library with the first two lessons and the exercise installation:

```sh
BROWSER_CHANNEL=chrome npm run verify
```

See the [browser verification instructions](.agents/skills/verify/SKILL.md) for details. This check uses an isolated session, makes no paid model calls, and saves its output under `.study-data/.audit/`.

Existing `.study-data/` files and browser storage keys need no migration. Set `STUDY_DATA_HOME` to an existing data directory when verifying from a separate worktree.
