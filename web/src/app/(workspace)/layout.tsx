'use client';

import React from 'react';
import { RecordingProvider } from '@/features/recording/recording-context';
import { AppShell } from '@/components/app-shell';

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RecordingProvider>
      <AppShell>{children}</AppShell>
    </RecordingProvider>
  );
}
