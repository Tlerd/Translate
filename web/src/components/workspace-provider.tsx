'use client';

import React from 'react';
import { RecordingProvider } from '@/features/recording/recording-context';
import { AppShell } from '@/components/app-shell';
import { CloudSyncStatus } from '@/components/cloud-sync-status';
import { AccountProvider } from '@/components/account-context';

export function WorkspaceProvider({
  children,
  accountControls,
}: {
  children: React.ReactNode;
  accountControls: React.ReactNode;
}) {
  const combinedControls = (
    <>
      <CloudSyncStatus />
      {accountControls}
    </>
  );

  return (
    <AccountProvider accountControls={combinedControls}>
      <RecordingProvider>
        <AppShell accountControls={combinedControls}>
          {children}
        </AppShell>
      </RecordingProvider>
    </AccountProvider>
  );
}
