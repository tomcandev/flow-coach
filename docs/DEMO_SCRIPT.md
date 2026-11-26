# Demo video script (≤ 3 min, English)

The video is recorded automatically from the live app with `node scripts/record-demo.mjs`
(system Chrome, Chrome DevTools screencast, system ffmpeg). Captions are drawn on the page,
so the video needs no separate subtitle file. The caption lines double as a voice-over script.

| Time | Screen | Caption / voice-over |
| --- | --- | --- |
| 0:00 | Title card | Flow Coach. Hybrid AI practice for English test takers. Instant, private feedback with Gemini Nano on-device in Chrome. Deeper coaching with cloud Gemini, both through Firebase AI Logic. |
| 0:08 | App header | Millions of students and migrants sit English tests. In dictation, most points are lost to small slips: a missing -s, a dropped "the". |
| 0:13 | Engine pills | The header shows the AI engine. Gemini Nano runs on-device when Chrome has it; otherwise the Firebase AI Logic hybrid SDK falls back to cloud Gemini. |
| 0:19 | Dictation 1 | Write From Dictation: listen, type, press Enter. Marking is deterministic and instant. Every lost point gets a category. |
| 0:35 | AI feedback | Then Gemini explains each mistake and gives one tip. The badge shows where it ran, on-device or cloud, and how fast. |
| 0:45 | Dictation 2 | Feedback after every sentence means hundreds of AI calls a session: perfect for free, private, on-device inference. |
| 1:00 | Offline | Offline? Practice keeps working: the exact mark runs locally, history is cached in Firestore and syncs later. |
| 1:10 | Mode switch | A mode switch compares Prefer on-device, On-device only and Cloud only live: the same request, the same JSON schema. |
| 1:18 | Short writing | Gemini returns the exact phrases to fix. With Gemini Nano, the learner's writing never leaves the device. |
| 1:40 | Coach | Your history, saved per anonymous user in Firestore, shows which weakness costs the most points. The coach report runs on cloud Gemini with a typed response schema. |
| 2:00 | Flow | Start Flow: train the weakness on 3 matched sentences, then re-test on 3 new ones. |
| 2:35 | Flow result | Before and after, measured on new sentences: find the weakness, train it, prove it. |
| 2:42 | End card | Firebase AI Logic hybrid (PREFER_ON_DEVICE), App Check enforced, Anonymous Auth, Firestore offline, Remote Config, Hosting. Live link and Apache-2.0 repo. |
