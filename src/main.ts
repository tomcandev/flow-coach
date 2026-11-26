import './styles.css';
import { ensureUser, loadAttempts, loadRemoteConfig, saveAttempt, savePlan, type Attempt } from './firebase';
import {
  coachReport,
  deviceState,
  dictationTip,
  downloadDeviceModel,
  MODES,
  warmUp,
  WEAKNESSES,
  writingCheck,
  type CoachReport,
  type DeviceState,
  type Mode,
} from './ai';
import { DICTATION_ITEMS, WRITING_ITEMS, type DictationItem } from './content';
import { CATEGORY_LABEL, CATEGORY_SHORT, itemSkills, mark, words, type MarkResult, type MistakeCategory } from './scoring';

// ---------------- state ----------------
type Tab = 'dictation' | 'writing' | 'coach';
interface FlowState {
  weakness: MistakeCategory;
  phase: 'train' | 'retest' | 'done';
  queue: DictationItem[];
  index: number;
  baseline: number; // points lost in this category per sentence before the Flow
  baselineAcc: number; // word accuracy before the Flow
  results: { phase: 'train' | 'retest'; lost: number; accuracy: number }[];
}
const state = {
  tab: 'dictation' as Tab,
  uid: null as string | null,
  attempts: [] as Attempt[],
  mode: (localStorageGet('mode') as Mode) || ('prefer_on_device' as Mode),
  device: 'no-api' as DeviceState,
  online: navigator.onLine,
  dIndex: Number(localStorageGet('dIndex') || 0) % DICTATION_ITEMS.length,
  wIndex: Number(localStorageGet('wIndex') || 0) % WRITING_ITEMS.length,
  plays: 0,
  rate: 0.95,
  report: null as CoachReport | null,
  flow: null as FlowState | null,
  downloading: null as number | null,
};

function localStorageGet(k: string): string | null {
  try {
    return localStorage.getItem('fc.' + k);
  } catch {
    return null;
  }
}
function localStorageSet(k: string, v: string) {
  try {
    localStorage.setItem('fc.' + k, v);
  } catch {
    /* private mode */
  }
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---------------- shell ----------------
const appEl = document.getElementById('app')!;
appEl.innerHTML = `
<header class="top">
  <div class="brand">
    <div class="logo" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M4 20c5 0 5-8 10-8s5 8 10 8 4-4 4-4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></div>
    <div><div class="name">Flow Coach</div><div class="sub">Hybrid AI practice for English tests</div></div>
  </div>
  <div class="engine">
    <span id="net" class="pill"></span>
    <span id="device" class="pill"></span>
    <label class="mode"><span class="sr">AI mode</span>
      <select id="mode">${MODES.map((m) => `<option value="${m.value}">${m.label}</option>`).join('')}</select>
    </label>
  </div>
</header>
<nav class="tabs" role="tablist">
  <button role="tab" data-tab="dictation">Dictation</button>
  <button role="tab" data-tab="writing">Short writing</button>
  <button role="tab" data-tab="coach">Coach &amp; Flow</button>
</nav>
<main id="view"></main>
<footer class="foot">
  Instant feedback runs on-device with Gemini Nano when Chrome supports it, and falls back to cloud Gemini through Firebase AI Logic.
  Practice content is original. <a href="https://github.com/tomcandev/flow-coach" target="_blank" rel="noopener">Source (Apache-2.0)</a>
</footer>`;

const modeSel = $<HTMLSelectElement>('#mode');
modeSel.value = state.mode;
modeSel.onchange = () => {
  state.mode = modeSel.value as Mode;
  localStorageSet('mode', state.mode);
  renderEngine();
};
document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => {
  b.onclick = () => go(b.dataset.tab as Tab);
});
window.addEventListener('online', () => ((state.online = true), renderEngine(), state.tab === 'coach' && render()));
window.addEventListener('offline', () => ((state.online = false), renderEngine(), state.tab === 'coach' && render()));

function go(tab: Tab) {
  state.tab = tab;
  speechSynthesis.cancel();
  render();
}

function renderEngine() {
  const net = $('#net');
  net.className = 'pill ' + (state.online ? 'ok' : 'warn');
  net.textContent = state.online ? 'Online' : 'Offline';
  const d = $('#device');
  const map: Record<DeviceState, [string, string]> = {
    available: ['ok', 'Gemini Nano ready'],
    downloadable: ['info', 'Gemini Nano: download'],
    downloading: ['info', 'Gemini Nano downloading'],
    unavailable: ['muted', 'On-device unavailable'],
    'no-api': ['muted', 'On-device not supported'],
  };
  let [cls, label] = map[state.device];
  if (state.downloading !== null) label = `Downloading Nano ${Math.round(state.downloading * 100)}%`;
  d.className = 'pill ' + cls + (state.device === 'downloadable' ? ' clickable' : '');
  d.textContent = label;
  d.title =
    state.device === 'available'
      ? 'Feedback is generated locally in Chrome. Your answers stay on this device.'
      : state.device === 'downloadable'
        ? 'Click to download Gemini Nano (one time). Until then, feedback uses cloud Gemini.'
        : 'This browser cannot run Gemini Nano. Feedback uses cloud Gemini through Firebase AI Logic.';
  d.onclick =
    state.device === 'downloadable'
      ? async () => {
          state.downloading = 0;
          renderEngine();
          try {
            await downloadDeviceModel((p) => {
              state.downloading = p;
              renderEngine();
            });
          } catch (e) {
            console.warn('Nano download failed', e);
          }
          state.downloading = null;
          state.device = await deviceState();
          renderEngine();
        }
      : null;
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
}

function sourceBadge(source: string, ms: number) {
  const dev = source === 'on_device';
  const t = ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
  return `<span class="badge ${dev ? 'dev' : 'cloud'}">${dev ? 'On-device · Gemini Nano' : 'Cloud · Gemini'} · ${t}</span>`;
}

function aiErrorText(e: unknown): string {
  const msg = String((e as Error)?.message || e);
  if (!state.online && state.mode !== 'only_on_device')
    return 'You are offline and Gemini Nano is not available in this browser, so AI feedback is paused. Your word-by-word mark above is still exact.';
  if (/API_NOT_ENABLED|not available/i.test(msg)) return 'On-device only mode needs Chrome with Gemini Nano. Switch to "Prefer on-device" to use the cloud fallback.';
  return 'AI feedback is unavailable right now. Your word-by-word mark above is still exact.';
}

// ---------------- dictation ----------------
let voice: SpeechSynthesisVoice | null = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  const pref = ['en-AU', 'en-GB', 'en-US'];
  voice =
    pref.map((l) => vs.find((v) => v.lang === l && v.localService)).find(Boolean) ||
    vs.find((v) => v.localService) ||
    vs[0] ||
    null;
}
speechSynthesis.onvoiceschanged = pickVoice;
pickVoice();

function speak(text: string, onEnd?: () => void) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.lang = voice?.lang || 'en-AU';
  u.rate = state.rate;
  u.onend = () => onEnd?.();
  speechSynthesis.speak(u);
}

function currentDictation(): DictationItem {
  if (state.flow && state.flow.phase !== 'done') return state.flow.queue[state.flow.index];
  return DICTATION_ITEMS[state.dIndex];
}

function flowBanner(): string {
  const f = state.flow;
  if (!f) return '';
  if (f.phase === 'done') return '';
  const pos = f.index < 3 ? f.index + 1 : f.index - 2;
  return `<div class="flowbar">
    <div><strong>Flow · ${CATEGORY_SHORT[f.weakness]}</strong> — ${f.phase === 'train' ? 'Train' : 'Re-test on new sentences'} ${pos}/3</div>
    <div class="steps">${[0, 1, 2, 3, 4, 5].map((i) => `<i class="${i < f.index ? 'done' : i === f.index ? 'now' : ''} ${i >= 3 ? 'rt' : ''}"></i>`).join('')}</div>
    <button class="link" id="quitFlow">Exit Flow</button>
  </div>`;
}

function renderDictation() {
  const item = currentDictation();
  const skills = itemSkills(item.text);
  state.plays = 0;
  $('#view').innerHTML = `
  ${flowBanner()}
  <section class="card">
    <div class="row between">
      <div>
        <div class="eyebrow">Write From Dictation · ${state.flow ? 'Flow drill' : `Sentence ${state.dIndex + 1} of ${DICTATION_ITEMS.length}`}</div>
        <h1>Listen, then type the sentence exactly.</h1>
      </div>
      <div class="chips">${skills.map((s) => `<span class="chip">${CATEGORY_SHORT[s]}</span>`).join('')}</div>
    </div>
    <div class="player">
      <button id="play" class="play" aria-label="Play sentence"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
      <div>
        <div id="plays" class="muted">Press play or Ctrl+Space. You can replay twice.</div>
        <div class="rates">Speed
          ${[0.8, 0.95, 1.1].map((r) => `<button class="rate ${r === state.rate ? 'on' : ''}" data-rate="${r}">${r === 0.95 ? 'Normal' : r < 0.95 ? 'Slow' : 'Fast'}</button>`).join('')}
        </div>
      </div>
    </div>
    <label class="sr" for="answer">Your answer</label>
    <textarea id="answer" rows="3" placeholder="Type what you heard…" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
    <div class="row between">
      <span class="muted small">Press Enter to check. Spell-check is off, like the real test.</span>
      <div class="row">
        ${state.flow ? '' : '<button id="skip" class="ghost">Skip</button>'}
        <button id="check" class="primary">Check answer</button>
      </div>
    </div>
  </section>
  <section id="result"></section>`;

  const play = () => {
    if (state.plays >= 3) return;
    state.plays++;
    $('#plays').textContent = state.plays >= 3 ? 'No replays left.' : `Played ${state.plays}×. ${3 - state.plays} play${3 - state.plays === 1 ? '' : 's'} left.`;
    $('#play').classList.add('playing');
    speak(item.text, () => $('#play')?.classList.remove('playing'));
    if (state.device === 'available') warmUp(state.mode);
    $<HTMLTextAreaElement>('#answer').focus();
  };
  $('#play').onclick = play;
  document.querySelectorAll<HTMLButtonElement>('.rate').forEach((b) => {
    b.onclick = () => {
      state.rate = Number(b.dataset.rate);
      document.querySelectorAll('.rate').forEach((x) => x.classList.toggle('on', x === b));
    };
  });
  const ta = $<HTMLTextAreaElement>('#answer');
  ta.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      check();
    }
    if (e.key === ' ' && e.ctrlKey) {
      e.preventDefault();
      play();
    }
  };
  $('#check').onclick = check;
  const skip = document.getElementById('skip');
  if (skip) skip.onclick = () => nextDictation();
  const quit = document.getElementById('quitFlow');
  if (quit) quit.onclick = () => ((state.flow = null), render());

  async function check() {
    const answer = ta.value.trim();
    if (!answer) {
      ta.focus();
      return;
    }
    speechSynthesis.cancel();
    ta.readOnly = true;
    $<HTMLButtonElement>('#check').disabled = true;
    const r = mark(item.text, answer);
    showMark(item, answer, r);
  }
}

function showMark(item: DictationItem, answer: string, r: MarkResult) {
  const pct = Math.round(r.accuracy * 100);
  const lostChips = WEAKNESSES.filter((c) => r.lost[c] > 0)
    .map((c) => `<span class="chip lost">−${r.lost[c]} ${CATEGORY_SHORT[c]}</span>`)
    .join('');
  const tokenHtml = r.tokens
    .map((t) => {
      if (t.status === 'correct') return `<span class="tok ok">${esc(t.ref!)}</span>`;
      if (t.status === 'extra') return `<span class="tok extra" title="Extra word, no penalty">${esc(t.typed!)}</span>`;
      return `<span class="tok bad" title="${esc(CATEGORY_LABEL[t.category!])}">${t.typed ? `<s>${esc(t.typed)}</s>` : '<s>—</s>'}<b>${esc(t.ref!)}</b></span>`;
    })
    .join(' ');
  const inFlow = !!state.flow && state.flow.phase !== 'done';
  $('#result').innerHTML = `
  <div class="card result">
    <div class="row between">
      <div class="score"><div class="ring" style="--p:${pct}"><span>${r.score}<small>/${r.total}</small></span></div>
        <div><div class="eyebrow">Word-by-word mark</div><div class="big">${pct === 100 ? 'Perfect!' : pct >= 80 ? 'Nearly there' : pct >= 50 ? 'Good effort' : 'Keep going'}</div>
        <div class="chips">${lostChips || '<span class="chip okc">No points lost</span>'}</div></div>
      </div>
      <button id="next" class="primary">${inFlow ? 'Next in Flow →' : 'Next sentence →'}</button>
    </div>
    <div class="tokens">${tokenHtml}</div>
    <div class="ai" id="ai"><div class="eyebrow">AI feedback</div><div class="skeleton"></div><div class="skeleton short"></div></div>
  </div>`;
  $('#next').onclick = () => nextDictation();
  $<HTMLButtonElement>('#next').focus();

  const attempt: Attempt = {
    type: 'dictation',
    itemId: item.id,
    score: r.score,
    total: r.total,
    accuracy: r.accuracy,
    lost: r.lost,
    mistakes: r.mistakes,
    inferenceSource: null,
    flow: inFlow ? (state.flow!.phase as 'train' | 'retest') : null,
    clientTime: Date.now(),
  };
  if (inFlow) state.flow!.results.push({ phase: state.flow!.phase as 'train' | 'retest', lost: r.lost[state.flow!.weakness], accuracy: r.accuracy });

  dictationTip(item.text, answer, r, state.mode)
    .then(({ data, source, ms }) => {
      attempt.inferenceSource = source;
      const notes = (data.notes || [])
        .filter((n) => n.word && n.note)
        .map((n) => `<li><b>${esc(n.word)}</b> — ${esc(n.note)}</li>`)
        .join('');
      $('#ai').innerHTML = `<div class="row between"><div class="eyebrow">AI feedback</div>${sourceBadge(source, ms)}</div>
        ${notes ? `<ul class="notes">${notes}</ul>` : ''}
        <p class="tip"><span>Tip</span>${esc(data.tip || '')}</p>`;
    })
    .catch((e) => {
      console.warn(e);
      const el = document.getElementById('ai');
      if (el) el.innerHTML = `<div class="eyebrow">AI feedback</div><p class="muted">${esc(aiErrorText(e))}</p>`;
    })
    .finally(() => record(attempt));
}

function record(a: Attempt) {
  state.attempts.unshift(a);
  if (state.uid) saveAttempt(state.uid, a).catch((e) => console.warn('save failed (will retry when online)', e));
}

function nextDictation() {
  const f = state.flow;
  if (f && f.phase !== 'done') {
    f.index++;
    if (f.index === 3) f.phase = 'retest';
    if (f.index >= f.queue.length) {
      f.phase = 'done';
      state.tab = 'coach';
    }
  } else {
    state.dIndex = (state.dIndex + 1) % DICTATION_ITEMS.length;
    localStorageSet('dIndex', String(state.dIndex));
  }
  render();
}

// ---------------- short writing ----------------
function renderWriting() {
  const item = WRITING_ITEMS[state.wIndex];
  $('#view').innerHTML = `
  <section class="card">
    <div class="eyebrow">Short writing · Task ${state.wIndex + 1} of ${WRITING_ITEMS.length}</div>
    <h1>${esc(item.prompt)}</h1>
    <p class="muted">Write ${item.minWords}–${item.maxWords} words. Feedback is private: with Gemini Nano your text never leaves this device.</p>
    <textarea id="wtext" rows="6" placeholder="Start writing…" spellcheck="false"></textarea>
    <div class="row between">
      <span id="wc" class="muted small">0 words</span>
      <div class="row"><button id="wskip" class="ghost">Another task</button><button id="wcheck" class="primary">Check my writing</button></div>
    </div>
  </section>
  <section id="wresult"></section>`;
  const ta = $<HTMLTextAreaElement>('#wtext');
  const wc = $('#wc');
  ta.oninput = () => {
    const n = words(ta.value).length;
    wc.textContent = `${n} word${n === 1 ? '' : 's'}`;
    wc.className = 'small ' + (n >= item.minWords && n <= item.maxWords ? 'good' : 'muted');
  };
  $('#wskip').onclick = () => {
    state.wIndex = (state.wIndex + 1) % WRITING_ITEMS.length;
    localStorageSet('wIndex', String(state.wIndex));
    render();
  };
  $('#wcheck').onclick = async () => {
    const text = ta.value.trim();
    const n = words(text).length;
    if (n < 5) {
      ta.focus();
      return;
    }
    const btn = $<HTMLButtonElement>('#wcheck');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    $('#wresult').innerHTML = `<div class="card"><div class="eyebrow">AI feedback</div><div class="skeleton"></div><div class="skeleton short"></div></div>`;
    try {
      const { data, source, ms } = await writingCheck(item.prompt, text, state.mode);
      const issues = (data.issues || []).filter((i) => i.original && i.suggestion && i.original !== i.suggestion);
      let marked = esc(text);
      for (const i of issues) marked = marked.replace(esc(i.original), `<mark>${esc(i.original)}</mark>`);
      const lost: Attempt['lost'] = {};
      for (const i of issues) lost[i.type] = (lost[i.type] || 0) + 1;
      $('#wresult').innerHTML = `<div class="card result">
        <div class="row between"><div><div class="eyebrow">AI feedback</div><div class="big">${issues.length ? `${issues.length} thing${issues.length > 1 ? 's' : ''} to fix` : 'Clean answer!'}</div></div>${sourceBadge(source, ms)}</div>
        <p class="answer">${marked}</p>
        ${issues.length ? `<ul class="issues">${issues.map((i) => `<li><span class="chip">${esc(i.type.replace('_', ' '))}</span><s>${esc(i.original)}</s> → <b>${esc(i.suggestion)}</b></li>`).join('')}</ul>` : ''}
        <p class="tip"><span>Tip</span>${esc(data.tip || '')}</p>
        <p class="muted small">${n} words${n < item.minWords || n > item.maxWords ? ` · aim for ${item.minWords}–${item.maxWords}` : ''}</p>
      </div>`;
      record({
        type: 'writing',
        itemId: item.id,
        score: Math.max(0, 10 - issues.length * 2),
        total: 10,
        accuracy: Math.max(0, 10 - issues.length * 2) / 10,
        lost,
        mistakes: issues.map((i) => ({ expected: i.suggestion, typed: i.original, category: i.type })),
        inferenceSource: source,
        clientTime: Date.now(),
      });
    } catch (e) {
      console.warn(e);
      $('#wresult').innerHTML = `<div class="card"><div class="eyebrow">AI feedback</div><p class="muted">${esc(aiErrorText(e).replace(' Your word-by-word mark above is still exact.', ''))}</p></div>`;
    }
    btn.disabled = false;
    btn.textContent = 'Check again';
  };
}

// ---------------- coach & flow ----------------
function totals() {
  const d = state.attempts.filter((a) => a.type === 'dictation');
  const lost: Record<MistakeCategory, number> = { ending: 0, spelling: 0, small: 0, missed: 0 };
  for (const a of d) for (const c of WEAKNESSES) lost[c] += (a.lost as Record<string, number>)[c] || 0;
  const words = d.reduce((s, a) => s + a.total, 0);
  const got = d.reduce((s, a) => s + a.score, 0);
  const w = state.attempts.filter((a) => a.type === 'writing');
  const wl: Record<string, number> = {};
  for (const a of w) for (const [k, v] of Object.entries(a.lost)) wl[k] = (wl[k] || 0) + (v || 0);
  const onDevice = state.attempts.filter((a) => a.inferenceSource === 'on_device').length;
  return { d, w, lost, words, got, wl, onDevice };
}

function topWeakness(lost: Record<MistakeCategory, number>): MistakeCategory {
  return WEAKNESSES.reduce((a, b) => (lost[b] > lost[a] ? b : a), 'missed' as MistakeCategory);
}

function buildSummary(): string {
  const t = totals();
  const examples = t.d
    .flatMap((a) => a.mistakes)
    .slice(0, 25)
    .map((m) => `${m.category}: expected "${m.expected}" typed ${m.typed ? `"${m.typed}"` : 'nothing'}`)
    .join('\n');
  const wex = t.w
    .flatMap((a) => a.mistakes)
    .slice(0, 12)
    .map((m) => `${m.category}: "${m.typed}" -> "${m.expected}"`)
    .join('\n');
  return `Dictation attempts: ${t.d.length}, words correct ${t.got}/${t.words}.
Points lost by category: ${WEAKNESSES.map((c) => `${c} (${CATEGORY_LABEL[c]}) = ${t.lost[c]}`).join('; ')}.
Recent dictation mistakes:
${examples || 'none'}
Short writing attempts: ${t.w.length}. Issues by type: ${JSON.stringify(t.wl)}.
Recent writing issues:
${wex || 'none'}`;
}

function renderCoach() {
  const t = totals();
  const max = Math.max(1, ...WEAKNESSES.map((c) => t.lost[c]));
  const top = topWeakness(t.lost);
  const totalLost = WEAKNESSES.reduce((s, c) => s + t.lost[c], 0);
  const f = state.flow;
  let flowResult = '';
  if (f && f.phase === 'done') {
    const tr = f.results.filter((r) => r.phase === 'train');
    const rt = f.results.filter((r) => r.phase === 'retest');
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const before = f.baseline;
    const after = avg(rt.map((r) => r.lost));
    const accAfter = avg(rt.map((r) => r.accuracy));
    const better = after < before && accAfter >= f.baselineAcc - 0.05;
    const worse = after > before || accAfter < f.baselineAcc - 0.1;
    flowResult = `<section class="card flowdone">
      <div class="eyebrow">Flow complete · ${CATEGORY_LABEL[f.weakness]}</div>
      <div class="big">${better ? 'Your weak spot is costing fewer points.' : worse ? 'This one needs another round.' : 'Holding steady. One more Flow will lock it in.'}</div>
      <div class="compare">
        <div><span>${before.toFixed(1)} → ${after.toFixed(1)}</span>${CATEGORY_SHORT[f.weakness]} points lost per sentence, before → re-test</div>
        <div><span>${avg(tr.map((r) => r.lost)).toFixed(1)}</span>${CATEGORY_SHORT[f.weakness]} points lost while training</div>
        <div class="${accAfter > f.baselineAcc ? 'up' : ''}"><span>${Math.round(f.baselineAcc * 100)}% → ${Math.round(accAfter * 100)}%</span>word accuracy, before → re-test</div>
        <div><span>${rt.length}</span>new sentences in the re-test</div>
      </div>
      <div class="row"><button class="primary" id="again">Run another Flow</button><button class="ghost" id="clearFlow">Done</button></div>
    </section>`;
  }
  $('#view').innerHTML = `
  ${flowResult}
  <section class="grid3">
    <div class="card stat"><div class="eyebrow">Sentences practised</div><div class="num">${t.d.length}</div></div>
    <div class="card stat"><div class="eyebrow">Word accuracy</div><div class="num">${t.words ? Math.round((t.got / t.words) * 100) : 0}%</div></div>
    <div class="card stat"><div class="eyebrow">Feedback on-device</div><div class="num">${state.attempts.length ? Math.round((t.onDevice / state.attempts.length) * 100) : 0}%</div></div>
  </section>
  <section class="card">
    <div class="row between"><div><div class="eyebrow">Where your points go</div><h1>${totalLost ? `${CATEGORY_LABEL[top]} cost you the most` : 'Practise a few sentences to see your pattern'}</h1></div></div>
    <div class="bars">${WEAKNESSES.map(
      (c) => `<div class="bar ${c === top && totalLost ? 'top' : ''}"><span>${CATEGORY_LABEL[c]}</span><div><i style="width:${(t.lost[c] / max) * 100}%"></i></div><b>${t.lost[c]}</b></div>`,
    ).join('')}</div>
  </section>
  <section class="card">
    <div class="row between">
      <div><div class="eyebrow">Coach report · Cloud Gemini via Firebase AI Logic</div><h1>Find the weakness costing the most points</h1>
      <p class="muted">The coach reads your whole mistake history, explains the pattern and plans your next session. Then <b>Start Flow</b>: train that weakness on 3 sentences and re-test on 3 new ones.</p></div>
    </div>
    <div class="row">
      <button id="report" class="primary" ${!state.online || state.attempts.length < 3 ? 'disabled' : ''}>Get my coach report</button>
      <button id="flow" class="accent" ${t.d.length < 1 ? 'disabled' : ''}>Start Flow</button>
    </div>
    <p class="muted small">${!state.online ? 'The coach needs internet. Practice and instant feedback keep working.' : state.attempts.length < 3 ? 'Do at least 3 exercises first.' : ''}</p>
    <div id="reportOut">${state.report ? reportHtml(state.report) : ''}</div>
  </section>`;

  const btn = $<HTMLButtonElement>('#report');
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Analysing…';
    $('#reportOut').innerHTML = `<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton short"></div>`;
    try {
      const { data, ms } = await coachReport(buildSummary());
      if (!WEAKNESSES.includes(data.weakness)) data.weakness = top;
      state.report = data;
      $('#reportOut').innerHTML = reportHtml(data, ms);
      if (state.uid) savePlan(state.uid, data).catch(() => {});
    } catch (e) {
      console.warn(e);
      $('#reportOut').innerHTML = `<p class="muted">The coach could not answer right now. Try again in a moment.</p>`;
    }
    btn.disabled = false;
    btn.textContent = 'Refresh report';
  };
  $('#flow').onclick = () => startFlow(state.report?.weakness || top);
  const again = document.getElementById('again');
  if (again) again.onclick = () => startFlow(state.report?.weakness || top);
  const clear = document.getElementById('clearFlow');
  if (clear) clear.onclick = () => ((state.flow = null), render());
}

function reportHtml(r: CoachReport, ms?: number) {
  return `<div class="report">
    <div class="row between"><div class="big">${esc(r.headline)}</div>${ms ? sourceBadge('in_cloud', ms) : ''}</div>
    <div class="chips"><span class="chip lost">Focus: ${CATEGORY_LABEL[r.weakness]}</span></div>
    <p>${esc(r.why)}</p>
    <div class="two">
      <div><div class="eyebrow">Rules to remember</div><ul>${(r.rules || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div><div class="eyebrow">Next session</div><ol>${(r.plan || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>
    </div>
    ${r.writingFocus ? `<p class="tip"><span>Writing</span>${esc(r.writingFocus)}</p>` : ''}
  </div>`;
}

function startFlow(weakness: MistakeCategory) {
  const t = totals();
  const seen = new Set(state.attempts.map((a) => a.itemId));
  const fit = DICTATION_ITEMS.filter((i) => itemSkills(i.text).includes(weakness));
  const fresh = fit.filter((i) => !seen.has(i.id));
  const pool = [...shuffle(fresh), ...shuffle(fit.filter((i) => seen.has(i.id)))];
  const others = shuffle(DICTATION_ITEMS.filter((i) => !pool.includes(i)));
  const queue = [...pool, ...others].slice(0, 6);
  const d = t.d.filter((a) => !a.flow);
  state.flow = {
    weakness,
    phase: 'train',
    queue,
    index: 0,
    baseline: d.length ? d.reduce((s, a) => s + ((a.lost as Record<string, number>)[weakness] || 0), 0) / d.length : 0,
    baselineAcc: d.length ? d.reduce((s, a) => s + a.score, 0) / Math.max(1, d.reduce((s, a) => s + a.total, 0)) : 0,
    results: [],
  };
  state.tab = 'dictation';
  render();
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------- boot ----------------
function render() {
  renderEngine();
  if (state.tab === 'dictation') renderDictation();
  else if (state.tab === 'writing') renderWriting();
  else renderCoach();
}

render();
(async () => {
  state.device = await deviceState();
  renderEngine();
  await loadRemoteConfig();
  const user = await ensureUser();
  if (user) {
    state.uid = user.uid;
    try {
      state.attempts = [...state.attempts, ...(await loadAttempts(user.uid))];
      if (state.tab === 'coach') render();
    } catch (e) {
      console.warn('history unavailable', e);
    }
  }
})();
