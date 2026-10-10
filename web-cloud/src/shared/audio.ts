import { z } from 'zod';
import { cloudRecordingIdSchema } from './cloud-recording';
import type { AudioChunk } from './recording';

export const AUDIO_FORMAT_VERSION = 1;
export const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
export const audioFileSchema = z.object({
  mimeType: z.enum(['audio/webm', 'audio/mp4', 'audio/wav']),
  durationMs: z.number().finite().positive().max(24 * 60 * 60 * 1000),
  sizeBytes: z.number().int().positive().max(MAX_AUDIO_BYTES),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  formatVersion: z.literal(AUDIO_FORMAT_VERSION),
}).strict();
export type AudioFileMetadata = z.infer<typeof audioFileSchema>;
export const remoteAudioSchema = z.object({
  recordingId: cloudRecordingIdSchema,
  version: z.number().int().positive(),
  state: z.enum(['pending', 'available', 'deleted']),
  file: audioFileSchema.nullable(),
  pathname: z.string().nullable(),
  updatedAt: z.string(),
}).strict();
export type RemoteAudio = z.infer<typeof remoteAudioSchema>;
export const audioMetadataResponseSchema = z.object({ audio: remoteAudioSchema.nullable() }).strict();
export interface LocalAudioAsset {
  recordingId: string;
  blob?: Blob;
  file?: AudioFileMetadata;
  remote?: RemoteAudio;
  status: 'normalizing' | 'queued' | 'uploading' | 'synced' | 'error' | 'deleted';
  error?: string;
}
export interface AudioSyncJob {
  recordingId: string;
  action: 'upload' | 'delete';
  attempts: number;
  nextAttemptAt: number;
  error?: string;
}
export const audioChangedEvent = 'recordings-audio-updated';
export const audioWorkEvent = 'recordings-audio-work';

export function compareAudioChunkOrder(a: AudioChunk, b: AudioChunk): number {
  // Pre-segment exports sometimes have reversed counters. New recorder
  // groups must use sequence: a late final chunk can arrive after group N+1.
  if (a.segmentIndex === undefined && b.segmentIndex === undefined) return a.timestamp - b.timestamp || (a.id ?? 0) - (b.id ?? 0) || a.sequence - b.sequence;
  return (a.segmentIndex ?? 1) - (b.segmentIndex ?? 1) || a.sequence - b.sequence || (a.id ?? 0) - (b.id ?? 0);
}
