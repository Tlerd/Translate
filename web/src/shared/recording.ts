/**
 * Domain types for recordings, audio chunks, captions, summaries, images and settings.
 * Strict type contracts matching DINH-HUONG-APP-WEB-VA-MODEL.md Section 8 & 9.
 */

import type { SpeakerCount, SpeechProvider, TranscriptionMode } from './transcription';

export type ClassroomMode = 'lecture' | 'readingPractice';

export type RecordingState = 'recording' | 'stopped' | 'interrupted';

export type AudioState = 'present' | 'deleted' | 'missing';

export type CaptionState = 'streaming' | 'done' | 'failed';

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
  audioMimeType?: string;
  folder?: string;
  config: {
    translationModelKey: string;
    summaryModelKey?: string;
    imageModelKey?: string;
    context?: string;
    glossary?: string;
    transcriptionMode?: TranscriptionMode;
    speakerCount?: SpeakerCount;
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
}

export const DEFAULT_SETTINGS: AppSettings = {
  speechProvider: 'google-transcribe',
  transcriptionMode: 'verbatim',
  speakerCount: 1,
  translationModel: 'google:gemini-3.1-flash-lite',
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
};

export interface WebExportBundle {
  schemaVersion: 1;
  exportedAt: string;
  recording: RecordingItem;
  captions: CaptionItem[];
  summary?: SummaryItem;
  hasAudio: boolean;
  audioFileName?: string;
  hasImage: boolean;
  imageFileName?: string;
}

/**
 * APK conversation.json structure matching app/lib/session_store.dart
 */
export interface ApkSessionMeta {
  id: string;
  createdAt: string;
  endedAt?: string;
  mode?: string; // 'conversation' | 'classroom'
  state: string; // 'recording' | 'stopped' | 'interrupted'
  samples: number;
  audioState?: string;
  audioDeletedAt?: string;
  config?: Record<string, unknown>;
}

export interface ApkSessionTurn {
  id: number;
  sessionId: string;
  startSample: number;
  endSample: number;
  direction: string; // 'jaVi', 'viJa', etc.
  source?: string;
  target?: string;
  targetSource?: string;
  correctedTarget?: string;
  liveBlockId?: number;
  sourceRevision?: number;
  targetSourceRevision?: number;
  recognitionFinal?: number;
  timingApproximate?: number;
  state?: string;
  skipReason?: string;
  error?: string;
}

export interface ApkExportJson {
  session: ApkSessionMeta;
  audio?: string | null;
  audioState?: string;
  sampleRate: number; // usually 16000
  turns: ApkSessionTurn[];
}
