/**
 * useI18nStore.ts — Lightweight i18n for Bedaar AI (English + Urdu).
 *
 * The store holds:
 *   - `language`   — current locale ('en' | 'ur')
 *   - `t(key)`     — translate a key to the active locale string
 *   - `setLanguage`— switch locale (persists to AsyncStorage)
 *
 * On first launch, `language` is null until the user picks one.
 * The LanguageSelectionModal in App.tsx handles that flow.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../services/storageService';

// ---------------------------------------------------------------------------
// Storage key (shared with storageService)
// ---------------------------------------------------------------------------

export const LANGUAGE_STORAGE_KEY = STORAGE_KEYS.APP_LANGUAGE;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Language = 'en' | 'ur';

// ---------------------------------------------------------------------------
// Translation dictionaries
// ---------------------------------------------------------------------------

const en = {
  // ── Language modal ──────────────────────────────────────────────────────
  selectLanguage: 'Select Language',
  selectLanguageUrdu: '\u0632\u0628\u0627\u0646 \u06A9\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0631\u06CC\u06BA',
  english: 'English',
  urdu: '\u0627\u0631\u062F\u0648 (Urdu)',

  // ── Loading / permissions ──────────────────────────────────────────────
  initializing: 'Initializing Camera & Bedaar AI...',
  grantCameraAccess: 'Grant Camera Access',

  // ── Metrics bar ────────────────────────────────────────────────────────
  cal: 'CAL',
  ready: 'READY',
  ear: 'EAR',
  mar: 'MAR',
  head: 'HEAD',
  lux: 'LUX',

  // ── Hazard badges ──────────────────────────────────────────────────────
  drowsy: 'DROWSY',
  yawn: 'YAWN',
  distract: 'DISTRACT',
  night: 'NIGHT',

  // ── Toolbar ────────────────────────────────────────────────────────────
  settings: 'Settings',
  recalibrate: 'Recalibrate',
  testCrash: 'Test Crash',
  language: 'Language',

  // ── Settings drawer (Driver Profile) ───────────────────────────────────
  driverProfile: 'Driver Profile',
  driverName: 'Driver Name',
  bloodGroup: 'Blood Group',
  guardianPhone: 'Guardian Phone',
  phonePlaceholder: '03XXXXXXXXX',
  namePlaceholder: 'e.g. Ahmed Khan',
  phoneError: 'Phone must be exactly 11 digits',
  saveProfile: 'Save Profile',
  saved: '\u2713  Saved',

  // ── Emergency modal ────────────────────────────────────────────────────
  crashDetected: 'CRASH DETECTED',
  emergencyContactIn: 'Emergency services will be contacted in',
  seconds: 'seconds',
  iAmOk: 'I AM OK',
  tapToCancel: 'Tap above if you are safe to cancel the alert',

  // ── Onboarding ─────────────────────────────────────────────────────────
  welcomeTitle: 'Welcome to Bedaar AI',
  welcomeSubtitle: 'Complete your profile to get started',
  onboardingName: 'Your Name',
  onboardingBlood: 'Blood Group',
  onboardingPhone: 'Guardian Emergency Number',
  onboardingPhoneHint: 'Enter 11-digit number (e.g. 03001234567)',
  onboardingSave: 'Save & Start',
  onboardingSkip: 'You can update anytime from Settings',
  onboardingRequired: 'All fields are required',
  onboardingPhoneError: 'Phone must be exactly 11 digits',

  // ── Error boundary ─────────────────────────────────────────────────────
  somethingWentWrong: 'Something went wrong',
  restartOrLogcat: 'Restart the app or check logcat for details.',
} as const;

const ur: Record<keyof typeof en, string> = {
  // ── Language modal ──────────────────────────────────────────────────────
  selectLanguage: '\u0632\u0628\u0627\u0646 \u06A9\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0631\u06CC\u06BA',
  selectLanguageUrdu: '',
  english: 'English',
  urdu: '\u0627\u0631\u062F\u0648',

  // ── Loading / permissions ──────────────────────────────────────────────
  initializing: '\u06A9\u06CC\u0645\u0631\u0627 \u0627\u0648\u0631 \u0628\u06CC\u062F\u0627\u0631 \u0627\u06CC\u0622\u0626\u06CC \u0634\u0631\u0648\u0639 \u06C1\u0648 \u0631\u06C1\u0627 \u06C1\u06D2...',
  grantCameraAccess: '\u06A9\u06CC\u0645\u0631\u0627 \u062A\u06A9 \u0631\u0633\u0627\u0626\u06CC \u062F\u06CC\u06BA',

  // ── Metrics bar ────────────────────────────────────────────────────────
  cal: '\u06A9\u06CC\u0644\u06CC\u0628\u0631\u06CC\u0634\u0646',
  ready: '\u062A\u06CC\u0627\u0631',
  ear: '\u0622\u0646\u06A9\u06BE',
  mar: '\u0645\u0646\u06C1',
  head: '\u0633\u0631',
  lux: '\u0631\u0648\u0634\u0646\u06CC',

  // ── Hazard badges ──────────────────────────────────────────────────────
  drowsy: '\u0646\u06CC\u0646\u062F',
  yawn: '\u062C\u0645\u0627\u0626\u06CC',
  distract: '\u062A\u0648\u062C\u06C1\u06C1',
  night: '\u0631\u0627\u062A',

  // ── Toolbar ────────────────────────────────────────────────────────────
  settings: '\u062A\u0631\u062A\u06CC\u0628\u0627\u062A',
  recalibrate: '\u062F\u0648\u0628\u0627\u0631\u06C1 \u06A9\u06CC\u0644\u06CC\u0628\u0631\u06CC\u062A',
  testCrash: '\u0679\u06CC\u0633\u0679',
  language: '\u0632\u0628\u0627\u0646',

  // ── Settings drawer (Driver Profile) ───────────────────────────────────
  driverProfile: '\u0688\u0631\u0627\u0626\u06CC\u0648\u0631 \u067E\u0631\u0648\u0641\u0627\u0626\u06CC\u0644',
  driverName: '\u0688\u0631\u0627\u0626\u06CC\u0648\u0631 \u06A9\u0627 \u0646\u0627\u0645',
  bloodGroup: '\u062E\u0648\u0646 \u06A9\u0627 \u06AF\u0631\u0648\u067E',
  guardianPhone: '\u0633\u0631\u067E\u0631\u0633\u062A \u06A9\u0627 \u0641\u0648\u0646',
  phonePlaceholder: '03XXXXXXXXX',
  namePlaceholder: '\u062C\u06CC\u0633\u06D2 \u0627\u062D\u0645\u062F \u062E\u0627\u0646',
  phoneError: '\u0641\u0648\u0646 \u0628\u06CC\u0644\u06A9\u0644 11 \u06C1\u0646\u0633\u0648\u06BA \u06A9\u0627 \u06C1\u0648\u0646\u0627 \u0686\u0627\u06C1\u06CC\u06D2',
  saveProfile: '\u067E\u0631\u0648\u0641\u0627\u0626\u06CC\u0644 \u0633\u06CC\u0648 \u06A9\u0631\u06CC\u06BA',
  saved: '\u2713  \u0633\u06CC\u0648 \u06C1\u0648 \u06AF\u06CC\u0627',

  // ── Emergency modal ────────────────────────────────────────────────────
  crashDetected: '\u062D\u0627\u062F\u062B\u06C1 \u0645\u0644 \u06AF\u06CC\u0627',
  emergencyContactIn: '\u06C1\u0646\u06AF\u0627\u0645\u06CC \u062E\u062F\u0645\u0627\u062A \u0633\u06D2 \u0631\u0627\u0628\u0637\u06C1 \u06A9\u06CC\u0627 \u062C\u0627\u0626\u06D2 \u06AF\u0627',
  seconds: '\u0633\u06CC\u06A9\u0646\u0688',
  iAmOk: 'میں ٹھیک ہوں',
  tapToCancel: '\u0627\u06AF\u0631 \u0622\u067E \u0645\u062D\u0641\u0648\u0638 \u06C1\u06CC\u06BA \u062A\u0648 \u0627\u0644\u0631\u0679 \u0645\u0646\u0633\u0648\u062E \u06A9\u0631\u0646\u06D2 \u06A9\u06D2 \u0644\u06CC\u06D2 \u0627\u0648\u067E\u0631 \u062F\u0628\u0627\u0626\u06CC\u06BA',

  // ── Onboarding ─────────────────────────────────────────────────────────
  welcomeTitle: 'بیدار AI میں خوش آمدید',
  welcomeSubtitle: 'شروع کرنے کے لیے اپنی پروفائل مکمل کریں',
  onboardingName: 'آپ کا نام',
  onboardingBlood: 'خون کا گروپ',
  onboardingPhone: 'سرپرست کا ایمرجنسی نمبر',
  onboardingPhoneHint: '11 ہندسوں کا نمبر درج کریں (مثلاً 03001234567)',
  onboardingSave: 'محفوظ کریں اور شروع کریں',
  onboardingSkip: 'آپ ترتیبات سے کسی بھی وقت اپ ڈیٹ کر سکتے ہیں',
  onboardingRequired: 'تمام فیلڈز ضروری ہیں',
  onboardingPhoneError: 'فون بالکل 11 ہنسوں کا ہونا چاہیے',

  // ── Error boundary ─────────────────────────────────────────────────────
  somethingWentWrong: '\u06A9\u0686\u06BE \u063A\u0644\u062A \u06C1\u0648 \u06AF\u06CC\u0627',
  restartOrLogcat: '\u0627\u06CC\u0679 \u062F\u0648\u0628\u0627\u0631\u06C1 \u0634\u0631\u0648\u0639 \u06A9\u0631\u06CC\u06BA \u06CC\u0627 \u062A\u0641\u0635\u06CC\u0644\u0627\u062A \u06A9\u06D2 \u0644\u06CC\u06D2 logcat \u0686\u06CC\u06A9 \u06A9\u0631\u06CC\u06BA\u06D4',
};

const translations: Record<Language, Record<keyof typeof en, string>> = { en, ur };

export type TranslationKey = keyof typeof en;

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface I18nState {
  /** Current language — null until the user picks one on first launch. */
  language: Language | null;

  /** Translate a key using the active locale. */
  t: (key: TranslationKey) => string;

  /** Switch the active language and persist to AsyncStorage. */
  setLanguage: (lang: Language) => void;

  /** Hydrate language from AsyncStorage (called once at app startup). */
  loadLanguage: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useI18nStore = create<I18nState>()((set, get) => ({
  language: null,

  t: (key: TranslationKey): string => {
    const lang = get().language ?? 'en';
    return translations[lang][key] ?? translations.en[key] ?? key;
  },

  setLanguage: (lang: Language) => {
    set({ language: lang });
    AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lang).catch((err) => {
      console.warn('[I18n] Failed to persist language:', err);
    });
  },

  loadLanguage: async () => {
    try {
      const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored === 'en' || stored === 'ur') {
        set({ language: stored as Language });
      }
    } catch (err) {
      console.warn('[I18n] Failed to load language:', err);
    }
  },
}));
