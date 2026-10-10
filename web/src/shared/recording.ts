/**
 * Domain types for recordings, audio chunks, captions, summaries, images and settings.
 * Strict type contracts matching DINH-HUONG-APP-WEB-VA-MODEL.md Section 8 & 9.
 */

import type { SpeakerCount, SpeechProvider, TranscriptionMode } from './transcription';

export type ClassroomMode = 'lecture' | 'readingPractice';

export type RecordingState = 'recording' | 'stopped' | 'interrupted';

export type AudioState = 'present' | 'deleted' | 'missing';

export type CaptionState = 'streaming' | 'done' | 'failed';

/** Where the session audio comes from: microphone, shared display/tab audio, or both mixed. */
export type AudioSource = 'mic' | 'display' | 'mixed';

export interface RecordingItem {
  id: string;
  title: string;
  createdAt: string; // ISO string
  endedAt?: string;   // ISO string
  mode: ClassroomMode;
  sourceLanguage: string; // 'ja' | 'vi' | 'en'
  targetLanguage: string; // 'vi' | 'ja' | 'en'
  state: RecordingState;
  durationMs: number;
  audioState: AudioState;
  audioDeletedAt?: string;
  deletedAt?: string; // ISO string when moved to trash
  audioMimeType?: string;
  folder?: string;
  category?: 'inbox' | 'priority' | 'archive';
  config: {
    translationModelKey: string;
    summaryModelKey?: string;
    imageModelKey?: string;
    context?: string;
    glossary?: string;
    transcriptionMode?: TranscriptionMode;
    speakerCount?: SpeakerCount;
    audioSource?: AudioSource;
  };
}

export type AudioSegmentKind = 'translating' | 'apiPaused';

export type AudioSegmentStatus = 'recording' | 'completed' | 'failed';

export interface AudioSegmentItem {
  id?: number;
  recordingId: string;
  segmentIndex: number;
  kind: AudioSegmentKind;
  label: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  status: AudioSegmentStatus;
  mimeType?: string;
  sizeBytes?: number;
  error?: string;
}

export interface AudioChunk {
  id?: number;
  recordingId: string;
  segmentIndex?: number;
  sequence: number;
  mimeType: string;
  timestamp: number; // recording-relative millisecond
  blob: Blob;
}

export interface CaptionItem {
  id: number;
  recordingId: string;
  blockId: number;
  startMs: number;
  endMs: number;
  source: string;
  revision: number;
  isFinal: boolean;
  translation: string;
  targetSourceRevision: number;
  translationModelKey?: string;
  state: CaptionState;
  error?: string;
  skipReason?: string;
  speakerLabel?: string;
  sourceHistory?: Array<{ text: string; revision: number }>;
}

export interface SummarySection {
  heading: string;
  bullets: string[];
  captionIds: number[];
}

export interface SummaryItem {
  id: string;
  recordingId: string;
  sourceHash: string;
  preset: 'default';
  modelKey: string;
  title: string;
  overview: string;
  sections: SummarySection[];
  generatedAt: string;
}

export interface ImageItem {
  id: string;
  recordingId: string;
  summaryId: string;
  summaryHash: string;
  modelKey: string;
  mimeType: string;
  blob: Blob;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface AppSettings {
  speechProvider: SpeechProvider;
  transcriptionMode: TranscriptionMode;
  speakerCount: SpeakerCount;
  translationModel: string;
  translationThinkingLevel: string;
  summaryModel: string;
  imageModel: string;
  imageEnabled: boolean;
  sourceLanguage: string;
  targetLanguage: string;
  mode: ClassroomMode;
  pauseMs: number;
  readingPauseMs: number;
  translationHistoryTurns: number;
  earlySegmentTranslation: boolean;
  recentSourceLanguages?: string[];
  recentTargetLanguages?: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  speechProvider: 'google-transcribe',
  transcriptionMode: 'verbatim',
  speakerCount: 1,
  translationModel: 'google:gemini-3.5-flash-lite',
  translationThinkingLevel: 'auto',
  summaryModel: 'google:gemini-3.8-flash',
  imageModel: 'google:gemini-3.1-flash-image',
  imageEnabled: false,
  sourceLanguage: 'ja-JP',
  targetLanguage: 'vi',
  mode: 'lecture',
  pauseMs: 900,
  readingPauseMs: 900,
  translationHistoryTurns: 6,
  earlySegmentTranslation: false,
  recentSourceLanguages: ['ja-JP', 'en-US', 'ko-KR'],
  recentTargetLanguages: ['vi', 'en', 'zh-Hans'],
};
