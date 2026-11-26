# Decisions

- 2026-11-26 New Firebase project `flow-coach-hybrid` on the Spark plan (no billing). Gemini Developer API backend, because the Agent Platform backend needs Blaze.
- 2026-11-26 Scores come from deterministic code (LCS word alignment), not from the LLM. Gemini explains; code decides. Repeatable scores matter for test prep.
- 2026-11-26 App Check uses reCAPTCHA Enterprise (key created via API, domains: web.app, firebaseapp.com, localhost). Enforced for AI Logic and Firestore.
- 2026-11-26 Coach model default `gemini-3.5-flash-lite`. `gemini-3.5-flash` took 40–120 s or timed out on the free tier during testing. The app tries the Remote Config `coach_model` with a 25 s timeout, then falls back to the light model.
- 2026-11-26 No UI framework (vanilla TypeScript + Vite) to keep the bundle and the code easy to read for judges.
- 2026-11-26 Demo video recorded with a fresh Chrome profile, which has no Gemini Nano, so it shows the cloud fallback path. On-device was verified separately in the author's Chrome 158 (`On-device · Gemini Nano` badge) before low disk space made Chrome mark the model unavailable.
- 2026-11-26 Rotated the browser API key after GitHub flagged it. Old auto-created key deleted (calls now fail with "API key expired"). New key restricted to web.app, firebaseapp.com and localhost referrers and to Identity Toolkit, Token Service, Installations, Firestore, App Check, Remote Config (+ Realtime) and Firebase AI Logic; no Generative Language API. Config now comes from .env.local. Git history was not rewritten: it still holds the old, dead key. Repo made private by Tom.
