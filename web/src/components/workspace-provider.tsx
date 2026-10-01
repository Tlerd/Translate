'use client';
import { RecordingProvider } from '@/features/recording/recording-context';
import { AppShell } from '@/components/app-shell';
export function WorkspaceProvider({ children, accountControls }: { children: React.ReactNode; accountControls: React.ReactNode }) {
  return <RecordingProvider><AppShell accountControls={accountControls}>{children}</AppShell></RecordingProvider>;
}
