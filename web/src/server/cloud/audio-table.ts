import 'server-only';
import type { NeonQueryFunction } from '@neondatabase/serverless';

export async function ensureAudioTable(sql: NeonQueryFunction<false, false>) {
  await sql`CREATE TABLE IF NOT EXISTS recording_audio (
    owner_email text NOT NULL, recording_id text NOT NULL, version integer NOT NULL,
    state text NOT NULL, file jsonb, pathname text, updated_at timestamptz NOT NULL DEFAULT now(),
    cleanup_after timestamptz NOT NULL DEFAULT now() + interval '1 hour',
    PRIMARY KEY(owner_email, recording_id))`;
}
