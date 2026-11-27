# Devpost submission draft — #BuildHybridAI 2026

**Project name:** Flow Coach

**Tagline (≤ 200 chars):** Private, instant feedback for English test takers: Gemini Nano marks every answer on-device, cloud Gemini finds the weakness costing you the most points.

**Platform:** Web (Chrome)

**Links**
- Live demo: https://flow-coach-hybrid.web.app
- Code (Apache-2.0): https://github.com/tomcandev/flow-coach
- Video: (YouTube link after upload)

---

## Inspiration

I build a PTE study app and talk with learners every week: international students, nurses, engineers and skilled migrants, many of them in Australia. Their score often decides a visa, a registration or a job. In the dictation task they mostly lose points in the same small places: a missing `-s`, a dropped `the`, a long word spelled almost right. What helps is feedback after every single sentence, but that means hundreds of AI calls per study session. In the cloud that is slow, it costs money for a free study tool, and it sends people's writing to a server. Hybrid inference fixes all three.

## What it does

Flow Coach is a practice app for Write From Dictation and short writing.

- **Dictation:** listen (up to 3 plays, speed control), type, press Enter. A deterministic marker scores word by word, the way the real test does, and puts every lost point into one of 4 categories: word endings, spelling, small words, missed words. Gemini then explains each mistake and gives one tip. A badge shows where it ran (`On-device · Gemini Nano · 420 ms` or `Cloud · Gemini · 1.8 s`).
- **Short writing:** 12 short tasks. Gemini returns the exact phrases to fix, the correction and a tip; the phrases are highlighted in the learner's text. With Gemini Nano the text never leaves the device.
- **Coach & Flow:** a dashboard shows which category costs the most points. *Get my coach report* sends the mistake history (counts and examples only) to cloud Gemini, which explains the pattern and writes rules and a plan. *Start Flow* closes the loop: train that weakness on 3 matched sentences, re-test on 3 new sentences, and see the before and after.
- **Offline:** marking, history (Firestore offline cache) and, with Gemini Nano, the AI tips keep working without a network.

All 48 dictation sentences and 12 writing tasks are original.

## How we built it

- **Firebase AI Logic, hybrid:** `getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE, onDeviceParams, inCloudParams })` with the Gemini Developer API backend. Gemini Nano runs through Chrome's Prompt API; if it is unavailable the SDK falls back to `gemini-3.5-flash-lite`. We ask both engines for the same JSON shape (`responseConstraint` on-device, `responseSchema` in the cloud), so the UI does not care which one answered, and we read `response.inferenceSource` to show it.
- **Model lifecycle:** `initializeDeviceModel()` runs from a click when Chrome reports the model as downloadable, and a tiny warm-up prompt loads Gemini Nano while the sentence is playing, so the tip is ready when the learner presses Enter.
- **Cloud coach:** a separate cloud model call with a system instruction and a typed schema (weakness enum, rules, plan). The model name comes from **Remote Config**, with a timeout and fallback to the light model.
- **Deterministic marking:** an LCS alignment scores words like the test, accepts British and American spelling, ignores extra words and classifies each lost point. AI explains; code decides the score. 6 unit tests cover it.
- **Firebase:** App Check with reCAPTCHA Enterprise (enforced for AI Logic and Firestore), Anonymous Auth, Cloud Firestore with persistent local cache and per-user security rules, Remote Config, Hosting. The project was set up end to end from the Firebase CLI.
- **Front end:** TypeScript and Vite, no framework, browser speech synthesis for audio.

## Challenges we ran into

- **Judging where the score should come from.** Letting an LLM count correct words gives different answers on each run. We moved scoring into deterministic code and let Gemini do what it is good at: explaining why.
- **Same output from two very different models.** Gemini Nano and cloud Gemini needed matching JSON schemas and prompts short enough for the small model.
- **First-call latency on-device.** Loading Gemini Nano into memory takes seconds the first time, so we warm it up during audio playback.
- **Hardware variety.** Gemini Nano needs enough disk space and memory; on a machine short of disk Chrome reports it as unavailable. The hybrid mode made this invisible to the learner: the same feature silently used the cloud.
- **Free-tier latency on larger cloud models.** We added a timeout and a fallback to the light model, configurable in Remote Config.

## Accomplishments that we're proud of

- A complete product loop, not a demo prompt: practise → exact mark → AI explanation → find the costliest weakness → train → re-test.
- The learner always sees where the AI ran and how long it took.
- It still works offline and degrades gracefully on any browser.
- 100% original content and a public, Apache-2.0 codebase anyone can run on their own Firebase project.

## What we learned

- Hybrid AI is a product decision, not just a technical one: the high-frequency, privacy-sensitive calls belong on-device; the rare, whole-history reasoning belongs in the cloud.
- Structured output (`responseConstraint` / `responseSchema`) is what makes a small on-device model dependable inside a UI.
- Pairing deterministic logic with generative AI gives learners scores they can trust and explanations they can use.

## What's next

- Speaking practice with on-device audio input (the Prompt API accepts audio).
- More task types (Reading fill-in-the-blanks, Summarise Written Text) and an IELTS mode.
- Android and iOS clients with Firebase AI Logic hybrid inference.
- A teacher view for tutors who support many students.

## Built with

firebase-ai-logic, gemini-nano, gemini, chrome-built-in-ai, prompt-api, firebase, firebase-app-check, recaptcha-enterprise, firebase-authentication, cloud-firestore, firebase-remote-config, firebase-hosting, typescript, vite, web-speech-api

## Testing instructions for judges

1. Open https://flow-coach-hybrid.web.app in desktop Chrome. No sign-in needed (anonymous).
2. The header shows the engine status. *Gemini Nano ready* means feedback runs on-device. If it says *Gemini Nano: download*, click it once to download the model. If it says *On-device unavailable*, everything still works through the cloud fallback.
3. **Dictation:** press Play (or Ctrl+Space), type the sentence with a small mistake (for example drop an `-s`), press Enter. See the word-by-word mark, then the AI notes and the badge showing on-device or cloud and the time.
4. Switch the header mode between *Prefer on-device*, *On-device only* and *Cloud only* to compare.
5. **Offline test:** in DevTools → Network choose *Offline* and answer another sentence. The mark still works; with Gemini Nano the tip works too.
6. **Short writing:** write 30–70 words with a few errors and press *Check my writing*.
7. **Coach & Flow:** after 3 or more exercises, press *Get my coach report*, then *Start Flow* and complete the 6 sentences to see the before and after.

Gemini Nano requirements: Chrome with the built-in Prompt API (tested on Chrome 158, macOS), about 22 GB free disk space and 16 GB RAM or a GPU with more than 4 GB VRAM. On older Chrome enable `chrome://flags/#prompt-api-for-gemini-nano` and `chrome://flags/#optimization-guide-on-device-model`. Model status: `chrome://on-device-internals`.

## Built during the hackathon period

Everything in the repository was created from scratch between 26 and 30 November 2026: the app, the marking engine, all practice content and the Firebase project. No code from other projects was reused. The idea comes from my existing private PTE app (PTE Flow), but none of its code or content is in this repository. Open-source dependencies: Firebase JS SDK, Vite, TypeScript, playwright-core (demo recording only).

---

## YouTube upload draft

**Title:** Flow Coach – Hybrid AI English test coach with Gemini Nano + Firebase AI Logic | #BuildHybridAI

**Description:**

Flow Coach gives English test takers instant, private feedback on every answer. Gemini Nano runs on-device in Chrome through Firebase AI Logic hybrid inference, and the SDK falls back to cloud Gemini when on-device AI is not available. A cloud Gemini coach then finds the weakness costing the most points and runs a train-and-re-test Flow.

Live demo: https://flow-coach-hybrid.web.app
Code (Apache-2.0): https://github.com/tomcandev/flow-coach

Built with Firebase AI Logic (InferenceMode.PREFER_ON_DEVICE), Gemini Nano (Chrome Prompt API), Gemini 3.5 Flash-Lite, App Check (reCAPTCHA Enterprise), Firebase Authentication, Cloud Firestore, Remote Config and Firebase Hosting.

Built for the #BuildHybridAI 2026 hackathon.

#BuildHybridAI #Firebase #Gemini #GeminiNano #ChromeAI

**Visibility:** Public · **Category:** Science & Technology · **Language:** English · **Not made for kids**
