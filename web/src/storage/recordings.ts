import { getDb } from './db';
import { notifyAudio } from './audio-assets';
import { compareAudioChunkOrder } from '@/shared/audio';
import type {
  RecordingItem,
  AudioChunk,
  AudioSegmentItem,
  CaptionItem,
  SummaryItem,
  ImageItem,
  AppSettings,
  AudioSource,
  ClassroomMode,
} from '@/shared/recording';
import { DEFAULT_SETTINGS } from '@/shared/recording';
import { isAllowedSpeakerLabel, normalizeSpeechProvider, normalizeSpeakerCount, normalizeTranscriptionMode, type SpeakerCount, type TranscriptionMode } from '@/shared/transcription';

/** Upper bound used by library lists; effectively no limit for a personal library. */
export const LIBRARY_PAGE_LIMIT = 100_000;

export interface CreateRecordingParams {
  id?: string;
  title?: string;
  mode: ClassroomMode;
  sourceLanguage: string;
  targetLanguage: string;
  translationModelKey: string;
  summaryModelKey?: string;
  imageModelKey?: string;
  context?: string;
  glossary?: string;
  transcriptionMode?: TranscriptionMode;
  speakerCount?: SpeakerCount;
  audioSource?: AudioSource;
}

export async function createRecording(params: CreateRecordingParams): Promise<RecordingItem> {
  const db = getDb();
  const now = new Date().toISOString();
  const id = params.id ?? crypto.randomUUID();
  const title = params.title ?? `Buổi học ${new Date().toLocaleString('vi-VN')}`;

  const recording: RecordingItem = {
    id,
    title,
    createdAt: now,
    mode: params.mode,
    sourceLanguage: params.sourceLanguage,
    targetLanguage: params.targetLanguage,
    state: 'recording',
    durationMs: 0,
    audioState: 'missing',
    category: 'inbox',
    config: {
      translationModelKey: params.translationModelKey,
      summaryModelKey: params.summaryModelKey,
      imageModelKey: params.imageModelKey,
      context: params.context,
      glossary: params.glossary,
      transcriptionMode: params.transcriptionMode,
      speakerCount: params.speakerCount,
      // Microphone-only sessions keep the original record shape so older tabs and builds read them unchanged.
      ...(params.audioSource && params.audioSource !== 'mic' ? { audioSource: params.audioSource } : {}),
    },
  };

  await db.recordings.put(recording);
  return recording;
}

export async function getRecording(id: string): Promise<RecordingItem | undefined> {
  const db = getDb();
  return db.recordings.get(id);
}

export async function listRecordings(limit = 50, offset = 0, includeDeleted = false): Promise<RecordingItem[]> {
  const db = getDb();
  const all = await db.recordings
    .orderBy('createdAt')
    .reverse()
    .toArray();
  const filtered = includeDeleted ? all : all.filter(r => !r.deletedAt);
  return filtered.slice(offset, offset + limit);
}

export async function listTrashRecordings(limit = 50, offset = 0): Promise<RecordingItem[]> {
  const db = getDb();
  const all = await db.recordings
    .orderBy('createdAt')
    .reverse()
    .toArray();
  const trash = all.filter(r => Boolean(r.deletedAt));
  return trash.slice(offset, offset + limit);
}

export async function softDeleteRecording(id: string): Promise<void> {
  const db = getDb();
  const recording = await db.recordings.get(id);
  if (!recording) return;
  if (recording.state === 'recording') {
    throw new Error('Buổi đang thu không thể xóa.');
  }
  await db.recordings.update(id, { deletedAt: new Date().toISOString() });
}

export async function restoreRecording(id: string): Promise<void> {
  const db = getDb();
  await db.recordings.update(id, { deletedAt: undefined });
}

export async function emptyTrash(): Promise<void> {
  const db = getDb();
  const trashItems = await db.recordings.filter(r => Boolean(r.deletedAt)).toArray();
  for (const item of trashItems) {
    await deleteRecording(item.id);
  }
}

export async function updateRecording(
  id: string,
  changes: Partial<RecordingItem>
): Promise<void> {
  const db = getDb();
  await db.recordings.update(id, changes);
}

export async function renameRecording(id: string, newTitle: string): Promise<void> {
  const db = getDb();
  await db.recordings.update(id, { title: newTitle.trim() });
}

export async function deleteAudioOnly(id: string): Promise<void> {
  const db = getDb();
  const recording = await db.recordings.get(id);
  if (!recording) return;
  if (recording.state === 'recording') {
    throw new Error('Buổi đang thu không thể xóa audio.');
  }

  await db.transaction('rw', [db.recordings, db.audioChunks, db.audioSegments, db.audioAssets, db.audioJobs], async () => {
    await db.audioChunks.where('recordingId').equals(id).delete();
    await db.audioSegments.where('recordingId').equals(id).delete();
    await db.audioAssets.put({ recordingId: id, status: 'deleted' });
    await db.audioJobs.put({ recordingId: id, action: 'delete', attempts: 0, nextAttemptAt: 0 });
    await db.recordings.update(id, {
      audioState: 'deleted',
      audioDeletedAt: new Date().toISOString(),
    });
  });
  notifyAudio(true);
}

export async function deleteRecording(id: string): Promise<void> {
  const db = getDb();
  const recording = await db.recordings.get(id);
  if (!recording) return;
  if (recording.state === 'recording') {
    throw new Error('Buổi đang thu không thể xóa.');
  }

  await db.transaction(
    'rw',
    [db.recordings, db.audioChunks, db.audioSegments, db.captions, db.summaries, db.images, db.audioAssets, db.audioJobs],
    async () => {
      await db.audioAssets.put({ recordingId: id, status: 'deleted' });
      await db.audioJobs.put({ recordingId: id, action: 'delete', attempts: 0, nextAttemptAt: 0 });
      await db.recordings.delete(id);
      await db.audioChunks.where('recordingId').equals(id).delete();
      await db.audioSegments.where('recordingId').equals(id).delete();
      await db.captions.where('recordingId').equals(id).delete();
      await db.summaries.where('recordingId').equals(id).delete();
      await db.images.where('recordingId').equals(id).delete();
    }
  );
  notifyAudio(true);
}

// Audio Chunks
export async function addAudioChunk(chunk: Omit<AudioChunk, 'id'>): Promise<void> {
  const db = getDb();
  await db.transaction('rw', [db.recordings, db.audioChunks], async () => {
    await db.audioChunks.add(chunk as AudioChunk);
    const rec = await db.recordings.get(chunk.recordingId);
    if (rec && rec.audioState !== 'present') {
      await db.recordings.update(chunk.recordingId, {
        audioState: 'present',
        audioMimeType: chunk.mimeType,
      });
    }
  });
}

export async function getAudioChunks(recordingId: string): Promise<AudioChunk[]> {
  const db = getDb();
  const chunks = await db.audioChunks
    .where('recordingId')
    .equals(recordingId)
    .toArray();
  return chunks.sort(compareAudioChunkOrder);
}

export async function getAudioBlob(recordingId: string, maxBytes = Infinity): Promise<{ blob: Blob; mimeType: string; durationMs?: number } | null> {
  const asset = await getDb().audioAssets.get(recordingId);
  if (asset?.status === 'deleted') return null;
  if (asset?.blob && asset.file) return asset.blob.size <= maxBytes ? { blob: asset.blob, mimeType: asset.file.mimeType, durationMs: asset.file.durationMs } : null;
  if ((asset?.remote?.file?.sizeBytes ?? 0) > maxBytes) return null;
  const chunks: AudioChunk[] = [];
  let bytes = 0;
  let oversized = false;
  await getDb().audioChunks.where('recordingId').equals(recordingId).each((chunk) => {
    bytes += chunk.blob.size;
    if (bytes > maxBytes) { oversized = true; chunks.length = 0; }
    if (!oversized) chunks.push(chunk);
  });
  if (oversized) return null;
  if (typeof Worker !== 'undefined' && (chunks.length || asset?.remote?.state === 'available')) {
    const recording = await getRecording(recordingId);
    if (recording && recording.state !== 'recording') {
      // Export and speaker analysis use the same verified whole-session file
      // as playback, including audio that currently only exists in cloud.
      const { playableAudio } = await import('./audio-sync');
      const audio = await playableAudio(recordingId);
      return audio.blob && audio.file && audio.blob.size <= maxBytes
        ? { blob: audio.blob, mimeType: audio.file.mimeType, durationMs: audio.file.durationMs } : null;
    }
  }
  chunks.sort(compareAudioChunkOrder);
  if (chunks.length === 0) return null;
  const mimeType = chunks[0]?.mimeType || 'audio/webm';
  const blobs = chunks.map((c) => c.blob);
  return {
    blob: new Blob(blobs, { type: mimeType }),
    mimeType,
  };
}

// Audio Segments
export function getExtensionFromMimeType(mimeType?: string): string {
  if (!mimeType) return 'webm';
  const lower = mimeType.toLowerCase();
  if (lower.includes('mp4')) return 'mp4';
  if (lower.includes('m4a')) return 'm4a';
  if (lower.includes('aac')) return 'aac';
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('ogg')) return 'ogg';
  return 'webm';
}

export function formatSegmentFileName(recordingId: string, segmentIndex: number, mimeType?: string): string {
  const ext = getExtensionFromMimeType(mimeType);
  const cleanId = recordingId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16);
  const segNum = String(segmentIndex).padStart(2, '0');
  return `buoi_${cleanId}_doan_${segNum}.${ext}`;
}

export async function createAudioSegment(
  segment: Omit<AudioSegmentItem, 'id'>
): Promise<AudioSegmentItem> {
  const db = getDb();
  const id = await db.audioSegments.add(segment as AudioSegmentItem);
  return { ...segment, id: typeof id === 'number' ? id : undefined };
}

export async function updateAudioSegment(
  recordingId: string,
  segmentIndex: number,
  changes: Partial<AudioSegmentItem>
): Promise<void> {
  const db = getDb();
  const existing = await db.audioSegments
    .where(['recordingId', 'segmentIndex'])
    .equals([recordingId, segmentIndex])
    .first();
  if (existing && existing.id !== undefined) {
    await db.audioSegments.update(existing.id, changes);
  }
}

export async function getAudioSegments(recordingId: string): Promise<AudioSegmentItem[]> {
  const db = getDb();
  const segments = await db.audioSegments
    .where('recordingId')
    .equals(recordingId)
    .sortBy('segmentIndex');

  if (segments.length > 0) {
    return segments;
  }

  // Legacy fallback: check if recording has audioChunks or audioState === 'present'
  const rec = await db.recordings.get(recordingId);
  const chunkCount = await db.audioChunks.where('recordingId').equals(recordingId).count();
  if (chunkCount > 0 || rec?.audioState === 'present') {
    const firstChunk = await db.audioChunks
      .where('recordingId')
      .equals(recordingId)
      .first();
    const mimeType = firstChunk?.mimeType || rec?.audioMimeType || 'audio/webm';
    return [
      {
        recordingId,
        segmentIndex: 1,
        kind: 'translating',
        label: 'Đang dịch',
        startMs: 0,
        endMs: rec?.durationMs ?? 0,
        durationMs: rec?.durationMs ?? 0,
        status: chunkCount > 0 ? 'completed' : 'recording',
        mimeType,
      },
    ];
  }

  return [];
}

export async function getAudioSegmentBlob(
  recordingId: string,
  segmentIndex: number,
  maxBytes = Infinity
): Promise<{ blob: Blob; mimeType: string } | null> {
  const db = getDb();
  const chunks: AudioChunk[] = [];
  let bytes = 0;
  let oversized = false;

  await db.audioChunks
    .where('recordingId')
    .equals(recordingId)
    .each((chunk) => {
      const matches =
        chunk.segmentIndex === segmentIndex ||
        (segmentIndex === 1 && chunk.segmentIndex === undefined);
      if (matches) {
        bytes += chunk.blob.size;
        if (bytes > maxBytes) {
          oversized = true;
          chunks.length = 0;
        }
        if (!oversized) chunks.push(chunk);
      }
    });

  if (oversized || chunks.length === 0) return null;
  chunks.sort(compareAudioChunkOrder);
  const mimeType = chunks[0]?.mimeType || 'audio/webm';
  const blobs = chunks.map((c) => c.blob);
  return {
    blob: new Blob(blobs, { type: mimeType }),
    mimeType,
  };
}

// Captions
export async function saveCaption(caption: CaptionItem): Promise<void> {
  const db = getDb();
  await db.captions.put(caption);
}

export async function getCaptions(recordingId: string): Promise<CaptionItem[]> {
  const db = getDb();
  const list = await db.captions
    .where('recordingId')
    .equals(recordingId)
    .toArray();
  return list.sort((a, b) => a.startMs - b.startMs || a.id - b.id);
}

/** Hashes the original-language lines in the same stable shape used by summaries. */
export async function computeCaptionSourceHash(captions: CaptionItem[]): Promise<string> {
  const sourceString = JSON.stringify(captions.map((caption) => ({ id: caption.id, text: caption.source })));
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceString));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  let hash = 0;
  for (let index = 0; index < sourceString.length; index++) {
    hash = (hash << 5) - hash + sourceString.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

/** Saves edited source lines atomically while retaining their translations and metadata. */
export async function updateCaptionSources(
  recordingId: string,
  sources: Array<{ id: number; source: string }>
): Promise<CaptionItem[]> {
  const db = getDb();
  return db.transaction('rw', [db.recordings, db.captions], async () => {
    const recording = await db.recordings.get(recordingId);
    if (!recording) throw new Error('Không tìm thấy buổi ghi âm này.');
    if (recording.state === 'recording') {
      throw new Error('Hãy kết thúc buổi thu trước khi chỉnh sửa kịch bản.');
    }

    const captions = await db.captions.where('recordingId').equals(recordingId).toArray();
    const current = captions.sort((a, b) => a.startMs - b.startMs || a.id - b.id);
    if (sources.length !== current.length || new Set(sources.map((line) => line.id)).size !== current.length) {
      throw new Error('Danh sách câu đã thay đổi. Hãy đóng cửa sổ và mở lại để cập nhật.');
    }

    const sourceById = new Map(sources.map((line) => [line.id, line.source]));
    if (current.some((caption) => !sourceById.has(caption.id))) {
      throw new Error('Không thể xác định đầy đủ các câu cần lưu. Hãy mở lại cửa sổ chỉnh sửa.');
    }
    if (sources.some((line) => !line.source.trim())) {
      throw new Error('Mỗi câu cần có nội dung. Hãy nhập lại câu đang để trống hoặc hủy thay đổi.');
    }

    const updated = current.map((caption) => {
      const source = sourceById.get(caption.id)!;
      return source === caption.source ? caption : { ...caption, source, revision: caption.revision + 1 };
    });
    await db.captions.bulkPut(updated);
    return updated;
  });
}

// Summaries
export async function saveSummary(summary: SummaryItem): Promise<void> {
  const db = getDb();
  await db.summaries.put(summary);
}

export async function getSummary(recordingId: string): Promise<SummaryItem | undefined> {
  const db = getDb();
  return db.summaries.where('recordingId').equals(recordingId).first();
}

// Images
export async function saveImage(image: ImageItem): Promise<void> {
  const db = getDb();
  await db.images.put(image);
}

export async function getImage(recordingId: string): Promise<ImageItem | undefined> {
  const db = getDb();
  return db.images.where('recordingId').equals(recordingId).first();
}

// Settings
function normalizePauseMs(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(600, Math.min(10_000, Math.round(parsed)));
}

function normalizeTranslationHistoryTurns(value: unknown, fallback: number = DEFAULT_SETTINGS.translationHistoryTurns): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(6, Math.floor(parsed)));
}

function normalizeEarlySegmentTranslation(value: unknown, fallback: boolean = DEFAULT_SETTINGS.earlySegmentTranslation): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

export async function loadSettings(): Promise<AppSettings> {
  const db = getDb();
  try {
    const records = await db.settings.toArray();
    const map = new Map(records.map((r) => [r.key, r.value]));
    return {
      translationModel: map.get('translationModel') || DEFAULT_SETTINGS.translationModel,
      translationThinkingLevel: map.get('translationThinkingLevel') || DEFAULT_SETTINGS.translationThinkingLevel,
      summaryModel: map.get('summaryModel') || DEFAULT_SETTINGS.summaryModel,
      imageModel: map.get('imageModel') || DEFAULT_SETTINGS.imageModel,
      imageEnabled: map.get('imageEnabled') === 'true',
      sourceLanguage: map.get('sourceLanguage') || DEFAULT_SETTINGS.sourceLanguage,
      targetLanguage: map.get('targetLanguage') || DEFAULT_SETTINGS.targetLanguage,
      mode: (map.get('mode') as ClassroomMode) || DEFAULT_SETTINGS.mode,
      pauseMs: normalizePauseMs(map.get('pauseMs'), DEFAULT_SETTINGS.pauseMs),
      readingPauseMs: normalizePauseMs(map.get('readingPauseMs'), DEFAULT_SETTINGS.readingPauseMs),
      translationHistoryTurns: normalizeTranslationHistoryTurns(
        map.get('translationHistoryTurns'),
        DEFAULT_SETTINGS.translationHistoryTurns
      ),
      earlySegmentTranslation: normalizeEarlySegmentTranslation(
        map.get('earlySegmentTranslation'),
        DEFAULT_SETTINGS.earlySegmentTranslation
      ),
      // Preserve supported providers; migrate the removed browser provider to Transcribe.
      speechProvider: normalizeSpeechProvider(map.get('speechProvider')),
      transcriptionMode: normalizeTranscriptionMode(map.get('transcriptionMode')),
      speakerCount: normalizeSpeakerCount(map.get('speakerCount')),
      recentSourceLanguages: (() => {
        try {
          const raw = map.get('recentSourceLanguages');
          return raw ? JSON.parse(raw) : DEFAULT_SETTINGS.recentSourceLanguages;
        } catch {
          return DEFAULT_SETTINGS.recentSourceLanguages;
        }
      })(),
      recentTargetLanguages: (() => {
        try {
          const raw = map.get('recentTargetLanguages');
          return raw ? JSON.parse(raw) : DEFAULT_SETTINGS.recentTargetLanguages;
        } catch {
          return DEFAULT_SETTINGS.recentTargetLanguages;
        }
      })(),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const settingsUpdatedEvent = 'may-dich:settings-updated';

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const db = getDb();
  const normalized: Record<string, unknown> = { ...settings };
  if (settings.speechProvider !== undefined) normalized.speechProvider = normalizeSpeechProvider(settings.speechProvider);
  if (settings.transcriptionMode !== undefined) normalized.transcriptionMode = normalizeTranscriptionMode(settings.transcriptionMode);
  if (settings.speakerCount !== undefined) normalized.speakerCount = normalizeSpeakerCount(settings.speakerCount);
  if (settings.pauseMs !== undefined) normalized.pauseMs = normalizePauseMs(settings.pauseMs, DEFAULT_SETTINGS.pauseMs);
  if (settings.readingPauseMs !== undefined) normalized.readingPauseMs = normalizePauseMs(settings.readingPauseMs, DEFAULT_SETTINGS.readingPauseMs);
  if (settings.translationHistoryTurns !== undefined) {
    normalized.translationHistoryTurns = normalizeTranslationHistoryTurns(
      settings.translationHistoryTurns,
      DEFAULT_SETTINGS.translationHistoryTurns
    );
  }
  if (settings.earlySegmentTranslation !== undefined) {
    normalized.earlySegmentTranslation = normalizeEarlySegmentTranslation(
      settings.earlySegmentTranslation,
      DEFAULT_SETTINGS.earlySegmentTranslation
    );
  }
  if (settings.recentSourceLanguages !== undefined) {
    normalized.recentSourceLanguages = JSON.stringify(settings.recentSourceLanguages.slice(0, 3));
  }
  if (settings.recentTargetLanguages !== undefined) {
    normalized.recentTargetLanguages = JSON.stringify(settings.recentTargetLanguages.slice(0, 3));
  }
  await db.transaction('rw', db.settings, async () => {
    for (const [key, value] of Object.entries(normalized)) {
      if (value !== undefined) {
        await db.settings.put({ key, value: String(value) });
      }
    }
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(settingsUpdatedEvent, { detail: normalized }));
  }
}

export async function updateCaptionSpeaker(
  recordingId: string, captionId: number, speakerLabel: string | undefined, speakerCount: SpeakerCount,
): Promise<CaptionItem> {
  if (speakerLabel !== undefined && !isAllowedSpeakerLabel(speakerLabel, speakerCount)) {
    throw new Error('Người nói phải nằm trong danh sách Speaker đã cấu hình.');
  }
  const db = getDb();
  return db.transaction('rw', db.recordings, db.captions, async () => {
    const recording = await db.recordings.get(recordingId);
    if (!recording || recording.state === 'recording') throw new Error('Kết thúc buổi thu trước khi gán người nói.');
    const caption = await db.captions.get([recordingId, captionId]);
    if (!caption) throw new Error('Không tìm thấy câu cần gán người nói.');
    const updated = { ...caption, speakerLabel };
    await db.captions.put(updated);
    return updated;
  });
}

export async function updateRecordingFolder(
  id: string,
  folder?: string | null
): Promise<void> {
  const db = getDb();
  await db.recordings.update(id, { folder: folder ? folder.trim() : undefined });
}

export async function getCustomFolders(): Promise<string[]> {
  const db = getDb();
  const setting = await db.settings.get('custom_folders');
  if (!setting?.value) return [];
  try {
    const list = JSON.parse(setting.value);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Accent- and case-insensitive sort key for Vietnamese folder names.
 * Does not rely on ICU locale data: NFD strip marks, lowercase, and map đ to d.
 */
function folderSortKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd');
}

/**
 * Union of custom folder names and folder names used by recordings.
 * Trims, drops empty values and duplicates, then sorts without locale data.
 */
export function mergeFolderNames(custom: string[], used: Array<string | undefined | null>): string[] {
  const names = new Set<string>();
  for (const value of [...custom, ...used]) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) names.add(trimmed);
  }
  return [...names].sort((a, b) => {
    const ka = folderSortKey(a);
    const kb = folderSortKey(b);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/**
 * Folders to display in the library. Includes folders that exist only on
 * recordings (for example, synced from another device) and ignores trashed recordings.
 */
export async function getLibraryFolders(): Promise<string[]> {
  const db = getDb();
  const custom = await getCustomFolders();
  const recordings = await db.recordings.toArray();
  const used = recordings.filter(r => !r.deletedAt).map(r => r.folder);
  return mergeFolderNames(custom, used);
}

export async function saveCustomFolders(folders: string[]): Promise<void> {
  const db = getDb();
  const clean = [...new Set(folders.map(f => f.trim()).filter(Boolean))];
  await db.settings.put({ key: 'custom_folders', value: JSON.stringify(clean) });
}

export async function deleteCustomFolder(folderName: string): Promise<void> {
  const db = getDb();
  const currentFolders = await getCustomFolders();
  const updatedFolders = currentFolders.filter((f) => f !== folderName);
  await saveCustomFolders(updatedFolders);

  // Unlink folder from any recording that was in this folder
  const matchingRecordings = await db.recordings.filter((r) => r.folder === folderName).toArray();
  for (const rec of matchingRecordings) {
    await db.recordings.update(rec.id, { folder: undefined });
  }
}

export async function renameCustomFolder(oldName: string, newName: string): Promise<void> {
  const cleanNew = newName.trim();
  if (!cleanNew || oldName === cleanNew) return;
  const db = getDb();
  const currentFolders = await getCustomFolders();
  const updatedFolders = currentFolders.map((f) => (f === oldName ? cleanNew : f));
  await saveCustomFolders(updatedFolders);

  // Update recordings
  const matchingRecordings = await db.recordings.filter((r) => r.folder === oldName).toArray();
  for (const rec of matchingRecordings) {
    await db.recordings.update(rec.id, { folder: cleanNew });
  }
}

export async function updateRecordingCategory(
  id: string,
  category: 'inbox' | 'priority' | 'archive'
): Promise<void> {
  const db = getDb();
  await db.recordings.update(id, { category });
}

export async function batchUpdateCategory(
  ids: string[],
  category: 'inbox' | 'priority' | 'archive'
): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.recordings, async () => {
    for (const id of ids) {
      await db.recordings.update(id, { category });
    }
  });
}

export async function batchUpdateFolder(
  ids: string[],
  folder: string | null
): Promise<void> {
  const db = getDb();
  const clean = folder ? folder.trim() : undefined;
  await db.transaction('rw', db.recordings, async () => {
    for (const id of ids) {
      await db.recordings.update(id, { folder: clean });
    }
  });
}

export async function batchSoftDelete(ids: string[]): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db.transaction('rw', db.recordings, async () => {
    for (const id of ids) {
      await db.recordings.update(id, { deletedAt: now });
    }
  });
}

export interface RecordingFieldSnapshot {
  id: string;
  folder?: string;
  category?: 'inbox' | 'priority' | 'archive';
  deletedAt?: string;
}

/**
 * Restores folder, category and deletedAt exactly as captured before a bulk action.
 * An undefined value clears the field, which matches a recording that never had it.
 */
export async function restoreRecordingFields(snapshots: RecordingFieldSnapshot[]): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.recordings, async () => {
    for (const snapshot of snapshots) {
      await db.recordings.update(snapshot.id, {
        folder: snapshot.folder,
        category: snapshot.category,
        deletedAt: snapshot.deletedAt,
      });
    }
  });
}

export async function pushRecentLanguage(
  type: 'source' | 'target',
  langCode: string
): Promise<void> {
  if (!langCode || langCode === 'none') return;
  const current = await loadSettings();
  const key = type === 'source' ? 'recentSourceLanguages' : 'recentTargetLanguages';
  const existing = (current[key] ?? []).filter((c) => c !== langCode);
  const updated = [langCode, ...existing].slice(0, 3);
  await saveSettings({ [key]: updated });
}

