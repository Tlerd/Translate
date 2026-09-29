import {
  getRecording,
  getCaptions,
  getSummary,
  getImage,
  getAudioBlob,
  addAudioChunk,
  saveCaption,
  saveSummary,
  saveImage,
} from './recordings';
import { getDb } from './db';
import type {
  RecordingItem,
  CaptionItem,
  WebExportBundle,
  ApkExportJson,
  ClassroomMode,
  AudioState,
  RecordingState,
} from '@/shared/recording';

export interface ExportData {
  jsonString: string;
  audioBlob?: Blob;
  audioFileName?: string;
  imageBlob?: Blob;
  imageFileName?: string;
}

export async function exportRecordingData(recordingId: string): Promise<ExportData> {
  const recording = await getRecording(recordingId);
  if (!recording) {
    throw new Error(`Không tìm thấy bản ghi có ID ${recordingId}`);
  }

  const captions = await getCaptions(recordingId);
  const summary = await getSummary(recordingId);
  const image = await getImage(recordingId);
  const audioData = await getAudioBlob(recordingId);

  const audioFileName = audioData
    ? `audio_${recording.id}.${audioData.mimeType.includes('mp4') ? 'mp4' : 'webm'}`
    : undefined;
  const imageFileName = image ? `image_${recording.id}.webp` : undefined;

  const bundle: WebExportBundle = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    recording,
    captions,
    summary,
    hasAudio: !!audioData,
    audioFileName,
    hasImage: !!image,
    imageFileName,
  };

  return {
    jsonString: JSON.stringify(bundle, null, 2),
    audioBlob: audioData?.blob,
    audioFileName,
    imageBlob: image?.blob,
    imageFileName,
  };
}

/**
 * Import a WebExportBundle into Dexie.
 * If recording ID already exists, creates a new unique ID and remaps children.
 */
export async function importWebBundle(
  bundle: WebExportBundle,
  audioBlob?: Blob,
  imageBlob?: Blob
): Promise<RecordingItem> {
  const db = getDb();
  if (bundle.schemaVersion !== 1 || !bundle.recording) {
    throw new Error('Dữ liệu không đúng định dạng export web (schemaVersion 1)');
  }

  let targetId = bundle.recording.id;
  const existing = await db.recordings.get(targetId);
  if (existing) {
    targetId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  const newRecording: RecordingItem = {
    ...bundle.recording,
    id: targetId,
    title: existing ? `${bundle.recording.title} (Bản nhập)` : bundle.recording.title,
    createdAt: bundle.recording.createdAt || new Date().toISOString(),
  };

  await db.recordings.put(newRecording);

  // Import captions
  if (Array.isArray(bundle.captions)) {
    for (const cap of bundle.captions) {
      await saveCaption({
        ...cap,
        recordingId: targetId,
      });
    }
  }

  // Import summary
  if (bundle.summary) {
    const newSummaryId = `sum_${targetId}`;
    await saveSummary({
      ...bundle.summary,
      id: newSummaryId,
      recordingId: targetId,
    });

    // Import image
    if (bundle.hasImage && (imageBlob || bundle.imageFileName)) {
      if (imageBlob) {
        await saveImage({
          id: `img_${targetId}`,
          recordingId: targetId,
          summaryId: newSummaryId,
          summaryHash: bundle.summary.sourceHash,
          modelKey: bundle.recording.config.imageModelKey || 'imported',
          mimeType: imageBlob.type || 'image/webp',
          blob: imageBlob,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  // Import audio
  if (audioBlob) {
    await addAudioChunk({
      recordingId: targetId,
      sequence: 0,
      mimeType: audioBlob.type || 'audio/webm',
      timestamp: 0,
      blob: audioBlob,
    });
    await db.recordings.update(targetId, {
      audioState: 'present',
      audioMimeType: audioBlob.type,
    });
  }

  return newRecording;
}

/**
 * Import APK export format (conversation.json + optional conversation.wav).
 * Converts 16kHz sample counts to milliseconds (sampleCount / 16).
 */
export async function importApkExport(
  apkJson: ApkExportJson,
  wavBlob?: Blob
): Promise<RecordingItem> {
  const db = getDb();
  if (!apkJson.session || !Array.isArray(apkJson.turns)) {
    throw new Error('Dữ liệu không đúng định dạng APK conversation.json');
  }

  const meta = apkJson.session;
  const sampleRate = apkJson.sampleRate || 16000;
  const sampleToMs = (s: number) => Math.round((s * 1000) / sampleRate);

  let targetId = meta.id || Date.now().toString();
  const existing = await db.recordings.get(targetId);
  if (existing) {
    targetId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  const mode: ClassroomMode = meta.mode === 'classroom' ? 'lecture' : 'readingPractice';
  const durationMs = meta.samples ? sampleToMs(meta.samples) : 0;
  const audioState: AudioState = wavBlob ? 'present' : (meta.audioState as AudioState) || 'missing';

  const newRecording: RecordingItem = {
    id: targetId,
    title: `APK Nhập: ${new Date(meta.createdAt).toLocaleString('vi-VN')}`,
    createdAt: meta.createdAt || new Date().toISOString(),
    endedAt: meta.endedAt,
    mode,
    sourceLanguage: 'ja',
    targetLanguage: 'vi',
    state: (meta.state as RecordingState) || 'stopped',
    durationMs,
    audioState,
    audioDeletedAt: meta.audioDeletedAt,
    audioMimeType: wavBlob ? 'audio/wav' : undefined,
    config: {
      translationModelKey: 'apk-imported',
    },
  };

  await db.recordings.put(newRecording);

  // Convert turns into captions
  for (let idx = 0; idx < apkJson.turns.length; idx++) {
    const turn = apkJson.turns[idx];
    const caption: CaptionItem = {
      id: idx + 1,
      recordingId: targetId,
      blockId: turn.liveBlockId || 1,
      startMs: sampleToMs(turn.startSample),
      endMs: sampleToMs(turn.endSample),
      source: turn.source || '',
      revision: turn.sourceRevision || 1,
      isFinal: turn.recognitionFinal !== 0,
      translation: turn.correctedTarget || turn.target || '',
      targetSourceRevision: turn.targetSourceRevision || 1,
      translationModelKey: 'apk-imported',
      state: turn.state === 'failed' ? 'failed' : 'done',
      error: turn.error,
      skipReason: turn.skipReason,
    };
    await saveCaption(caption);
  }

  // Import WAV audio if provided
  if (wavBlob) {
    await addAudioChunk({
      recordingId: targetId,
      sequence: 0,
      mimeType: 'audio/wav',
      timestamp: 0,
      blob: wavBlob,
    });
  }

  return newRecording;
}
