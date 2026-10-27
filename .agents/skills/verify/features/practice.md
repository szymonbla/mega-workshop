# Practice labs

Learners run local tokenization and retain experiment input when changing topics.

## Sub-features

- `open`: Practice tab and inline article example link.
- `round-trip`: local text tokenization and decoding.
- `retain`: lab state survives topic navigation but resets on reload.

## How to get to it (user POV)

Open Tokenization, then Practice, or click its tokenization example link in Read. Source opens GitHub; it is not the lab entry.

## Driving it with Playwright

Preconditions: isolated instance with course-examples dependencies installed; no key needed.

- **Tab entry.** Open `base + '#tokenization'`, click `#tab-practice`; use `const lab = page.frameLocator('iframe[src="/ui/tokenization-round-trip/"]')`.
- **Round trip.** `await lab.locator('#text').fill('Saved experiment 🌍')`; wait for `lab.locator('#headline-text').filter({hasText: 'Decoding the IDs gives back the same text.'})`. Capture input and output.
- **Retain.** Click the `#chapters button` containing Non-determinism, then Tokenization, then `#tab-practice`. Require `lab.locator('#text').inputValue()` equals the entered string. Reload, open Practice and require the default `Hey, how are you?`.
- **Article entry.** Click `#tab-read`, then `page.locator('#article a[href*="/examples/tokenization-round-trip"]')`; require selected Practice tab and visible lab. Capture this separate entry.

## Gotchas

Practice is hidden on sections without labs. Tokenization is safe without credentials; other experiments may make billed server-side calls. Off-origin browser blocking does not block server-side providers. Do not claim paid-lab behavior verified by this local experiment. Settings saves deliberately reset lab frames.
