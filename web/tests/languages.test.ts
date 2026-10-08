import { describe, expect, it } from 'vitest';
import { canonicalLanguage, inputLanguage, inputLanguages, languageName, LIVE_LANGUAGES, NEMOTRON_LANGUAGES, OUTPUT_LANGUAGES, searchLanguages, TRANSCRIBE_LANGUAGES } from '@/shared/languages';
import { liveSpeechConfig } from '@/shared/live-speech-config';
import { FLASH_LIVE_MODEL, LIVE_TRANSCRIPTION_MODEL } from '@/shared/transcription';

describe('model language catalogues', () => {
  it('offers Soniox its 60+ languages, keeping locale aliases for Japanese and Vietnamese', () => {
    const codes = inputLanguages('soniox').map(item => item.code);
    expect(codes.length).toBeGreaterThan(60);
    expect(codes).toEqual(expect.arrayContaining(['auto', 'ja-JP', 'vi-VN', 'en', 'ko', 'zh', 'fr']));
    for (const code of ['ja', 'ja-JP']) expect(inputLanguage(code, 'soniox')).toBe('ja-JP');
    for (const code of ['vi', 'vi-VN']) expect(inputLanguage(code, 'soniox')).toBe('vi-VN');
    expect(inputLanguage('auto', 'soniox')).toBe('auto');
    expect(inputLanguage('en-US', 'soniox')).toBe('en');
    expect(inputLanguage('am-ET', 'soniox')).toBeNull();
    expect(inputLanguage('ja_JP', 'soniox')).toBeNull();
  });
  it('offers the 32 ready Nemotron locales, including Japanese and Vietnamese, without adaptation-only languages', () => {
    expect(inputLanguages('nemotron')).toEqual([{ code: 'auto', name: 'Tự nhận biết ngôn ngữ' }, ...NEMOTRON_LANGUAGES]);
    expect(NEMOTRON_LANGUAGES).toHaveLength(32);
    expect(inputLanguage('ja', 'nemotron')).toBe('ja-JP');
    expect(inputLanguage('vi', 'nemotron')).toBe('vi-VN');
    expect(inputLanguage('cmn-Hans-CN', 'nemotron')).toBe('zh-CN');
    expect(inputLanguage('auto', 'nemotron')).toBe('auto');
    expect(inputLanguage('th-TH', 'nemotron')).toBeNull();
    expect(inputLanguage('el-GR', 'nemotron')).toBeNull();
  });
  it('deduplicates the documented Transcribe locales, preserving Google codes', () => {
    expect(TRANSCRIBE_LANGUAGES).toHaveLength(83);
    expect(new Set(TRANSCRIBE_LANGUAGES.map(item => item.code)).size).toBe(83);
    expect(TRANSCRIBE_LANGUAGES.some(item => item.code === 'cmn-Hans-CN')).toBe(true);
    expect(inputLanguages('google')).toEqual([{ code: 'auto', name: 'Tự nhận biết ngôn ngữ' }, ...TRANSCRIBE_LANGUAGES]);
    expect(inputLanguages('google-flash-live')).toEqual([{ code: 'auto', name: 'Tự nhận biết ngôn ngữ' }, ...LIVE_LANGUAGES]);
  });
  it('accepts numeric regions and script-region codes and rejects malformed codes', () => {
    expect(canonicalLanguage('es-419')).toBe('es-419');
    expect(canonicalLanguage('yue-Hant-HK')).toBe('yue-Hant-HK');
    expect(canonicalLanguage('pa-Guru-IN')).toBe('pa-Guru-IN');
    for (const code of ['ja_JP', 'es-41', 'ja--JP', '<script>', 'x', 'en-1234-!']) expect(canonicalLanguage(code)).toBeNull();
  });
  it('searches Vietnamese names without accents and migrates previous generic choices', () => {
    expect(searchLanguages(TRANSCRIBE_LANGUAGES, 'nhat').some(item => item.code === 'ja-JP')).toBe(true);
    expect(searchLanguages(TRANSCRIBE_LANGUAGES, 'es-419').map(item => item.code)).toEqual(['es-419']);
    expect(inputLanguage('ja', 'google-transcribe')).toBe('ja-JP');
    expect(inputLanguage('vi', 'google-transcribe')).toBe('vi-VN');
    expect(inputLanguage('ja-JP', 'google-flash-live')).toBe('ja');
  });
  it('sends the selected language in both Live model configurations', () => {
    expect(liveSpeechConfig(LIVE_TRANSCRIPTION_MODEL, 'verbatim', 'yue-Hant-HK').inputAudioTranscription?.languageCodes).toEqual(['yue-Hant-HK']);
    expect(JSON.stringify(liveSpeechConfig(FLASH_LIVE_MODEL, 'verbatim', 'ja'))).toContain('selected input language is ja');
    expect(liveSpeechConfig(LIVE_TRANSCRIPTION_MODEL, 'verbatim', 'auto').inputAudioTranscription?.languageCodes).toEqual([]);
    expect(JSON.stringify(liveSpeechConfig(FLASH_LIVE_MODEL, 'verbatim', 'auto'))).toContain('auto-detected');
  });
  it('supports none option for turning off translation in output languages and auto for input languages', () => {
    expect(canonicalLanguage('none')).toBe('none');
    expect(languageName('none')).toBe('Không dịch');
    expect(OUTPUT_LANGUAGES.some(l => l.code === 'none')).toBe(true);
    expect(canonicalLanguage('auto')).toBe('auto');
    expect(languageName('auto')).toBe('Tự nhận biết ngôn ngữ');
  });
});
