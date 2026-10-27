# Settings and appearance

Learners choose a theme and save a provider key shared by labs.

## Sub-features

- `theme`: page and iframe theme, persisted after reload.
- `key-save`: isolated key file, redacted response, cleared field and refreshed labs.
- `cancel`: close without saving.

## How to get to it (user POV)

Use the header theme toggle or API settings button. Choose a provider, enter a key, and Save shared key; Close cancels.

## Driving it with Playwright

Preconditions: helper-owned temporary `MEX_ENV_FILE` and browser; never the user's server. Use only the synthetic value `synthetic-browser-test-key`, not a real secret. Do not run paid labs afterward.

- **Theme.** Open Tokenization Practice, click `#theme-toggle`; require `html[data-theme="light"]` in the page and tokenization iframe. Reload; require light theme again. Repeat for dark.
- **Cancel.** Click `#settings`, fill `#api-key`, click `#close-config`; require the dialog closed and no env-file write.
- **Save.** Reopen settings; `await page.locator('#provider').selectOption('openai')`; fill `#api-key` with the synthetic value. Register `page.waitForResponse(r => r.url().endsWith('/study-api/settings'))` before clicking `#key-form button[type=submit]`. Require 200 and exactly `{ok:true}`, blank input and `#config-status` containing `Saved.`. Repeat in a fresh run with `openrouter` to cover that choice.
- **Side effects.** Read `join(scratch, '.env')` and its file mode with Node fs; require the selected key name/value and mode 0600. Do not copy file contents into artifacts. Require no synthetic key in localStorage. Close the dialog, return to the previously edited tokenization lab and require its default text, proving reset through the UI.

## Gotchas

Saving does not validate a key or make a billed model request. A synthetic key cannot prove provider authentication. `doctor` requires no configured keys, so run it before saving; a later no-key doctor failure is expected after this journey. Retain redacted observations and synthetic-only traces; cleanup removes the temporary file. Both theme choices and provider options need separate actions for full coverage.
