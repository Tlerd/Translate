'use client';

import React from 'react';
import { AiSettings } from '@/features/settings/ai-settings';

export default function SettingsPage() {
  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <AiSettings />
    </div>
  );
}
