'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ClassroomController, type ControllerState, type StartOptions } from './controller';
import type { ClassroomMode } from '@/shared/recording';
import { loadSettings, saveSettings } from '@/storage/recordings';

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
  const pauseChangedByUserRef = useRef(false);

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
    loadSettings().then((settings) => {
      const controller = controllerRef.current!;
      if (!active || controller.snapshot().state !== 'stopped' || pauseChangedByUserRef.current) return;
      controller.setPauseMs(settings.pauseMs);
      controller.setReadingPauseMs(settings.readingPauseMs);
      controller.setTranslationModel(settings.translationModel);
      controller.setTranslationThinkingLevel(settings.translationThinkingLevel);
    }).catch((error) => console.warn('Không thể tải thời gian chốt câu:', error));
    return () => { active = false; };
  }, []);

  const updatePauseMs = (milliseconds: number) => {
    pauseChangedByUserRef.current = true;
    controllerRef.current!.setPauseMs(milliseconds);
    void saveSettings({ pauseMs: milliseconds }).catch((error) => console.warn('Không thể lưu thời gian chốt câu:', error));
  };

  const updateTranslationModel = (modelKey: string) => {
    controllerRef.current!.setTranslationModel(modelKey);
    void saveSettings({ translationModel: modelKey }).catch((error) => console.warn('Không thể lưu model dịch:', error));
  };

  const updateTranslationThinkingLevel = (level: string) => {
    controllerRef.current!.setTranslationThinkingLevel(level);
    void saveSettings({ translationThinkingLevel: level }).catch((error) => console.warn('Không thể lưu mức suy luận:', error));
  };

  const updateReadingPauseMs = (milliseconds: number) => {
    pauseChangedByUserRef.current = true;
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
