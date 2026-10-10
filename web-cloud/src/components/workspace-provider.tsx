'use client';

import React from 'react';
import { RecordingProvider } from '@/features/recording/recording-context';
import { AppShell } from '@/components/app-shell';
import { AccountProvider } from '@/components/account-context';

export function WorkspaceProvider({
  children,
  accountControls,
}: {
  children: React.ReactNode;
  accountControls: React.ReactNode;
}) {
  // CloudSyncStatus lives in the library navigator (sidebar footer), so it is not repeated here.
  return (
    <AccountProvider accountControls={accountControls}>
      <RecordingProvider>
        <AppShell accountControls={accountControls}>
          {children}
        </AppShell>
      </RecordingProvider>
    </AccountProvider>
  );
}
