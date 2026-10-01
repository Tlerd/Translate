export const TRANSCRIPTION_MODEL = 'gemini-3.5-transcribe';
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

export function isAllowedSpeakerLabel(label: string, count: SpeakerCount): boolean {
  const match = /^spk_([1-8])$/.exec(label);
  return Boolean(match && Number(match[1]) <= count);
}

export function displaySpeakerLabel(label: string): string {
  const match = /^spk_([1-8])$/.exec(label);
  return match ? `Speaker ${match[1]}` : label;
}

export interface TranscriptionTurn {
  text: string;
  startMs: number;
  endMs: number;
  speakerLabel?: string;
}
