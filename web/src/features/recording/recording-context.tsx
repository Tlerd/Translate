'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ClassroomController, type ControllerState, type StartOptions } from './controller';
import type { ClassroomMode } from '@/shared/recording';
import { loadSettings, saveSettings, settingsUpdatedEvent } from '@/storage/recordings';
import type { AppSettings } from '@/shared/recording';

interface RecordingContextValue {
  controller: ClassroomController;
  state: ControllerState;
  startRecording: (options?: StartOptions) => Promise<string>;
  stopRecording: () => Promise<void>;
  switchMode: (mode: ClassroomMode) => void;
  setTranslationModel: (modelKey: string) => void;
  setTranslationThinkingLevel: (level: string) => void;
  setPauseMs: (milliseconds: number) => void;
  setReadingPauseMs: (milliseconds: number) => void;
}

const RecordingContext = createContext<RecordingContextValue | null>(null);

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const controllerRef = useRef<ClassroomController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new ClassroomController();
  }

  const [state, setState] = useState<ControllerState>(() => controllerRef.current!.snapshot());
  const settingsChangedByUserRef = useRef(false);

  useEffect(() => {
    const unsubscribe = controllerRef.current!.subscribe((nextState) => {
      setState(nextState);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const applySettings = (settings: Partial<AppSettings>) => {
      const controller = controllerRef.current;
      if (!controller) return;
      if (settings.pauseMs !== undefined) controller.setPauseMs(settings.pauseMs);
      if (settings.readingPauseMs !== undefined) controller.setReadingPauseMs(settings.readingPauseMs);
      if (settings.translationModel !== undefined) controller.setTranslationModel(settings.translationModel);
      if (settings.translationThinkingLevel !== undefined) controller.setTranslationThinkingLevel(settings.translationThinkingLevel);
      if (settings.speechProvider !== undefined) controller.setSpeechProvider(settings.speechProvider);
      controller.setTranscriptionSettings({ transcriptionMode: settings.transcriptionMode, speakerCount: settings.speakerCount });
    };

    loadSettings().then((settings) => {
      if (!active || settingsChangedByUserRef.current) return;
      if (controllerRef.current?.snapshot().state !== 'stopped') return;
      applySettings(settings);
    }).catch((error) => console.warn('Không thể tải cài đặt:', error));

    const handleEvent = (event: Event) => {
      const customEvent = event as CustomEvent<Partial<AppSettings>>;
      if (customEvent.detail) {
        settingsChangedByUserRef.current = true;
        applySettings(customEvent.detail);
      }
    };
    window.addEventListener(settingsUpdatedEvent, handleEvent);

    return () => {
      active = false;
      window.removeEventListener(settingsUpdatedEvent, handleEvent);
    };
  }, []);

  const updatePauseMs = (milliseconds: number) => {
    settingsChangedByUserRef.current = true;
    controllerRef.current!.setPauseMs(milliseconds);
    void saveSettings({ pauseMs: milliseconds }).catch((error) => console.warn('Không thể lưu thời gian chốt câu:', error));
  };

  const updateTranslationModel = (modelKey: string) => {
    settingsChangedByUserRef.current = true;
    controllerRef.current!.setTranslationModel(modelKey);
    void saveSettings({ translationModel: modelKey }).catch((error) => console.warn('Không thể lưu model dịch:', error));
  };

  const updateTranslationThinkingLevel = (level: string) => {
    settingsChangedByUserRef.current = true;
    controllerRef.current!.setTranslationThinkingLevel(level);
    void saveSettings({ translationThinkingLevel: level }).catch((error) => console.warn('Không thể lưu mức suy luận:', error));
  };

  const updateReadingPauseMs = (milliseconds: number) => {
    settingsChangedByUserRef.current = true;
    controllerRef.current!.setReadingPauseMs(milliseconds);
    void saveSettings({ readingPauseMs: milliseconds }).catch((error) => console.warn('Không thể lưu thời gian chốt câu:', error));
  };

  const value: RecordingContextValue = {
    controller: controllerRef.current,
    state,
    startRecording: (options) => controllerRef.current!.start(options),
    stopRecording: () => controllerRef.current!.stop(),
    switchMode: (mode) => controllerRef.current!.switchMode(mode),
    setTranslationModel: updateTranslationModel,
    setTranslationThinkingLevel: updateTranslationThinkingLevel,
    setPauseMs: updatePauseMs,
    setReadingPauseMs: updateReadingPauseMs,
  };

  return <RecordingContext.Provider value={value}>{children}</RecordingContext.Provider>;
}

export function useRecording(): RecordingContextValue {
  const context = useContext(RecordingContext);
  if (!context) {
    throw new Error('useRecording must be used within a RecordingProvider');
  }
  return context;
}
