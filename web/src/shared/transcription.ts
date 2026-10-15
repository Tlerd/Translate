export const TRANSCRIPTION_MODEL = 'gemini-3.5-transcribe';
export const LIVE_TRANSCRIPTION_MODEL = 'gemini-3.5-transcribe-live';
/** Speech-to-speech translation model; Transcribe Live ignores translationConfig and never translates. */
export const TRANSLATE_LIVE_MODEL = 'gemini-3.5-live-translate-preview';
export type LiveSpeechModel = typeof LIVE_TRANSCRIPTION_MODEL | typeof TRANSLATE_LIVE_MODEL;

/** BCP-47 base subtag, e.g. 'vi-VN' -> 'vi'. */
export function baseLanguage(code: string | undefined): string | undefined {
  return code ? code.split('-')[0].toLowerCase() : undefined;
}

/** True when a target language is set and differs from a known source language. */
export function needsLiveTranslation(sourceLanguage?: string, targetLanguage?: string): boolean {
  if (!targetLanguage || targetLanguage === 'none') return false;
  return !sourceLanguage || sourceLanguage === 'auto' || baseLanguage(sourceLanguage) !== baseLanguage(targetLanguage);
}

/** Gemini Live model for the 'google' provider: Live Translate when a translation is needed. */
export function liveSpeechModel(sourceLanguage?: string, targetLanguage?: string): LiveSpeechModel {
  return needsLiveTranslation(sourceLanguage, targetLanguage) ? TRANSLATE_LIVE_MODEL : LIVE_TRANSCRIPTION_MODEL;
}

/** Live Translate ephemeral tokens work only on v1beta; Transcribe Live keeps v1alpha. */
export function liveApiVersion(model: LiveSpeechModel): 'v1alpha' | 'v1beta' {
  return model === TRANSLATE_LIVE_MODEL ? 'v1beta' : 'v1alpha';
}
export type SpeechProvider = 'google' | 'google-transcribe' | 'nemotron' | 'soniox';

export function normalizeSpeechProvider(value: unknown): SpeechProvider {
  if (value === 'soniox') return 'soniox';
  if (value === 'nemotron') return 'nemotron';
  // Removed Flash Live providers ('google-flash', 'google-flash-live') fall back to Transcribe.
  return value === 'google' ? value : 'google-transcribe';
}

export function isLiveSpeechProvider(provider: SpeechProvider): boolean {
  return provider === 'google' || provider === 'nemotron' || provider === 'soniox';
}

export function speechProviderName(provider: SpeechProvider): string {
  if (provider === 'soniox') return 'Soniox · stt-rt-v5 (dịch trực tiếp, 60+ ngôn ngữ)';
  if (provider === 'nemotron') return 'Nemotron 3.5 ASR';
  return provider === 'google' ? 'Gemini 3.5 Live Translate' : 'Gemini 3.5 Transcribe';
}
export const SPEAKER_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export type SpeakerCount = typeof SPEAKER_COUNTS[number];
export type TranscriptionMode = 'verbatim' | 'smart';

export function isSpeakerCount(value: unknown): value is SpeakerCount {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 8;
}

export function normalizeSpeakerCount(value: unknown): SpeakerCount {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return isSpeakerCount(parsed) ? parsed : 1;
}

export function normalizeTranscriptionMode(value: unknown): TranscriptionMode {
  return value === 'smart' ? 'smart' : 'verbatim';
}

/** Labels assigned from the audio source when microphone and shared-screen audio are mixed. */
export const SOURCE_SPEAKER_LABELS = { mic: 'src_mic', display: 'src_display' } as const;
export type SourceSpeakerLabel = typeof SOURCE_SPEAKER_LABELS[keyof typeof SOURCE_SPEAKER_LABELS];

export function isSourceSpeakerLabel(label: string | undefined): label is SourceSpeakerLabel {
  return label === SOURCE_SPEAKER_LABELS.mic || label === SOURCE_SPEAKER_LABELS.display;
}

export function isAllowedSpeakerLabel(label: string, count: SpeakerCount): boolean {
  if (isSourceSpeakerLabel(label)) return true;
  const match = /^spk_([1-8])$/.exec(label);
  return Boolean(match && Number(match[1]) <= count);
}

export function displaySpeakerLabel(label: string): string {
  if (label === SOURCE_SPEAKER_LABELS.mic) return 'Tôi';
  if (label === SOURCE_SPEAKER_LABELS.display) return 'Cuộc họp';
  const match = /^spk_([1-8])$/.exec(label);
  return match ? `Speaker ${match[1]}` : label;
}

export interface TranscriptionTurn {
  text: string;
  startMs: number;
  endMs: number;
  speakerLabel?: string;
}
