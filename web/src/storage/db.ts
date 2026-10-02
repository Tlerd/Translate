import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  RecordingItem,
  AudioChunk,
  AudioSegmentItem,
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
  audioSegments!: EntityTable<AudioSegmentItem, 'id'>;
  // Caption numbers restart in each recording, so both fields form its identity.
  get captions(): Table<CaptionItem, [string, number]> {
    return this.table('captionItems');
  }
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

    // Dexie cannot change an existing store's primary key in place. Copy it
    // while the old store is still available, then remove it in the next version.
    this.version(2).stores({
      captionItems: '[recordingId+id], id, recordingId, blockId, startMs',
    }).upgrade(async (transaction) => {
      const previous = await transaction.table<CaptionItem>('captions').toArray();
      await transaction.table<CaptionItem>('captionItems').bulkPut(previous);
    });
    this.version(3).stores({ captions: null });

    this.version(4).stores({
      audioSegments: '++id, [recordingId+segmentIndex], recordingId, segmentIndex, status',
      audioChunks: '++id, [recordingId+sequence], recordingId, sequence, [recordingId+segmentIndex]',
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
