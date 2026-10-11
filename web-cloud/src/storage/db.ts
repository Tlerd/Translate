import Dexie, { type EntityTable, type Table } from 'dexie';
import type { AudioSyncJob, LocalAudioAsset } from '@/shared/audio';
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

export const DEFAULT_DB_NAME = 'may_dich_offline_db';

export class AppDatabase extends Dexie {
  recordings!: EntityTable<RecordingItem, 'id'>;
  audioChunks!: EntityTable<AudioChunk, 'id'>;
  audioSegments!: EntityTable<AudioSegmentItem, 'id'>;
  audioAssets!: EntityTable<LocalAudioAsset, 'recordingId'>;
  audioJobs!: EntityTable<AudioSyncJob, 'recordingId'>;
  // Caption numbers restart in each recording, so both fields form its identity.
  get captions(): Table<CaptionItem, [string, number]> {
    return this.table('captionItems');
  }
  summaries!: EntityTable<SummaryItem, 'id'>;
  images!: EntityTable<ImageItem, 'id'>;
  settings!: EntityTable<SettingRecord, 'key'>;

  constructor(dbName = DEFAULT_DB_NAME) {
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
    this.version(5).stores({
      audioAssets: 'recordingId, status',
      audioJobs: 'recordingId, action, nextAttemptAt',
    });
  }
}

let dbInstance: AppDatabase | null = null;
let dbName = DEFAULT_DB_NAME;

/** Database name for an account namespace; the owner and local development keep the original name. */
export function accountDbName(namespace?: string | null): string {
  return namespace ? `${DEFAULT_DB_NAME}_${namespace}` : DEFAULT_DB_NAME;
}

/**
 * Selects the signed-in account's local database before any read, so people
 * sharing one browser never see or sync each other's recordings.
 */
export function selectAccountDb(namespace?: string | null): void {
  const name = accountDbName(namespace);
  if (name === dbName) return;
  resetDbInstance();
  dbName = name;
}

export function getDb(): AppDatabase {
  if (!dbInstance) dbInstance = new AppDatabase(dbName);
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
