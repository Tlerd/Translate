import { getDb } from './db';
import type {
  RecordingItem,
  AudioChunk,
  CaptionItem,
  SummaryItem,
  ImageItem,
  AppSettings,
  ClassroomMode,
} from '@/shared/recording';
import { DEFAULT_SETTINGS } from '@/shared/recording';

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
}

export async function createRecording(params: CreateRecordingParams): Promise<RecordingItem> {
  const db = getDb();
  const now = new Date().toISOString();
  const id = params.id ?? Date.now().toString();
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
    audioState: 'present',
    config: {
      translationModelKey: params.translationModelKey,
      summaryModelKey: params.summaryModelKey,
      imageModelKey: params.imageModelKey,
      context: params.context,
      glossary: params.glossary,
    },
  };

  await db.recordings.put(recording);
  return recording;
}

export async function getRecording(id: string): Promise<RecordingItem | undefined> {
  const db = getDb();
  return db.recordings.get(id);
}

export async function listRecordings(limit = 50, offset = 0): Promise<RecordingItem[]> {
  const db = getDb();
  return db.recordings
    .orderBy('createdAt')
    .reverse()
    .offset(offset)
    .limit(limit)
    .toArray();
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

  await db.transaction('rw', [db.recordings, db.audioChunks], async () => {
    await db.audioChunks.where('recordingId').equals(id).delete();
    await db.recordings.update(id, {
      audioState: 'deleted',
      audioDeletedAt: new Date().toISOString(),
    });
  });
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
    [db.recordings, db.audioChunks, db.captions, db.summaries, db.images],
    async () => {
      await db.recordings.delete(id);
      await db.audioChunks.where('recordingId').equals(id).delete();
      await db.captions.where('recordingId').equals(id).delete();
      await db.summaries.where('recordingId').equals(id).delete();
      await db.images.where('recordingId').equals(id).delete();
    }
  );
}

// Audio Chunks
export async function addAudioChunk(chunk: Omit<AudioChunk, 'id'>): Promise<void> {
  const db = getDb();
  await db.audioChunks.add(chunk as AudioChunk);
}

export async function getAudioChunks(recordingId: string): Promise<AudioChunk[]> {
  const db = getDb();
  return db.audioChunks
    .where('recordingId')
    .equals(recordingId)
    .sortBy('sequence');
}

export async function getAudioBlob(recordingId: string): Promise<{ blob: Blob; mimeType: string } | null> {
  const chunks = await getAudioChunks(recordingId);
  if (chunks.length === 0) return null;
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
export async function loadSettings(): Promise<AppSettings> {
  const db = getDb();
  try {
    const records = await db.settings.toArray();
    const map = new Map(records.map((r) => [r.key, r.value]));
    return {
      translationModel: map.get('translationModel') || DEFAULT_SETTINGS.translationModel,
      summaryModel: map.get('summaryModel') || DEFAULT_SETTINGS.summaryModel,
      imageModel: map.get('imageModel') || DEFAULT_SETTINGS.imageModel,
      imageEnabled: map.get('imageEnabled') === 'true',
      sourceLanguage: map.get('sourceLanguage') || DEFAULT_SETTINGS.sourceLanguage,
      targetLanguage: map.get('targetLanguage') || DEFAULT_SETTINGS.targetLanguage,
      mode: (map.get('mode') as ClassroomMode) || DEFAULT_SETTINGS.mode,
      context: map.get('context') || DEFAULT_SETTINGS.context,
      glossary: map.get('glossary') || DEFAULT_SETTINGS.glossary,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.settings, async () => {
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined) {
        await db.settings.put({ key, value: String(value) });
      }
    }
  });
}
