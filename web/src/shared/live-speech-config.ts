import type { AudioTranscriptionConfigMode, LiveConnectConfig, Modality } from '@google/genai';
import { baseLanguage, TRANSLATE_LIVE_MODEL, type LiveSpeechModel, type TranscriptionMode } from './transcription';

/** Token constraints and browser setup must describe exactly the same session. */
export function liveSpeechConfig(
  model: LiveSpeechModel,
  mode: TranscriptionMode,
  languageCode?: string,
  targetLanguageCode?: string
): LiveConnectConfig {
  if (model === TRANSLATE_LIVE_MODEL) {
    // Live Translate only produces audio; both transcriptions carry the text.
    return {
      responseModalities: ['AUDIO' as Modality],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      translationConfig: {
        targetLanguageCode: baseLanguage(targetLanguageCode) || 'vi',
        echoTargetLanguage: true,
      },
    };
  }
  // Transcribe Live has no translationConfig; the app translates its text.
  return {
    responseModalities: ['TEXT' as Modality],
    inputAudioTranscription: {
      languageCodes: languageCode && languageCode !== 'auto' ? [languageCode] : [],
      mode: (mode === 'smart' ? 'SMART' : 'VERBATIM') as AudioTranscriptionConfigMode,
    },
  };
}

/**
 * Raw WebSocket setup message. The SDK nests generation fields under
 * `generationConfig`; the Live API rejects translationConfig at the top of setup.
 */
export function liveSetupMessage(model: LiveSpeechModel, config: LiveConnectConfig): Record<string, unknown> {
  const { responseModalities, translationConfig, ...rest } = config;
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: { responseModalities, ...(translationConfig ? { translationConfig } : {}) },
      ...rest,
    },
  };
}
