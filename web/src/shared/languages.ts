import type { SpeechProvider } from './transcription';
import { NEMOTRON_LOCALES } from './nemotron';
import { SONIOX_LOCALES } from './soniox';

// Snapshot of Google's model-specific tables, checked 2026-10-03.
// https://ai.google.dev/gemini-api/docs/transcribe#supported-languages
// https://ai.google.dev/gemini-api/docs/live-api/capabilities#supported-languages
const transcribeCodes = `af-ZA am-ET ar-EG hy-AM as-IN az-AZ be-BY bn-BD bn-IN bs-BA bg-BG rup-BG my-MM yue-Hant-HK ca-ES ceb km-KH hr-HR cs-CZ da-DK nl-NL en-GB en-IN en-US et-EE fa-IR fil-PH fi-FI fr-FR gl-ES ka-GE de-DE el-GR gu-IN ha-NG he-IL hi-IN hu-HU is-IS id-ID it-IT ja-JP jv-ID kea-CV kn-IN kk-KZ ko-KR ky-KG lv-LV ln-CD lt-LT mk-MK ms-MY ml-IN mt-MT cmn-Hans-CN mr-IN mn-MN ne-NP nb-NO or-IN pl-PL pt-BR pt-PT pa-IN pa-Guru-IN ro-RO ru-RU sr-RS sd-Arab-IN sk-SK sl-SI es-419 es-US sw-KE sv-SE tg-TJ te-IN th-TH tr-TR uk-UA uz-UZ vi-VN`.split(' ');
const liveCodes = `af ak sq am ar hy as az eu be bn bs bg my ca ceb zh-Hans zh-Hant hr cs da nl en et fo fil fi fr gl ka de el gu ha he hi hu is id ga it ja kn kk km rw ko ku ky lo lv lt mk ms ml mt mi mr mn ne no nb or om ps fa pl pt-BR pt-PT pa qu ro rm ru sr sd si sk sl so st es sw sv tg ta te th tn tr tk uk ur uz vi cy fy wo yo zu`.split(' ');

export interface LanguageOption { code: string; name: string }
const names = new Intl.DisplayNames(['vi'], { type: 'language' });
const overrides: Record<string, string> = {
  auto: 'Tự nhận biết ngôn ngữ',
  rup: 'Tiếng Aroman', kea: 'Tiếng Cabo Verde', ceb: 'Tiếng Cebuano',
  'cmn-Hans-CN': 'Tiếng Trung phổ thông (giản thể, Trung Quốc)',
  'yue-Hant-HK': 'Tiếng Quảng Đông (phồn thể, Hồng Kông)',
  'es-419': 'Tiếng Tây Ban Nha (Mỹ Latinh)',
  none: 'Không dịch',
};
export function canonicalLanguage(value: string): string | null {
  if (value === 'none') return 'none';
  if (value === 'auto') return 'auto';
  if (!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(value)) return null;
  try {
    const canonical = Intl.getCanonicalLocales(value)[0];
    // Google explicitly lists cmn; Intl aliases this to zh. Keep the API's
    // published code while using Intl to validate scripts/regions/variants.
    return value.split('-')[0].toLowerCase() === 'cmn' ? canonical.replace(/^zh/, 'cmn') : canonical;
  } catch { return null; }
}
export function languageName(code: string): string {
  return overrides[code] ?? overrides[code.split('-')[0]] ?? names.of(code) ?? code;
}
function catalogue(codes: string[]): LanguageOption[] {
  return [...new Set(codes.map(code => canonicalLanguage(code) ?? code))]
    .map(code => ({ code, name: languageName(code) }))
    .sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name), 'en') || a.code.localeCompare(b.code, 'en'));
}
// ICU data for 'vi' differs between Node and browsers, which reorders the list
// and breaks hydration. Fold diacritics first so the order is the same everywhere.
function sortKey(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
}
export const PRIMARY_INPUT_CODES = ['auto', 'vi-VN', 'ja-JP', 'en-US'] as const;
export const TRANSCRIBE_LANGUAGES = catalogue(transcribeCodes);
export const NEMOTRON_LANGUAGES = catalogue(NEMOTRON_LOCALES);
export const SONIOX_LANGUAGES = catalogue(SONIOX_LOCALES);
export const OUTPUT_LANGUAGES: LanguageOption[] = [
  { code: 'none', name: 'Không dịch' },
  ...catalogue([...transcribeCodes, ...liveCodes]),
];
export function inputLanguages(provider: SpeechProvider): LanguageOption[] {
  const autoOption: LanguageOption = { code: 'auto', name: 'Tự nhận biết ngôn ngữ' };
  let baseList: LanguageOption[];
  if (provider === 'soniox') baseList = SONIOX_LANGUAGES;
  else if (provider === 'nemotron') baseList = NEMOTRON_LANGUAGES;
  else baseList = TRANSCRIBE_LANGUAGES;
  return [autoOption, ...baseList];
}
export function inputLanguage(code: string, provider: SpeechProvider): string | null {
  const canonical = canonicalLanguage(code);
  if (!canonical) return null;
  if (canonical === 'auto') return 'auto';
  const list = inputLanguages(provider);
  const exact = list.find(item => item.code === canonical);
  if (exact) return exact.code;
  if (provider === 'nemotron' && ['cmn-Hans-CN', 'zh-Hans', 'zh'].includes(canonical)) return 'zh-CN';
  const aliases: Record<string, string> = { 'zh-Hans': 'cmn-Hans-CN', 'cmn-Hans-CN': 'zh-Hans' };
  const alias = list.find(item => item.code === aliases[canonical]);
  return alias?.code ?? list.find(item => item.code.split('-')[0] === canonical.split('-')[0])?.code ?? null;
}
