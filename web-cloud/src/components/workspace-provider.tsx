'use client';

import React from 'react';
import { RecordingProvider } from '@/features/recording/recording-context';
import { AppShell } from '@/components/app-shell';
import { AccountProvider } from '@/components/account-context';
import { selectAccountDb } from '@/storage/db';

export function WorkspaceProvider({
  children,
  accountControls,
  dataNamespace = null,
  accountEmail = null,
}: {
  children: React.ReactNode;
  accountControls: React.ReactNode;
  dataNamespace?: string | null;
  accountEmail?: string | null;
}) {
  // Runs during render, before any child effect opens IndexedDB.
  selectAccountDb(dataNamespace);
  // CloudSyncStatus lives in the library navigator (sidebar footer), so it is not repeated here.
  return (
    <AccountProvider accountControls={accountControls} accountEmail={accountEmail}>
      <RecordingProvider>
        <AppShell accountControls={accountControls}>
          {children}
        </AppShell>
      </RecordingProvider>
    </AccountProvider>
  );
}
