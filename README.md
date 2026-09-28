<div align="center">

# UwU Kahoot AI

### A local-first AI companion for live Kahoot questions

![Chrome extension](https://img.shields.io/badge/Chrome-Manifest%20V3-4f46e5?style=for-the-badge&logo=googlechrome&logoColor=white)
![Gemini](https://img.shields.io/badge/Google%20AI%20Studio-Gemini-4285F4?style=for-the-badge&logo=googlegemini&logoColor=white)
![OpenRouter](https://img.shields.io/badge/OpenRouter-Multi--model-7c3aed?style=for-the-badge)
![MIT](https://img.shields.io/badge/License-MIT-14b8a6?style=for-the-badge)

**Bring your own API keys · Multiple provider keys · Local AI-answer history · No hosted AI backend**

</div>

---

## This is UwU Kahoot AI :)

UwU Kahoot AI reads question data from the selected Kahoot player tab and sends it to the provider you configure. Answers come back to the extension, which can highlight a suggestion or use the answer controls you enable.

This project began from KahootAI as a base and has since been substantially reworked, including broader provider support, multi-key management, model selection, fallback routing, and improvements to question and tab handling.

The game host must have **Show questions & answers on players' devices** enabled for the player page to receive question text. When that setting is off, the extension cannot recover the hidden question from the player tab.

- 🎮 Handles the common live question formats, including image questions.
- 🗂️ Connects to multiple open Kahoot tabs; choose which tab's live state the popup displays.
- 🧠 Connects to Google AI Studio, OpenRouter, or OpenAI.
- ⚡ Can route exact True/False choice pairs through a strict, low-reasoning fast model, then retry with the primary model if the fast reply is malformed or fails.
- 🔁 Can try configured backup keys and models when a request is rate-limited or fails.
- 📊 Keeps local AI-answer counts, response-time averages, and recent question history; it cannot tell whether Kahoot marked an answer correct.
- 🎛️ Offers a compact popup, a full dashboard, and Classic or 3D scroll views.
- 🔐 Stores keys in this browser profile's extension storage; there is no project AI server.

> Question access depends on the host's Kahoot settings and the active player page. Answers from AI can be wrong; review suggestions before enabling automatic actions.

## Where it works

| Area | What it does |
| --- | --- |
| Multiple choice and true/false | Matches a model answer against the choices on the player page. |
| Multiple select | Checks each choice and selects the matching set. |
| Pin and image questions | Sends question images to a configured vision model and can show or place a suggested point. |
| Jumble | Computes a tile order and can update the player controls. |
| Slider | Fits the suggested value to the page's range and step. |
| Open-ended | Trims the suggestion to the input limit and can enter it into the page. |

## My perfect stack

- **Extension:** Chrome Manifest V3, JavaScript modules, browser storage.
- **AI providers:** Google AI Studio (Gemini), OpenRouter, and OpenAI.
- **Resilience:** Ordered key/model backups, request timeouts, and provider-aware retry handling.
- **Interface:** Popup settings, a full-page dashboard, a dedicated stats page, and reduced-motion-aware animations.
- **Build:** Node's built-in tooling; no package dependencies are required.

## Signals

The **Stats** page records AI answers returned to the extension, average and total model response time, and recently answered questions. These counts do not confirm that an answer was submitted or marked correct by Kahoot. Response time covers the AI request, including any provider fallback attempts; it excludes Kahoot page loading and configured answer delay. Stats stay in this browser's extension storage.

The model catalog shows the provider-reported details it can retrieve. Gemini speed is an estimate when the API does not return token counts. The extension cannot read Google's project-wide remaining quota; its Gemini panel shows this extension's local request counts and links to the provider's live quota page.

## Things it does

### Install

1. Extract the extension folder somewhere you plan to keep it.
2. Open Chrome's Extensions page and turn on **Developer mode**.
3. Choose **Load unpacked** and select the folder that contains `manifest.json`.
4. Open UwU Kahoot AI, choose a provider, add its API key, and save.
5. Open a Kahoot player tab to see its live session status.

### Configure provider keys and backups

Open **API Configuration** in the popup or dashboard. Add a key for each provider you want available, choose the provider/model order, and enable fallback as desired. Keys are saved locally in the current browser profile and are sent only to the provider selected for a request or fallback attempt.

The **Fast True/False lane** is enabled by default and can be turned off. It only applies when the player page exposes exactly the `True` and `False` choices and no image is needed. Automatic OpenRouter routing uses the fastest free model in its cached throughput catalog; Google AI Studio uses the quickest previously measured model, or Gemini 3.5 Flash-Lite before a speed check. A reply must be only `TRUE` or `FALSE`; otherwise the configured primary model answers normally. Choose a provider-specific override from the live model catalog when you want a different fast model.

Use the provider's own usage page to check current pricing and limits. A model appearing in the catalog does not guarantee that the model or your API key is free.

### Choose how answers appear

The dashboard lets you control answer highlighting, automatic clicks, pin placement, answer delay, and Silent mode. Silent mode hides extension badges, highlights, and delay countdowns while keeping the configured answer actions active.

## Numbers matter? ohhh yes.

The dashboard's live card shows the active question state. The dedicated Stats page gives the longer view: how many AI answers were generated, how long the AI took on average, and which questions received answers most recently. These measurements are stored on-device and are not uploaded as analytics.

## Project map

- `pages/` — popup, dashboard, and stats documents.
- `scripts/ai/` — question prompts, response parsing, provider settings, and request transport.
- `scripts/background/` — extension service worker and message routing.
- `scripts/content/` — Kahoot page controller, answer actions, feedback UI, and DOM helpers.
- `scripts/content/page-bridge/` — focused page-context bridge source modules; `npm run build` bundles them into the single classic script injected before Kahoot opens its WebSocket.
- `scripts/core/` — provider storage, key management, matching, model catalogs, routing, and usage accounting.
- `scripts/popup/` — popup orchestration, live-session UI, key manager, catalog, quota panel, and stats summary.
- `scripts/dashboard/` and `scripts/stats/` — page-specific controllers.
- `styles/` and `tools/` — extension styles, syntax checks, and the bridge build tool.

## Build and check

This extension uses Node's built-in tooling and has no package dependencies.

```sh
npm run build
npm run check
```

`npm run check` checks JavaScript syntax and verifies that the generated page bridge matches its source modules.

## Privacy and license

Question text and, when needed, a question image are sent directly to the configured AI provider. If fallback is enabled, a failed request can be sent to another configured provider. Each provider's privacy terms, pricing, and rate limits apply. The extension does not run a hosted AI backend or analytics service.

Do not share your browser profile or an unpacked extension folder with anyone who should not have access to your saved API keys. The project is not affiliated with Kahoot! Inc. See [`LICENSE`](LICENSE) for license terms and required notices.
