// Records the narrated demo video: voice-over, a visible mouse cursor with click ripples,
// click and key sounds, smooth zoom on the part being explained, and subtitles.
//
//   node scripts/record-demo-narrated.mjs --cdp=http://127.0.0.1:9333 [outDir]
//   node scripts/record-demo-narrated.mjs --post-only [outDir]      # rebuild the mp4 from saved frames
//
// Narration text: scripts/demo-narration.jsonl. Voice: 9tts, ElevenLabs eleven_v3, voice Charlie, read as one take
// and cut into demo/voice/<id>.wav at word timestamps (faster-whisper), so the delivery stays continuous.
// Like record-demo.mjs, it attaches over CDP to a normally started Chrome that has Gemini Nano.
// Output: outDir/demo.mp4 (1920x1350, voice + sound effects).

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DICTATION_ITEMS } from '../src/content.ts';

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http')) || 'https://flow-coach-hybrid.web.app';
const outDir = args.find((a) => !a.startsWith('http') && !a.startsWith('--')) || 'demo/narrated';
const cdpUrl = (args.find((a) => a.startsWith('--cdp=')) || '').slice('--cdp='.length);
const postOnly = args.includes('--post-only');
const voiceDir = 'demo/voice';
fs.mkdirSync(outDir, { recursive: true });

const W = 1280;
const H = 900;
const DPR = 2;
const OUT_W = 1920;
const OUT_H = 1350;
const FPS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;
const script = Object.fromEntries(
  fs.readFileSync('scripts/demo-narration.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((j) => [j.id, j.text]),
);
const durOf = (id) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(voiceDir, `${id}.wav`)]).toString());

const tl = { cues: [], clicks: [], keys: [], zooms: [], subs: [] };

if (!postOnly) await record();
await build();
process.exit(0);

// ------------------------------------------------------------------ recording
async function record() {
  if (!cdpUrl) throw new Error('pass --cdp=http://127.0.0.1:9333 (a Chrome that has Gemini Nano)');
  const text = Object.fromEntries(DICTATION_ITEMS.map((i) => [i.id, i.text]));
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  const page = await context.newPage();
  await page.setViewportSize({ width: W, height: H });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
  const logFile = path.join(outDir, 'console.log');
  fs.writeFileSync(logFile, '');
  page.on('console', (m) => {
    if (/warn|error/.test(m.type())) fs.appendFileSync(logFile, `${new Date().toISOString()} ${m.type()} ${m.text().slice(0, 400)}\n`);
  });

  const framesDir = path.join(outDir, 'frames');
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  const frames = [];
  cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
    const f = path.join(framesDir, `f${String(frames.length).padStart(6, '0')}.jpg`);
    fs.writeFileSync(f, Buffer.from(data, 'base64'));
    frames.push({ f, t: metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });

  await page.goto(url, { waitUntil: 'load' });
  await sleep(1500);
  await page.evaluate(installOverlay);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W * DPR, maxHeight: H * DPR, everyNthFrame: 1 });
  await sleep(300);

  // --- helpers bound to this page ---
  let cur = { x: W / 2, y: H / 2 };
  const say = (id, sub = true) => {
    const t = now();
    const d = durOf(id);
    tl.cues.push({ id, t, d });
    if (sub) tl.subs.push({ id, t, d, text: script[id] });
    return sleep((d + 0.35) * 1000);
  };
  const moveTo = async (x, y, ms = 650) => {
    await page.evaluate(({ x, y, ms }) => window.__fx.move(x, y, ms), { x, y, ms });
    cur = { x, y };
    await sleep(ms + 80);
  };
  const boxOf = async (sel) => {
    const loc = page.locator(sel).first();
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    return loc.boundingBox();
  };
  const hover = async (sel, dx = 0.5, dy = 0.5) => {
    const b = await boxOf(sel);
    if (b) await moveTo(b.x + b.width * dx, b.y + b.height * dy);
    return b;
  };
  const clickOn = async (sel) => {
    await hover(sel);
    tl.clicks.push(now());
    await page.evaluate(() => window.__fx.ripple());
    await page.click(sel);
  };
  const typeKeys = async (s, delay = 40) => {
    for (const ch of s) {
      tl.keys.push(now());
      await page.keyboard.type(ch);
      await sleep(delay * (0.6 + Math.random() * 0.8));
    }
  };
  const pressEnter = async () => {
    tl.keys.push(now());
    await page.keyboard.press('Enter');
  };
  // Zoom so that the element (plus padding) fills the frame, capped at maxZ.
  const zoomTo = async (sel, maxZ = 1.8, pad = 40) => {
    const b = sel && typeof sel === 'object' ? sel : await boxOf(sel);
    if (!b) return;
    const z = Math.max(base.z, Math.min(maxZ, W / (b.width + pad * 2), H / (b.height + pad * 2)));
    tl.zooms.push({ t: now(), z, cx: b.x + b.width / 2, cy: b.y + b.height / 2 });
  };
  // Base view: the app column fills the frame (the page leaves wide margins at 1280 px).
  const hb = await page.locator('header.top').boundingBox();
  const bz = Math.min(1.35, W / (hb.width + 70));
  const base = { z: bz, cx: hb.x + hb.width / 2, cy: H / (2 * bz) };
  const zoomOut = () => tl.zooms.push({ t: now(), ...base });
  const fullFrame = () => tl.zooms.push({ t: now(), z: 1, cx: W / 2, cy: H / 2 });
  const pillsBox = async () => {
    const bs = (await Promise.all(['#net', '#device', '#mode'].map((s) => page.locator(s).boundingBox()))).filter(Boolean);
    const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
    return { x, y, width: Math.max(...bs.map((b) => b.x + b.width)) - x, height: Math.max(...bs.map((b) => b.y + b.height)) - y };
  };
  const card = async (title, lines) => {
    await page.evaluate(({ title, lines }) => window.__fx.card(title, lines), { title, lines });
  };
  const uncard = () => page.evaluate(() => window.__fx.uncard());
  const itemText = async () => text[await page.getAttribute('[data-item]', 'data-item')];
  const waitTip = (timeout = 45000) =>
    page.waitForFunction(() => /Tip|unavailable|paused/i.test(document.getElementById('ai')?.innerText || ''), null, { timeout }).catch(() => {});
  const center = (sel) => page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), sel);

  // ---------------- the demo ----------------
  await card('Flow Coach', [
    'Hybrid AI practice for English test takers',
    'Gemini Nano on-device in Chrome · cloud Gemini for deeper coaching',
    'Built with Firebase AI Logic',
  ]);
  await sleep(600);
  await say('s01', false);
  await sleep(400);
  await uncard();
  zoomOut();
  await sleep(900);

  const s02 = say('s02');
  await hover('[data-tab=dictation]');
  await sleep(900);
  await hover('#play');
  await s02;

  const s03 = say('s03');
  await zoomTo(await pillsBox(), 2.6, 30);
  await sleep(900);
  await hover('#device');
  await sleep(2600);
  await hover('#mode');
  await s03;
  zoomOut();
  await sleep(200);

  // Dictation 1
  const s04 = say('s04');
  await clickOn('#play');
  await sleep(2200);
  let s = await itemText();
  await clickOn('#answer');
  await typeKeys(sloppy(s, 3), 45);
  await sleep(300);
  await pressEnter();
  await s04;
  await center('#result');
  await sleep(700);
  const s05 = say('s05');
  await zoomTo('#result', 1.7);
  await hover('#result', 0.3, 0.4);
  await waitTip();
  await s05;
  zoomOut();
  await center('#ai');
  await sleep(800);
  const s06 = say('s06');
  await zoomTo('#ai', 1.7);
  await hover('#ai', 0.85, 0.15);
  await s06;
  zoomOut();
  await sleep(400);
  await clickOn('#next');

  // Dictation 2
  await sleep(600);
  const s07 = say('s07');
  s = await itemText();
  await clickOn('#answer');
  await typeKeys(sloppy(s, 2), 34);
  await pressEnter();
  await waitTip();
  await center('#ai');
  await s07;
  await sleep(600);
  await clickOn('#next');

  // Offline
  await sleep(500);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const s08 = say('s08');
  await zoomTo(await pillsBox(), 2.6, 30);
  await hover('#net');
  await sleep(1800);
  zoomOut();
  s = await itemText();
  await clickOn('#answer');
  await typeKeys(sloppy(s, 1), 34);
  await pressEnter();
  await waitTip(20000);
  await center('#ai');
  await sleep(700);
  await zoomTo('#ai', 1.6);
  await hover('#ai', 0.85, 0.15);
  await s08;
  await sleep(500);
  zoomOut();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await clickOn('#next');

  // Mode switch
  await sleep(500);
  const s09 = say('s09');
  await zoomTo(await pillsBox(), 2.6, 30);
  // A native <select> popup is not part of the page capture, so show the click and set the value.
  await hover('#mode');
  tl.clicks.push(now());
  await page.evaluate(() => window.__fx.ripple());
  await page.selectOption('#mode', 'only_in_cloud');
  await sleep(1600);
  await page.selectOption('#mode', 'prefer_on_device');
  await s09;
  zoomOut();

  // Short writing
  await sleep(400);
  const s10 = say('s10');
  await clickOn('[data-tab=writing]');
  await sleep(500);
  await clickOn('#wtext');
  await typeKeys(
    'One habit that help me study is planning my day. Every morning I writes three small goal and I check them before bed. This make me more focus and I dont waste time on my phone.',
    16,
  );
  await sleep(300);
  await clickOn('#wcheck');
  await page.waitForSelector('#wresult .issues, #wresult .tip', { timeout: 45000 }).catch(() => {});
  await center('#wresult');
  await sleep(700);
  await zoomTo('#wresult', 1.5);
  await hover('#wresult', 0.3, 0.3);
  await s10;
  await sleep(600);
  zoomOut();

  // Coach
  await sleep(300);
  const s11 = say('s11');
  await clickOn('[data-tab=coach]');
  await sleep(900);
  await hover('#report');
  await s11;
  const s12 = say('s12');
  await clickOn('#report');
  await page.waitForSelector('#reportOut .report, #reportOut p.muted', { timeout: 70000 }).catch(() => {});
  await sleep(600);
  await center('#reportOut');
  await sleep(800);
  await zoomTo('#reportOut', 1.35);
  await hover('#reportOut', 0.4, 0.3);
  await s12;
  await sleep(900);
  zoomOut();

  // Flow
  await sleep(300);
  const s13 = say('s13');
  await clickOn('#flow');
  let s14 = null;
  for (let k = 0; k < 6; k++) {
    await sleep(400);
    if (k === 3) s14 = say('s14');
    s = await itemText();
    const ans = k < 3 ? sloppy(s, 1) : s.replace(/\.$/, '');
    await clickOn('#answer');
    await typeKeys(ans, 12);
    await pressEnter();
    await waitTip();
    await sleep(k < 3 ? 700 : 450);
    if (k === 2) await s13;
    await clickOn('#next');
  }
  await s14;
  await sleep(900);
  const s15 = say('s15');
  const view = await boxOf('#view');
  if (view) await zoomTo({ x: view.x, y: view.y, width: view.width, height: Math.min(view.height, 520) }, 1.4);
  await s15;
  await sleep(700);
  zoomOut();
  await page.evaluate(() => window.__fx.hide());
  fullFrame();
  await sleep(800);

  await card('Flow Coach', [
    'Gemini Nano on-device + cloud Gemini via Firebase AI Logic (hybrid, PREFER_ON_DEVICE)',
    'App Check (reCAPTCHA Enterprise, enforced) · Anonymous Auth · Firestore offline · Remote Config · Hosting',
    'Live: flow-coach-hybrid.web.app',
    'Open source (Apache-2.0): github.com/tomcandev/flow-coach',
  ]);
  await sleep(500);
  await say('s16', false);
  await sleep(1800);

  await cdp.send('Page.stopScreencast').catch(() => {});
  await page.close();
  await browser.close();

  const t0 = frames[0].t;
  const end = frames[frames.length - 1].t + 0.5;
  fs.writeFileSync(
    path.join(outDir, 'frames.txt'),
    frames
      .map((fr, i) => `file '${path.resolve(fr.f)}'\nduration ${Math.max(0.005, (frames[i + 1]?.t ?? end) - fr.t).toFixed(4)}`)
      .join('\n') + `\nfile '${path.resolve(frames[frames.length - 1].f)}'\n`,
  );
  const rel = (t) => +(t - t0).toFixed(3);
  const out = {
    duration: +(end - t0).toFixed(3),
    srcW: W * DPR,
    srcH: H * DPR,
    cues: tl.cues.map((c) => ({ ...c, t: rel(c.t) })),
    subs: tl.subs.map((c) => ({ ...c, t: rel(c.t) })),
    clicks: tl.clicks.map(rel),
    keys: tl.keys.map(rel),
    zooms: tl.zooms.map((z) => ({ ...z, t: rel(z.t) })),
  };
  fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(out, null, 1));
  console.log('RECORDED', frames.length, 'frames,', out.duration, 's');
}

// Overlay that lives outside <body>: cursor, click ripple and title cards.
function installOverlay() {
  const root = document.createElement('div');
  root.id = '__fx';
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  root.innerHTML = `
    <style>
      #__cur{position:fixed;left:0;top:0;width:30px;height:30px;transform:translate(640px,450px);transition-property:transform;transition-timing-function:cubic-bezier(.45,0,.2,1);filter:drop-shadow(0 3px 5px rgba(0,0,0,.35))}
      #__rip{position:fixed;left:-22px;top:-22px;width:44px;height:44px;border-radius:50%;background:rgba(99,102,241,.35);border:2px solid rgba(99,102,241,.8);opacity:0}
      #__rip.on{animation:__rip .5s ease-out}
      @keyframes __rip{from{opacity:1;transform:var(--p) scale(.3)}to{opacity:0;transform:var(--p) scale(1.5)}}
      #__card{position:fixed;inset:0;display:grid;place-items:center;background:linear-gradient(135deg,#4338ca,#0f766e);color:#fff;font-family:system-ui,-apple-system,sans-serif;opacity:0;transition:opacity .5s}
      #__card.on{opacity:1}
      #__card .l{opacity:0;transform:translateY(12px);transition:opacity .6s,transform .6s}
      #__card.on .l{opacity:1;transform:none}
    </style>
    <div id="__rip"></div>
    <svg id="__cur" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  document.documentElement.appendChild(root);
  const cur = root.querySelector('#__cur');
  const rip = root.querySelector('#__rip');
  let pos = { x: 640, y: 450 };
  window.__fx = {
    move(x, y, ms) {
      cur.style.transitionDuration = ms + 'ms';
      cur.style.transform = `translate(${x - 4}px,${y - 3}px)`;
      pos = { x, y };
    },
    ripple() {
      rip.style.setProperty('--p', `translate(${pos.x}px,${pos.y}px)`);
      rip.classList.remove('on');
      void rip.offsetWidth;
      rip.classList.add('on');
    },
    hide() {
      cur.style.opacity = '0';
    },
    card(title, lines) {
      cur.style.opacity = '0';
      const el = document.createElement('div');
      el.id = '__card';
      el.innerHTML = `<div style="max-width:1040px;padding:40px"><div class="l" style="font-size:66px;font-weight:800;letter-spacing:-0.03em">${title}</div>${lines
        .map(
          (l, i) =>
            `<div class="l" style="transition-delay:${0.35 + i * 0.3}s;font-size:${i === 0 ? 30 : 23}px;margin-top:${i === 0 ? 18 : 12}px;opacity:${i === 0 ? 1 : 0.9}">${l}</div>`,
        )
        .join('')}</div>`;
      root.appendChild(el);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
    },
    uncard() {
      const el = root.querySelector('#__card');
      if (!el) return;
      el.classList.remove('on');
      setTimeout(() => el.remove(), 600);
      cur.style.opacity = '1';
    },
  };
}

// Learner-like mistakes in a sentence.
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

// ------------------------------------------------------------------ post-production
async function build() {
  const T = JSON.parse(fs.readFileSync(path.join(outDir, 'timeline.json'), 'utf8'));
  const S = T.srcW / W;

  // 0. Speed up long stretches with no voice (waiting for the model, typing drills) so the
  //    video stays under 3 minutes and never sits silent. Voice clips keep normal speed.
  const SPEED = 2.2;
  const talk = T.cues.map((c) => [c.t - 0.3, c.t + c.d + 0.5]).sort((a, b) => a[0] - b[0]);
  const fast = [];
  let edge = 0;
  for (const [a, b] of talk) {
    if (a - edge > 3) fast.push([edge + 0.8, a - 0.8]);
    edge = Math.max(edge, b);
  }
  const remap = (t) => {
    let out = t;
    for (const [a, b] of fast) out -= (Math.min(Math.max(t, a), b) - a) * (1 - 1 / SPEED);
    return out;
  };
  const fl = fs.readFileSync(path.join(outDir, 'frames.txt'), 'utf8').split('\n');
  const files = [];
  const durs = [];
  for (const l of fl) {
    if (l.startsWith('file ')) files.push(l);
    if (l.startsWith('duration ')) durs.push(Number(l.slice(9)));
  }
  let acc = 0;
  const lines = [];
  for (let i = 0; i < durs.length; i++) {
    lines.push(files[i], `duration ${Math.max(0.002, remap(acc + durs[i]) - remap(acc)).toFixed(4)}`);
    acc += durs[i];
  }
  lines.push(files[files.length - 1]);
  const framesFile = path.join(outDir, 'frames-remap.txt');
  fs.writeFileSync(framesFile, lines.join('\n') + '\n');
  T.duration = remap(T.duration);
  for (const c of [...T.cues, ...T.subs, ...T.zooms]) c.t = remap(c.t);
  T.clicks = T.clicks.map(remap);
  T.keys = T.keys.map(remap);
  console.log('sped up', fast.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}`).join(' '));

  // 1. Audio: voice clips + click and key sounds, mixed into one WAV.
  const SR = 48000;
  const total = Math.ceil((T.duration + 0.5) * SR);
  const mix = new Float32Array(total);
  for (const c of T.cues) {
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(voiceDir, `${c.id}.wav`), '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
    const v = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
    const at = Math.round(c.t * SR);
    for (let i = 0; i < v.length && at + i < total; i++) mix[at + i] += v[i] * 0.95;
  }
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const burst = (t, amp, tau, len, tone) => {
    const at = Math.round(t * SR);
    let lp = 0;
    for (let i = 0; i < len * SR && at + i < total; i++) {
      const e = Math.exp(-i / (tau * SR));
      lp = lp * 0.55 + rnd() * 0.45;
      mix[at + i] += (lp * 0.8 + Math.sin((2 * Math.PI * tone * i) / SR) * 0.4) * e * amp;
    }
  };
  for (const t of T.clicks) {
    burst(t, 0.22, 0.003, 0.03, 1800);
    burst(t + 0.07, 0.14, 0.002, 0.02, 2400);
  }
  for (const t of T.keys) burst(t, 0.05 + Math.abs(rnd()) * 0.03, 0.0025, 0.025, 1200 + Math.abs(rnd()) * 600);
  const wav = Buffer.alloc(44 + total * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + total * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SR, 24);
  wav.writeUInt32LE(SR * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(total * 2, 40);
  for (let i = 0; i < total; i++) wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix[i])) * 32767), 44 + i * 2);
  const audio = path.join(outDir, 'audio.wav');
  fs.writeFileSync(audio, wav);

  // 2. Subtitle images (rendered by Chrome on a transparent page).
  const subDir = path.join(outDir, 'subs');
  fs.rmSync(subDir, { recursive: true, force: true });
  fs.mkdirSync(subDir, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const p = await b.newPage({ viewport: { width: OUT_W, height: OUT_H } });
  for (const s of T.subs) {
    await p.setContent(
      `<html><body style="margin:0;background:transparent"><div style="position:fixed;left:50%;bottom:34px;transform:translateX(-50%);max-width:1560px;width:max-content;padding:16px 30px;border-radius:18px;background:rgba(17,24,39,.86);color:#fff;font:600 32px/1.38 -apple-system,system-ui,sans-serif;text-align:center;box-shadow:0 10px 34px rgba(0,0,0,.28)">${s.text.replace(/\[[^\]]*\]\s*/g, '')}</div></body></html>`,
    );
    await p.screenshot({ path: path.join(subDir, `${s.id}.png`), omitBackground: true });
  }
  await b.close();

  // 3. Zoom expressions: each zoom eases from the previous state over D seconds.
  const D = 0.8;
  const ease = (t) => `(st(0,clip((it-${t.toFixed(3)})/${D},0,1));ld(0)*ld(0)*(3-2*ld(0)))`;
  let zE = '1';
  let xE = `${(T.srcW / 2).toFixed(1)}`;
  let yE = `${(T.srcH / 2).toFixed(1)}`;
  let prev = { z: 1, cx: W / 2, cy: H / 2 };
  for (const z of T.zooms) {
    const { cx, cy } = z;
    zE += `+(${(z.z - prev.z).toFixed(4)})*${ease(z.t)}`;
    xE += `+(${((cx - prev.cx) * S).toFixed(1)})*${ease(z.t)}`;
    yE += `+(${((cy - prev.cy) * S).toFixed(1)})*${ease(z.t)}`;
    prev = { z: z.z, cx, cy };
  }
  const graph = [
    `[0:v]fps=${FPS},scale=${T.srcW}:${T.srcH},setsar=1,zoompan=z='${zE}':x='max(0,min(iw-iw/zoom,(${xE})-iw/zoom/2))':y='max(0,min(ih-ih/zoom,(${yE})-ih/zoom/2))':d=1:s=${OUT_W}x${OUT_H}:fps=${FPS}[z0]`,
  ];
  T.subs.forEach((s, i) => {
    graph.push(`[z${i}][${i + 2}:v]overlay=0:0:enable='between(t,${s.t.toFixed(2)},${(s.t + s.d + 0.3).toFixed(2)})'[z${i + 1}]`);
  });
  graph.push(`[z${T.subs.length}]format=yuv420p[vout]`, `[1:a]loudnorm=I=-16:TP=-1.5:LRA=11[aout]`);
  const graphFile = path.join(outDir, 'graph.txt');
  fs.writeFileSync(graphFile, graph.join(';\n'));
  const out = path.join(outDir, 'demo.mp4');
  const inputs = ['-f', 'concat', '-safe', '0', '-i', framesFile, '-i', audio];
  for (const s of T.subs) inputs.push('-i', path.join(subDir, `${s.id}.png`));
  execFileSync(
    'ffmpeg',
    ['-v', 'error', '-y', ...inputs, '-/filter_complex', graphFile, '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out],
    { stdio: 'inherit' },
  );
  console.log('VIDEO', out, T.duration, 's');
}
