// Records the demo video of the live app with captions, using the system Chrome.
//
//   node scripts/record-demo.mjs [url] [outDir] [--cdp=http://127.0.0.1:9333] [--user-data-dir=/path]
//
// Default url: https://flow-coach-hybrid.web.app, outDir: demo/raw
// To record the on-device path, start a normal Chrome that already has Gemini Nano with
// --remote-debugging-port=9333 and pass --cdp=http://127.0.0.1:9333. A Chrome launched by
// Playwright cannot be used for that: its default flags turn off component updates and
// optimization hints, so Chrome reports the on-device model as unavailable and the app
// shows the cloud fallback instead.
// Frames are captured with the Chrome DevTools screencast and encoded with the system ffmpeg.
// Output: outDir/demo.mp4 (silent, captions burned into the page).

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DICTATION_ITEMS } from '../src/content.ts';

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http')) || 'https://flow-coach-hybrid.web.app';
const outDir = args.find((a) => !a.startsWith('http') && !a.startsWith('--')) || 'demo/raw';
const udd = (args.find((a) => a.startsWith('--user-data-dir=')) || '').split('=')[1];
const cdpUrl = (args.find((a) => a.startsWith('--cdp=')) || '').slice('--cdp='.length);
fs.mkdirSync(outDir, { recursive: true });

const W = 1280;
const H = 900;
const text = Object.fromEntries(DICTATION_ITEMS.map((i) => [i.id, i.text]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const opts = {
  channel: 'chrome',
  headless: process.env.HEADED ? false : true,
  viewport: { width: W, height: H },
  args: ['--autoplay-policy=no-user-gesture-required'],
};
const attached = cdpUrl ? await chromium.connectOverCDP(cdpUrl) : null;
const context = attached
  ? attached.contexts()[0]
  : udd
    ? await chromium.launchPersistentContext(udd, opts)
    : await (await chromium.launch(opts)).newContext(opts);
const page = attached ? await context.newPage() : context.pages()[0] || (await context.newPage());
if (attached) await page.setViewportSize({ width: W, height: H });
const logFile = path.join(outDir, 'console.log');
fs.writeFileSync(logFile, '');
page.on('console', (m) => {
  if (/warn|error/.test(m.type())) fs.appendFileSync(logFile, `${new Date().toISOString()} ${m.type()} ${m.text().slice(0, 400)}\n`);
});

// --- screencast capture ---
const framesDir = path.join(outDir, 'frames');
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });
const frames = [];
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
  const f = path.join(framesDir, `f${String(frames.length).padStart(6, '0')}.jpg`);
  fs.writeFileSync(f, Buffer.from(data, 'base64'));
  frames.push({ f, t: metadata.timestamp });
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

async function caption(t, ms = 0) {
  await page.evaluate((t) => {
    let el = document.getElementById('__cap');
    if (!el) {
      el = document.createElement('div');
      el.id = '__cap';
      el.style.cssText =
        'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);max-width:1040px;width:max-content;padding:12px 20px;border-radius:14px;background:rgba(17,24,39,.92);color:#fff;font:600 19px/1.4 system-ui,-apple-system,sans-serif;z-index:99999;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.25);transition:opacity .2s';
      document.body.appendChild(el);
    }
    el.style.opacity = t ? '1' : '0';
    el.textContent = t;
  }, t);
  if (ms) await sleep(ms);
}

async function card(title, lines, ms) {
  await page.evaluate(
    ({ title, lines }) => {
      const el = document.createElement('div');
      el.id = '__card';
      el.style.cssText =
        'position:fixed;inset:0;z-index:100000;display:grid;place-items:center;background:linear-gradient(135deg,#4338ca,#0f766e);color:#fff;font-family:system-ui,-apple-system,sans-serif';
      el.innerHTML = `<div style="max-width:1000px;padding:40px"><div style="font-size:64px;font-weight:800;letter-spacing:-0.03em">${title}</div>${lines
        .map((l, i) => `<div style="font-size:${i === 0 ? 30 : 23}px;margin-top:${i === 0 ? 18 : 12}px;opacity:${i === 0 ? 1 : 0.9}">${l}</div>`)
        .join('')}</div>`;
      document.body.appendChild(el);
    },
    { title, lines },
  );
  await sleep(ms);
  await page.evaluate(() => document.getElementById('__card')?.remove());
}

async function zoom() {
  await page.evaluate(() => (document.documentElement.style.zoom = '0.92'));
}

async function itemText() {
  const id = await page.getAttribute('[data-item]', 'data-item');
  return text[id];
}

async function typeAnswer(answer) {
  await page.click('#answer');
  await page.type('#answer', answer, { delay: 38 });
  await sleep(400);
  await page.keyboard.press('Enter');
}

async function waitTip(timeout = 45000) {
  await page.waitForFunction(() => /Tip|unavailable|paused/i.test(document.getElementById('ai')?.innerText || ''), null, { timeout }).catch(() => {});
}

// Introduce learner-like mistakes into a sentence.
function sloppy(s, level = 2) {
  let w = s.replace(/\.$/, '').split(' ');
  let n = 0;
  w = w.map((x, i) => {
    if (n >= level) return x;
    if (i > 0 && /[a-z]{4,}s$/.test(x) && !/ss$/.test(x)) return n++, x.slice(0, -1);
    if (i > 0 && /[a-z]{4,}ed$/.test(x)) return n++, x.slice(0, -2);
    return x;
  });
  if (level >= 2) {
    const j = w.findIndex((x, i) => i > 0 && x === 'the');
    if (j > 0) w.splice(j, 1);
  }
  return w.join(' ');
}

// ---------------- the demo ----------------
await page.goto(url, { waitUntil: 'load' });
await zoom();
await sleep(1500);
await card('Flow Coach', ['Hybrid AI practice for English test takers', 'Instant, private feedback with Gemini Nano on-device in Chrome', 'Deeper coaching with cloud Gemini · both through Firebase AI Logic'], 5500);

await caption('Millions of students and migrants sit English tests. In dictation, most points are lost to small slips: a missing -s, a dropped "the".', 5000);
await caption('The header shows the AI engine. Gemini Nano runs on-device when Chrome has it; otherwise the Firebase AI Logic hybrid SDK falls back to cloud Gemini.', 5500);

// Dictation 1
await caption('Write From Dictation: listen, type, press Enter.', 0);
await page.click('#play');
await sleep(2500);
let s = await itemText();
await typeAnswer(sloppy(s, 3));
await caption('Marking is deterministic and instant. Every lost point gets a category: ending, spelling, small word or missed word.', 0);
await waitTip();
await page.evaluate(() => document.getElementById('ai')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
await sleep(2000);
await caption('Then Gemini explains each mistake and gives one tip. The badge shows where it ran: on-device or cloud, and how fast.', 6000);
await page.click('#next');

// Dictation 2
await sleep(600);
s = await itemText();
await caption('Feedback after every sentence means hundreds of AI calls a session: perfect for free, private, on-device inference.', 0);
await typeAnswer(sloppy(s, 2));
await waitTip();
await page.evaluate(() => document.getElementById('ai')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
await sleep(3500);
await page.click('#next');

// Offline
await sleep(600);
await context.setOffline(true);
await page.evaluate(() => window.dispatchEvent(new Event('offline')));
s = await itemText();
await caption('Offline? Practice keeps working: the exact mark runs locally, history is cached in Firestore and syncs later.', 0);
await typeAnswer(sloppy(s, 1));
await waitTip(20000);
await page.evaluate(() => document.getElementById('ai')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
await sleep(3500);
await context.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.click('#next');

// Mode switch
await sleep(500);
await caption('A mode switch compares Prefer on-device, On-device only and Cloud only live: the same request, the same JSON schema.', 0);
await page.selectOption('#mode', 'only_in_cloud');
await sleep(2000);
await page.selectOption('#mode', 'prefer_on_device');
await sleep(2000);

// Short writing
await page.click('[data-tab=writing]');
await sleep(800);
await caption('Short writing: Gemini returns the exact phrases to fix. With Gemini Nano, the learner\'s writing never leaves the device.', 0);
await page.click('#wtext');
await page.type(
  '#wtext',
  'One habit that help me study is planning my day. Every morning I writes three small goal and I check them before bed. This make me more focus and I dont waste time on my phone.',
  { delay: 22 },
);
await sleep(500);
await page.click('#wcheck');
await page.waitForSelector('#wresult .issues, #wresult .tip', { timeout: 45000 }).catch(() => {});
await page.evaluate(() => document.getElementById('wresult')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
await sleep(6000);

// Coach
await page.click('[data-tab=coach]');
await sleep(800);
await caption('Coach & Flow: your history, saved per anonymous user in Firestore, shows which weakness costs the most points.', 4500);
await caption('The coach report runs on cloud Gemini with a typed response schema: the pattern, 3 rules and a plan.', 0);
await page.click('#report');
await page.waitForSelector('#reportOut .report, #reportOut p.muted', { timeout: 70000 }).catch(() => {});
await sleep(1200);
await page.evaluate(() => document.getElementById('reportOut')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
await sleep(7000);

// Flow
await caption('Start Flow: train the weakness on 3 matched sentences, then re-test on 3 new ones.', 0);
await page.click('#flow');
for (let k = 0; k < 6; k++) {
  await sleep(500);
  s = await itemText();
  const ans = k < 3 ? sloppy(s, 1) : s.replace(/\.$/, '');
  await page.click('#answer');
  await page.type('#answer', ans, { delay: 14 });
  await page.keyboard.press('Enter');
  await waitTip();
  await sleep(k < 3 ? 1500 : 1000);
  if (k === 3) await caption('Re-test on sentences the learner has not seen.', 0);
  await page.click('#next');
}
await sleep(800);
await caption('Before and after, measured on new sentences: find the weakness, train it, prove it.', 6000);
await caption('', 0);

await card('Flow Coach', [
  'Gemini Nano on-device + cloud Gemini via Firebase AI Logic (hybrid, PREFER_ON_DEVICE)',
  'App Check (reCAPTCHA Enterprise, enforced) · Anonymous Auth · Firestore offline · Remote Config · Hosting',
  'Live: flow-coach-hybrid.web.app',
  'Open source (Apache-2.0): github.com/tomcandev/flow-coach',
], 6000);

await sleep(300);
await cdp.send('Page.stopScreencast').catch(() => {});
if (attached) {
  await page.close();
  await attached.close();
} else {
  await context.close();
}

// Frames arrive only when the page changes; hold each frame until the next one.
const end = frames.length ? frames[frames.length - 1].t + 0.5 : 0;
const list = frames
  .map((fr, i) => `file '${path.resolve(fr.f)}'\nduration ${Math.max(0.01, (frames[i + 1]?.t ?? end) - fr.t).toFixed(3)}`)
  .join('\n');
const listFile = path.join(outDir, 'frames.txt');
fs.writeFileSync(listFile, list + `\nfile '${path.resolve(frames[frames.length - 1].f)}'\n`);
const out = path.join(outDir, 'demo.mp4');
// Keep the final video under the 3-minute limit by speeding it up slightly if needed.
const total = end - (frames[0]?.t ?? 0);
const factor = total > 172 ? (172 / total).toFixed(4) : '1';
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', `setpts=${factor}*PTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:white,fps=30,format=yuv420p`, '-c:v', 'libx264', '-crf', '20', '-movflags', '+faststart', out]);
console.log('VIDEO', out, frames.length, 'frames,', total.toFixed(1), 's captured, speed factor', factor);
process.exit(0);
