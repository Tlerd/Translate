'use client';
import { RecordingProvider } from '@/features/recording/recording-context';
import { AppShell } from '@/components/app-shell';
import { CloudSyncStatus } from '@/components/cloud-sync-status';
export function WorkspaceProvider({ children, accountControls }: { children: React.ReactNode; accountControls: React.ReactNode }) {
  return <RecordingProvider><AppShell accountControls={<><CloudSyncStatus />{accountControls}</>}>{children}</AppShell></RecordingProvider>;
}
