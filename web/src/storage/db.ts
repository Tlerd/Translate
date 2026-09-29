import Dexie, { type EntityTable } from 'dexie';
import type {
  RecordingItem,
  AudioChunk,
  CaptionItem,
  SummaryItem,
  ImageItem,
} from '@/shared/recording';

export interface SettingRecord {
  key: string;
  value: string;
}

export class AppDatabase extends Dexie {
  recordings!: EntityTable<RecordingItem, 'id'>;
  audioChunks!: EntityTable<AudioChunk, 'id'>;
  captions!: EntityTable<CaptionItem, 'id'>;
  summaries!: EntityTable<SummaryItem, 'id'>;
  images!: EntityTable<ImageItem, 'id'>;
  settings!: EntityTable<SettingRecord, 'key'>;

  constructor(dbName = 'may_dich_offline_db') {
    super(dbName);

    this.version(1).stores({
      recordings: 'id, createdAt, state, mode, audioState',
      audioChunks: '++id, [recordingId+sequence], recordingId, sequence',
      captions: 'id, recordingId, blockId, [recordingId+id], startMs',
      summaries: 'id, recordingId, sourceHash',
      images: 'id, recordingId, summaryId',
      settings: 'key',
    });
  }
}

let dbInstance: AppDatabase | null = null;

export function getDb(): AppDatabase {
  if (typeof window === 'undefined') {
    // If running in SSR or Node without window, return instance (may use fake-indexeddb in tests)
    if (!dbInstance) {
      dbInstance = new AppDatabase();
    }
    return dbInstance;
  }
  if (!dbInstance) {
    dbInstance = new AppDatabase();
  }
  return dbInstance;
}

export function resetDbInstance(customDb?: AppDatabase): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore
    }
  }
  dbInstance = customDb ?? null;
}
