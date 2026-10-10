import type { AudioTranscriptionConfigMode, LiveConnectConfig, Modality } from '@google/genai';
import type { TranscriptionMode } from './transcription';

/** Token constraints and browser setup must describe exactly the same session. */
export function liveSpeechConfig(
  mode: TranscriptionMode,
  languageCode?: string,
  targetLanguageCode?: string
): LiveConnectConfig {
  const config: LiveConnectConfig = {
    responseModalities: ['TEXT' as Modality],
    inputAudioTranscription: {
      languageCodes: languageCode && languageCode !== 'auto' ? [languageCode] : [],
      mode: (mode === 'smart' ? 'SMART' : 'VERBATIM') as AudioTranscriptionConfigMode,
    },
  };
  if (targetLanguageCode && targetLanguageCode !== 'none' && targetLanguageCode !== languageCode) {
    config.translationConfig = {
      targetLanguageCode,
      echoTargetLanguage: true,
    };
  }
  return config;
}
