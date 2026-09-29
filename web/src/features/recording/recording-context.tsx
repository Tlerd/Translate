'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ClassroomController, type ControllerState, type StartOptions } from './controller';
import type { ClassroomMode } from '@/shared/recording';

interface RecordingContextValue {
  controller: ClassroomController;
  state: ControllerState;
  startRecording: (options?: StartOptions) => Promise<string>;
  stopRecording: () => Promise<void>;
  switchMode: (mode: ClassroomMode) => void;
  setTranslationModel: (modelKey: string) => void;
}

const RecordingContext = createContext<RecordingContextValue | null>(null);

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const controllerRef = useRef<ClassroomController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new ClassroomController();
  }

  const [state, setState] = useState<ControllerState>(() => controllerRef.current!.snapshot());

  useEffect(() => {
    const unsubscribe = controllerRef.current!.subscribe((nextState) => {
      setState(nextState);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const value: RecordingContextValue = {
    controller: controllerRef.current,
    state,
    startRecording: (options) => controllerRef.current!.start(options),
    stopRecording: () => controllerRef.current!.stop(),
    switchMode: (mode) => controllerRef.current!.switchMode(mode),
    setTranslationModel: (modelKey) => controllerRef.current!.setTranslationModel(modelKey),
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
