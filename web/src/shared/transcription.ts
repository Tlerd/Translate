export const TRANSCRIPTION_MODEL = 'gemini-3.5-transcribe';
export const LIVE_TRANSCRIPTION_MODEL = 'gemini-3.5-transcribe-live';
export const FLASH_LIVE_MODEL = 'gemini-3.1-flash-live-preview';
export type LiveSpeechModel = typeof LIVE_TRANSCRIPTION_MODEL | typeof FLASH_LIVE_MODEL;
export type SpeechProvider = 'google' | 'google-transcribe' | 'google-flash-live' | 'nemotron' | 'soniox';

export function normalizeSpeechProvider(value: unknown): SpeechProvider {
  if (value === 'soniox') return 'soniox';
  if (value === 'nemotron') return 'nemotron';
  if (value === 'google-flash' || value === 'google-flash-live') return 'google-flash-live';
  return value === 'google' ? value : 'google-transcribe';
}

export function isLiveSpeechProvider(provider: SpeechProvider): boolean {
  return provider === 'google' || provider === 'google-flash-live' || provider === 'nemotron' || provider === 'soniox';
}

export function liveTranscriptionModel(provider: SpeechProvider): LiveSpeechModel {
  return provider === 'google-flash-live' ? FLASH_LIVE_MODEL : LIVE_TRANSCRIPTION_MODEL;
}

export function speechProviderName(provider: SpeechProvider): string {
  if (provider === 'soniox') return 'Soniox · stt-rt-v5 (dịch trực tiếp, 60+ ngôn ngữ)';
  if (provider === 'nemotron') return 'Nemotron 3.5 ASR';
  if (provider === 'google-flash-live') return 'Gemini 3 Flash Live';
  return provider === 'google' ? 'Gemini 3.5 Translate Live' : 'Gemini 3.5 Transcribe';
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
