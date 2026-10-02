'use client';

import React from 'react';
import { AiSettings } from '@/features/settings/ai-settings';
import { TranslationConnectionTest } from '@/features/settings/translation-connection-test';
import { SpeechConnectionTest } from '@/features/settings/speech-connection-test';

export default function SettingsPage() {
  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <AiSettings />
      <TranslationConnectionTest />
      <SpeechConnectionTest />
    </div>
  );
}
