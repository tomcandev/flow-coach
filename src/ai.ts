// All generative AI in Flow Coach goes through Firebase AI Logic (firebase/ai).
//
// 1. Instant feedback (after every answer): a HYBRID model.
//    mode PREFER_ON_DEVICE -> Gemini Nano in Chrome (Prompt API) when available,
//    otherwise the SDK falls back to a cloud Gemini model. The response tells us
//    which one answered (response.inferenceSource), and the UI shows it.
// 2. Coach report + Flow plan (on demand): a CLOUD model with a typed response schema,
//    reasoning over the learner's whole mistake history.

import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  Schema,
  type GenerativeModel,
} from 'firebase/ai';
import { app, rcString } from './firebase';
import { CATEGORY_LABEL, type MarkResult, type MistakeCategory } from './scoring';

export const ai = getAI(app, { backend: new GoogleAIBackend() });

export type Mode = (typeof InferenceMode)[keyof typeof InferenceMode];
export const MODES: { value: Mode; label: string }[] = [
  { value: InferenceMode.PREFER_ON_DEVICE, label: 'Prefer on-device (hybrid)' },
  { value: InferenceMode.ONLY_ON_DEVICE, label: 'On-device only' },
  { value: InferenceMode.ONLY_IN_CLOUD, label: 'Cloud only' },
];

const EN = [{ type: 'text' as const, languages: ['en'] }];

// ---------- Hybrid model #1: dictation tip ----------
const tipJsonSchema = {
  type: 'object',
  properties: {
    tip: { type: 'string', description: 'One practical tip, max 25 words' },
    notes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { word: { type: 'string' }, note: { type: 'string' } },
        required: ['word', 'note'],
      },
    },
  },
  required: ['tip', 'notes'],
};
const tipCloudSchema = Schema.object({
  properties: {
    tip: Schema.string(),
    notes: Schema.array({ items: Schema.object({ properties: { word: Schema.string(), note: Schema.string() } }) }),
  },
});

// ---------- Hybrid model #2: short writing check ----------
const ISSUE_TYPES = ['grammar', 'spelling', 'word_choice', 'punctuation'] as const;
const writingJsonSchema = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          original: { type: 'string' },
          suggestion: { type: 'string' },
          type: { type: 'string', enum: [...ISSUE_TYPES] },
        },
        required: ['original', 'suggestion', 'type'],
      },
    },
    tip: { type: 'string' },
  },
  required: ['issues', 'tip'],
};
const writingCloudSchema = Schema.object({
  properties: {
    issues: Schema.array({
      items: Schema.object({
        properties: {
          original: Schema.string(),
          suggestion: Schema.string(),
          type: Schema.enumString({ enum: [...ISSUE_TYPES] }),
        },
      }),
    }),
    tip: Schema.string(),
  },
});

const cache = new Map<string, GenerativeModel>();
function hybridModel(kind: 'tip' | 'writing', mode: Mode): GenerativeModel {
  const key = `${kind}:${mode}`;
  let m = cache.get(key);
  if (!m) {
    m = getGenerativeModel(ai, {
      mode,
      onDeviceParams: {
        createOptions: { expectedInputs: EN, expectedOutputs: EN },
        promptOptions: { responseConstraint: kind === 'tip' ? tipJsonSchema : writingJsonSchema },
      },
      inCloudParams: {
        model: rcString('hybrid_cloud_model'),
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: kind === 'tip' ? tipCloudSchema : writingCloudSchema,
          temperature: 0.3,
        },
      },
    });
    cache.set(key, m);
  }
  return m;
}

// ---------- On-device availability (for the status pill and the download button) ----------
export type DeviceState = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api';
interface LanguageModelStatic {
  availability(o?: unknown): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
}
export async function deviceState(): Promise<DeviceState> {
  const LM = (globalThis as unknown as { LanguageModel?: LanguageModelStatic }).LanguageModel;
  if (!LM) return 'no-api';
  try {
    return await LM.availability({ expectedInputs: EN, expectedOutputs: EN });
  } catch {
    return 'unavailable';
  }
}
/** Must be called from a user gesture (click). Downloads Gemini Nano if needed. */
export async function downloadDeviceModel(onProgress: (p: number) => void): Promise<void> {
  await hybridModel('tip', InferenceMode.PREFER_ON_DEVICE).initializeDeviceModel(onProgress);
}

export interface AiResult<T> {
  data: T;
  source: 'on_device' | 'in_cloud';
  ms: number;
}

function parseJson<T>(text: string): T {
  const clean = text.trim().replace(/^```(json)?/i, '').replace(/```$/, '');
  return JSON.parse(clean) as T;
}

async function run<T>(kind: 'tip' | 'writing', mode: Mode, prompt: string): Promise<AiResult<T>> {
  const t0 = performance.now();
  const res = await hybridModel(kind, mode).generateContent(prompt);
  const ms = Math.round(performance.now() - t0);
  return {
    data: parseJson<T>(res.response.text()),
    source: (res.response.inferenceSource as 'on_device' | 'in_cloud') ?? 'in_cloud',
    ms,
  };
}

export interface Tip {
  tip: string;
  notes: { word: string; note: string }[];
}
export function dictationTip(reference: string, answer: string, r: MarkResult, mode: Mode) {
  const list = r.mistakes
    .slice(0, 6)
    .map((m) => `- expected "${m.expected}", learner wrote ${m.typed ? `"${m.typed}"` : 'nothing'} (${CATEGORY_LABEL[m.category]})`)
    .join('\n');
  const prompt = `You are a friendly English test coach. A learner did a dictation exercise.
Correct sentence: "${reference}"
Learner typed: "${answer}"
Score: ${r.score}/${r.total} words.
Mistakes found by the marker:
${list || '- none'}

Return JSON. "notes": one note per mistake (max 15 words), with "word" = the expected word. Explain the fix: the grammar rule (agreement, plural, tense, article) or the spelling pattern the learner got wrong, or a listening cue. Never say a misspelled word is correct. "tip": one practical tip (max 25 words) for the next sentence. If there are no mistakes, give an encouraging tip and empty notes. Do not repeat the whole sentence.`;
  return run<Tip>('tip', mode, prompt);
}

export interface WritingCheck {
  issues: { original: string; suggestion: string; type: (typeof ISSUE_TYPES)[number] }[];
  tip: string;
}
export function writingCheck(task: string, text: string, mode: Mode) {
  const prompt = `You are an English writing tutor for test takers. Check this short answer.
Task: "${task}"
Answer: "${text}"

Return JSON. "issues": up to 6 real errors only. "original" must be the exact words copied from the answer, "suggestion" the corrected words, "type" one of grammar, spelling, word_choice, punctuation. Do not flag correct British or American spelling. "tip": one sentence (max 25 words) on how to make this answer stronger.`;
  return run<WritingCheck>('writing', mode, prompt);
}

// ---------- Cloud coach: deeper analysis + "Start Flow" plan ----------
export const WEAKNESSES: MistakeCategory[] = ['ending', 'spelling', 'small', 'missed'];
const coachSchema = Schema.object({
  properties: {
    headline: Schema.string({ description: 'One sentence summary of where points are being lost' }),
    weakness: Schema.enumString({ enum: WEAKNESSES, description: 'The category costing the most points' }),
    why: Schema.string({ description: 'Explain the pattern behind the mistakes, 2-3 sentences, quote the learner examples' }),
    rules: Schema.array({ items: Schema.string(), description: '3 short rules or listening cues that fix this weakness' }),
    writingFocus: Schema.string({ description: 'One sentence on the main short-writing issue, or empty if no writing data' }),
    plan: Schema.array({ items: Schema.string(), description: '3 concrete steps for the next practice session' }),
  },
});

export interface CoachReport {
  headline: string;
  weakness: MistakeCategory;
  why: string;
  rules: string[];
  writingFocus: string;
  plan: string[];
}

export async function coachReport(summary: string): Promise<AiResult<CoachReport>> {
  const prompt = `Here is a learner's recent practice history. Points lost per category are exact counts from a deterministic marker.\n\n${summary}\n\nFind the weakness that costs the most points (prefer the largest count unless the examples clearly show a different root cause), explain it, and plan the next session.`;
  const ask = async (modelName: string, timeout: number) => {
    const model = getGenerativeModel(
      ai,
      {
        model: modelName,
        systemInstruction:
          'You are an expert coach for English proficiency tests (PTE, IELTS). You are precise, kind and practical. Base every claim on the data given.',
        generationConfig: { responseMimeType: 'application/json', responseSchema: coachSchema, temperature: 0.4 },
      },
      { timeout },
    );
    const t0 = performance.now();
    const res = await model.generateContent(prompt);
    return { data: parseJson<CoachReport>(res.response.text()), source: 'in_cloud' as const, ms: Math.round(performance.now() - t0) };
  };
  // The bigger model reasons better; if it is slow or busy, the lighter cloud model answers instead.
  try {
    return await ask(rcString('coach_model'), 25_000);
  } catch (e) {
    console.warn('coach model slow or unavailable, using the light model', e);
    return await ask(rcString('hybrid_cloud_model'), 60_000);
  }
}

// Loading Gemini Nano into memory takes a while the first time. We warm it up while the
// learner is still listening, so the feedback is ready by the time they press Enter.
let warmed: Promise<unknown> | null = null;
export function warmUp(mode: Mode): void {
  if (warmed || mode === InferenceMode.ONLY_IN_CLOUD) return;
  warmed = hybridModel('tip', mode)
    .generateContent('Reply with {"tip":"ready","notes":[]}')
    .catch(() => (warmed = null));
}
