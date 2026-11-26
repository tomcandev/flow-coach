import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
  doc,
  setDoc,
} from 'firebase/firestore';
import { getRemoteConfig, fetchAndActivate, getValue } from 'firebase/remote-config';
import type { MistakeCategory } from './scoring';

// Firebase web config comes from Vite env vars (.env.local, git-ignored; see .env.example).
// The values end up in the browser bundle, as for any Firebase web app. The API key is
// restricted to this site's referrers and to the Firebase APIs the app uses, and access is
// protected by App Check, Auth and Firestore security rules.
const env = import.meta.env;
function need(name: string): string {
  const v = env[name] as string | undefined;
  if (!v) throw new Error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
  return v;
}
export const firebaseConfig = {
  apiKey: need('VITE_FIREBASE_API_KEY'),
  authDomain: need('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: need('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: need('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: need('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: need('VITE_FIREBASE_APP_ID'),
};
const RECAPTCHA_ENTERPRISE_SITE_KEY = need('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY');

// Local development: set VITE_APPCHECK_DEBUG_TOKEN in .env.local (never commit it),
// or set it to "true" to have the SDK print a fresh debug token in the console.
const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined;
if (import.meta.env.DEV && debugToken) {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    debugToken === 'true' ? true : debugToken;
}

export const app = initializeApp(firebaseConfig);

// App Check must be initialised before any other Firebase service is used.
export const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});

export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  // Offline-first: attempts are written to the local cache and synced when back online.
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// Remote Config lets us switch cloud models without shipping a new build.
const rc = getRemoteConfig(app);
rc.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
rc.defaultConfig = {
  hybrid_cloud_model: 'gemini-3.5-flash-lite',
  coach_model: 'gemini-3.5-flash-lite',
};
export async function loadRemoteConfig(): Promise<void> {
  try {
    await Promise.race([fetchAndActivate(rc), new Promise((r) => setTimeout(r, 2500))]);
  } catch {
    /* defaults are fine offline */
  }
}
export const rcString = (key: 'hybrid_cloud_model' | 'coach_model') => getValue(rc, key).asString();

export function ensureUser(): Promise<User | null> {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, async (user) => {
      stop();
      if (user) return resolve(user);
      try {
        resolve((await signInAnonymously(auth)).user);
      } catch {
        resolve(null); // offline first launch: keep working locally
      }
    });
  });
}

export interface Attempt {
  type: 'dictation' | 'writing';
  itemId: string;
  score: number;
  total: number;
  accuracy: number;
  lost: Partial<Record<MistakeCategory | 'grammar' | 'word_choice' | 'punctuation', number>>;
  mistakes: { expected: string; typed: string | null; category: string }[];
  inferenceSource: string | null;
  flow?: 'train' | 'retest' | null;
  createdAt?: unknown;
  clientTime: number;
}

export async function saveAttempt(uid: string, a: Attempt): Promise<void> {
  // Not awaited by callers: with the persistent cache this resolves when the server acks,
  // but the local write is visible immediately, also offline.
  await addDoc(collection(db, 'users', uid, 'attempts'), { ...a, createdAt: serverTimestamp() });
}

export async function loadAttempts(uid: string, n = 200): Promise<Attempt[]> {
  const snap = await getDocs(query(collection(db, 'users', uid, 'attempts'), orderBy('clientTime', 'desc'), limit(n)));
  return snap.docs.map((d) => d.data() as Attempt);
}

export async function savePlan(uid: string, plan: unknown): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'plans', 'latest'), { plan, createdAt: serverTimestamp() });
}
