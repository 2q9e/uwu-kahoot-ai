<div align="center">

# UwU Kahoot AI

**A local-first AI companion for Kahoot · Bring your own API keys**

![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4f46e5?style=flat-square&logo=googlechrome&logoColor=white)
![MIT License](https://img.shields.io/badge/License-MIT-14b8a6?style=flat-square)

</div>

---

This project started from **KahootAI** as its base and has been substantially reworked, including broader provider support, multi-key management, model selection, fallback routing, and improvements to question and tab handling.

## Features

- Supports multiple choice, true/false, multi-select, image and pin, jumble, slider, and open-ended questions.
- Connects to **Google AI Studio (Gemini)**, **OpenRouter**, and **OpenAI**.
- Manages multiple API keys and model backups per provider.
- Includes a live model catalog, streamed speed checks, a dashboard, and a dedicated stats page.
- Keeps API keys and answer history in the local browser profile.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked** and choose this folder.
4. Open the extension settings and add your provider API key.

To rebuild the page bridge, run `npm run build`. The project has no npm dependencies.

> UwU Kahoot AI is an independent project and is not affiliated with Kahoot! ASA. AI-generated answers can be incorrect. See [LICENSE](LICENSE).
