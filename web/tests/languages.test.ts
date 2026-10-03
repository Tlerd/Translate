import { describe, expect, it } from 'vitest';
import { canonicalLanguage, inputLanguage, inputLanguages, LIVE_LANGUAGES, searchLanguages, TRANSCRIBE_LANGUAGES } from '@/shared/languages';
import { liveSpeechConfig } from '@/shared/live-speech-config';
import { FLASH_LIVE_MODEL, LIVE_TRANSCRIPTION_MODEL } from '@/shared/transcription';

describe('model language catalogues', () => {
  it('deduplicates the documented Transcribe locales, preserving Google codes', () => {
    expect(TRANSCRIBE_LANGUAGES).toHaveLength(83);
    expect(new Set(TRANSCRIBE_LANGUAGES.map(item => item.code)).size).toBe(83);
    expect(TRANSCRIBE_LANGUAGES.some(item => item.code === 'cmn-Hans-CN')).toBe(true);
    expect(inputLanguages('google')).toEqual(TRANSCRIBE_LANGUAGES);
    expect(inputLanguages('google-flash-live')).toEqual(LIVE_LANGUAGES);
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
  });
});
