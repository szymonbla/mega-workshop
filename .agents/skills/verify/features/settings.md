# Settings and appearance

Learners choose a theme and save a provider key shared by labs.

## Sub-features

- `theme`: page and iframe theme, persisted after reload.
- `key-save`: isolated key file, redacted response, cleared field and refreshed labs.
- `saved-key`: persistent per-provider status; adding is locked until Change key is selected.
- `cancel`: close without saving.

## How to get to it (user POV)

Use the header theme toggle or API settings button. Choose a provider, enter a key, and Verify and save key; Close cancels.

## Driving it with Playwright

Preconditions: helper-owned temporary `MEX_ENV_FILE` and browser; never the user's server. Use only the synthetic value `synthetic-browser-test-key`, not a real secret. Do not run paid labs afterward.

- **Theme.** Open Tokenization Practice, click `#theme-toggle`; require `html[data-theme="light"]` in the page and tokenization iframe. Reload; require light theme again. Repeat for dark.
- **Cancel.** Click `#settings`, fill `#api-key`, click `#close-config`; require the dialog closed and no env-file write.
- **Save.** Reopen settings; `await page.locator('#provider').selectOption('openai')`; fill `#api-key` with the synthetic value. Register `page.waitForResponse(r => r.url().endsWith('/study-api/settings'))` before clicking `#key-form button[type=submit]`. Require 200 and exactly `{ok:true}`, blank input and `#config-status` containing `Saved.`. Repeat in a fresh run with `openrouter` to cover that choice.
- **Saved and replacement.** After saving, require `#provider-key-status` to show the provider key is saved, `#key-entry` hidden and its submit button disabled. Reopen settings and reload: the saved state must persist. Switch providers to check independent states. Click `#replace-key` to reveal the empty replacement field; `#cancel-key-change` must clear it and restore the locked state without changing the env file. A rejected replacement must preserve the old key.
- **Side effects.** Read `join(scratch, '.env')` and its file mode with Node fs; require the selected key name/value and mode 0600. Do not copy file contents into artifacts. Require no synthetic key in localStorage. Close the dialog, return to the previously edited tokenization lab and require its default text, proving reset through the UI.

## Gotchas

Saving verifies authentication with OpenAI `/v1/models` or OpenRouter `/api/v1/key` before writing. The verification server substitutes these external requests with `syntheticProviderFetch`; only `synthetic-browser-test-key` succeeds. Other synthetic keys return 401. Verify rejection preserves the previous env file and permits retry. No model generation request is made. A synthetic key cannot prove provider authentication. `doctor` requires no configured keys, so run it before saving; a later no-key doctor failure is expected after this journey. Retain redacted observations and synthetic-only traces; cleanup removes the temporary file. Both theme choices and provider options need separate actions for full coverage.
