import { getDb } from '@/storage/db';
import type { LocalAudioAsset } from '@/shared/audio';
import type { RecordingItem } from '@/shared/recording';
import type { LibraryEntry, SyncState } from './library-query';

type AssetStatus = LocalAudioAsset['status'];

const CLOUD_KEY_PREFIX = 'cloud:';
const ASSET_STATUSES: readonly AssetStatus[] = ['normalizing', 'queued', 'uploading', 'synced', 'error', 'deleted'];
// Audio still on its way to the cloud.
const AUDIO_IN_FLIGHT: ReadonlySet<AssetStatus> = new Set<AssetStatus>(['normalizing', 'queued', 'uploading']);
// Audio that needs nothing more: uploaded, or deliberately removed.
const AUDIO_DONE: ReadonlySet<AssetStatus> = new Set<AssetStatus>(['synced', 'deleted']);

function syncStateOf(recording: RecordingItem, hasCloudText: boolean, assetStatus: AssetStatus | undefined): SyncState {
  if (assetStatus === 'error') return 'error';
  if (recording.state === 'recording') return 'local';
  // Text (captions, summaries) is only confirmed once the cloud baseline key exists.
  if (!hasCloudText) return 'pending';
  if (assetStatus === undefined || AUDIO_DONE.has(assetStatus)) return 'synced';
  if (AUDIO_IN_FLIGHT.has(assetStatus)) return recording.audioState === 'present' ? 'pending' : 'synced';
  return 'pending';
}

/**
 * Reads the library rows without loading captions, summary bodies or audio blobs.
 * Soft-deleted recordings are excluded.
 */
export async function loadLibraryEntries(): Promise<LibraryEntry[]> {
  const db = getDb();

  const [recordings, summaryRecordingIds, cloudIds, assetKeysByStatus] = await Promise.all([
    db.recordings.filter((recording) => !recording.deletedAt).toArray(),
    db.summaries.orderBy('recordingId').uniqueKeys(),
    db.settings.where('key').startsWith(CLOUD_KEY_PREFIX).primaryKeys(),
    Promise.all(
      ASSET_STATUSES.map(async (status) => {
        const ids = await db.audioAssets.where('status').equals(status).primaryKeys();
        return [status, ids] as const;
      }),
    ),
  ]);

  const summarized = new Set(summaryRecordingIds.filter((id): id is string => typeof id === 'string'));
  const cloudTexts = new Set(cloudIds.map((key) => key.slice(CLOUD_KEY_PREFIX.length)));
  const assetStatus = new Map<string, AssetStatus>();
  for (const [status, ids] of assetKeysByStatus) {
    for (const id of ids) assetStatus.set(id, status);
  }

  return recordings.map((recording) => ({
    recording,
    hasSummary: summarized.has(recording.id),
    sync: syncStateOf(recording, cloudTexts.has(recording.id), assetStatus.get(recording.id)),
  }));
}
