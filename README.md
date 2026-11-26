# Flow Coach

**Hybrid AI practice for English test takers.** Instant, private feedback runs on-device with **Gemini Nano in Chrome**; deeper coaching runs on **cloud Gemini**. Both go through **Firebase AI Logic**.

Live demo: **https://flow-coach-hybrid.web.app** (Chrome on desktop)

Built for Google's [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/) hackathon. Platform: Web (Chrome).

---

## Why

Millions of people sit English tests (PTE, IELTS) every year: international students, nurses, engineers, skilled migrants. In dictation tasks most of them lose points in the same few places: a dropped `-s`, a missing `the`, a misspelled long word. They need feedback after **every** sentence, which means hundreds of AI calls per study session. Sending each one to the cloud is slow, costs money and sends the learner's writing off the device.

Flow Coach splits the work:

| Job | Where it runs | Why |
| --- | --- | --- |
| Word-by-word mark | Deterministic code in the browser | Exact, instant, explainable. Every lost point gets a category. |
| Instant tip after every answer | **Gemini Nano on-device** (hybrid, falls back to cloud) | Fast, private, free per call, works offline |
| Short writing check | **Gemini Nano on-device** (hybrid, falls back to cloud) | The learner's own writing stays on the device |
| Coach report and Flow plan | **Cloud Gemini** | Reasons over the whole mistake history, once per session |

## What it does

1. **Dictation (Write From Dictation style).** Listen to a sentence (browser speech synthesis, up to 3 plays), type it, press Enter. You get an exact word-by-word mark, and each lost point is put into one of 4 categories: word endings, spelling, small words (articles, prepositions), missed words. Gemini then explains each mistake and gives one tip. A badge shows where the feedback came from, for example `On-device · Gemini Nano · 420 ms` or `Cloud · Gemini · 1.8 s`.
2. **Short writing.** 12 short tasks (30–70 words). Gemini returns the exact phrases to fix, the corrections and one tip. The phrases are highlighted in your text.
3. **Coach & Flow.** The dashboard shows which category costs you the most points. **Get my coach report** sends your mistake history (counts and examples, no personal data) to cloud Gemini, which explains the pattern, gives 3 rules and a plan. **Start Flow** runs the loop: train that weakness on 3 matched sentences, then re-test on 3 new sentences, and compare before and after.

History is saved per anonymous user in Firestore, with offline persistence, so practice keeps working without a network and syncs later.

## How Firebase AI Logic is used

All AI calls use the Firebase JS SDK `firebase/ai` (v13.4.0) with the **Gemini Developer API** backend. See [`src/ai.ts`](src/ai.ts).

**Hybrid model (on-device first)** — [`src/ai.ts`, `hybridModel()`](src/ai.ts):

```ts
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'firebase/ai';

const ai = getAI(app, { backend: new GoogleAIBackend() });
const model = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,           // Gemini Nano if Chrome has it, otherwise cloud
  onDeviceParams: {
    createOptions: { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [...] },
    promptOptions: { responseConstraint: tipJsonSchema },   // structured JSON from Gemini Nano
  },
  inCloudParams: {
    model: rcString('hybrid_cloud_model'),         // from Remote Config, default gemini-3.5-flash-lite
    generationConfig: { responseMimeType: 'application/json', responseSchema: tipCloudSchema },
  },
});
const res = await model.generateContent(prompt);
res.response.inferenceSource;                      // 'on_device' | 'in_cloud' -> shown in the UI
```

- The same JSON shape is requested from both engines (`responseConstraint` on-device, `responseSchema` in the cloud), so the UI code does not care which one answered.
- `initializeDeviceModel()` is called from a user click to download Gemini Nano when Chrome reports it as `downloadable` (click the status pill).
- While the sentence is playing, a tiny warm-up prompt loads Gemini Nano into memory, so the tip is ready by the time the learner presses Enter (`warmUp()` in `src/ai.ts`).
- A mode switch in the header lets you compare **Prefer on-device**, **On-device only** and **Cloud only** live.

**Cloud model** — `coachReport()` in [`src/ai.ts`](src/ai.ts) uses `getGenerativeModel(ai, { model, systemInstruction, generationConfig: { responseSchema } })` with a typed schema (headline, weakness enum, why, rules, plan). If the configured coach model is slow, it falls back to the light model after 25 s.

**Other Firebase products** — [`src/firebase.ts`](src/firebase.ts):

- **App Check** with reCAPTCHA Enterprise, initialised before any other service. Enforcement is **on** for Firebase AI Logic and Cloud Firestore.
- **Authentication** (anonymous) so each learner has a private history.
- **Cloud Firestore** with persistent local cache (offline-first). Rules in [`firestore.rules`](firestore.rules): a user can only read and write `users/{their uid}/**`.
- **Remote Config** (`remoteconfig.template.json`) chooses the cloud models, so we can change models without a new build.
- **Firebase Hosting** serves the demo.

## Running Gemini Nano in Chrome

- Desktop Chrome with the built-in Prompt API (tested on Chrome 158 on macOS). On older Chrome versions enable `chrome://flags/#prompt-api-for-gemini-nano` and `chrome://flags/#optimization-guide-on-device-model`.
- Chrome's hardware requirements apply: about **22 GB free disk space** on the profile's drive, and a GPU with more than 4 GB VRAM or 16 GB RAM. Chrome removes the model if free space falls too low.
- Check `chrome://on-device-internals` for the model status.
- If Gemini Nano is not available, the header shows *On-device unavailable* and every feature still works through the cloud fallback. Offline without Gemini Nano, the exact word-by-word mark still works and the AI tip is paused.

## Run it locally

```bash
git clone https://github.com/tomcandev/flow-coach.git
cd flow-coach
npm install
npm run dev        # http://localhost:5173
npm test           # marking engine tests
```

The app points at the public demo project `flow-coach-hybrid`. To use your own Firebase project:

1. Create a project, add a Web app and put its config in `src/firebase.ts`.
2. Enable **Firebase AI Logic** with the Gemini Developer API, **Authentication** (Anonymous), **Cloud Firestore**.
3. Create a reCAPTCHA Enterprise key for your domains, register it in **App Check**, and put the site key in `src/firebase.ts`.
4. For local development with App Check enforced, either add `localhost` to the reCAPTCHA key or put a debug token in `.env.local` as `VITE_APPCHECK_DEBUG_TOKEN` (see `.env.example`; never commit it).
5. `firebase deploy --only hosting,firestore,remoteconfig`

The Firebase web config in `src/firebase.ts` is public by design. It identifies the project; access is protected by App Check, Auth and security rules. There are no secrets in this repository.

## Project layout

```
src/ai.ts          Firebase AI Logic: hybrid models, on-device status, coach report
src/firebase.ts    App, App Check, Auth, Firestore, Remote Config
src/scoring.ts     Deterministic word-by-word marker and mistake categories
src/content.ts     48 original dictation sentences, 12 writing tasks
src/main.ts        UI (no framework)
tests/             node:test tests for the marker and content bank
```

## What was built during the hackathon

Everything in this repository was written from scratch between 26 and 30 November 2026 for #BuildHybridAI: the app, the marking engine, the Firebase setup (project `flow-coach-hybrid`), and all practice content.

**Disclosure of pre-existing work:** none of the code is copied from another project. The idea comes from the author's existing PTE study app (PTE Flow, a separate private codebase); no code or content from it is used here. The project was scaffolded with Vite and uses the open-source Firebase JS SDK. All 48 dictation sentences and 12 writing prompts are original and are not taken from any commercial or crawled question bank.

## Licence

[Apache-2.0](LICENSE)

Flow Coach is an independent practice tool. PTE is a trademark of Pearson; IELTS is a trademark of its owners. This project is not affiliated with either.
