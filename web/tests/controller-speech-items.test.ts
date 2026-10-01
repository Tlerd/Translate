import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassroomController } from '@/features/recording/controller';
import { AppDatabase, resetDbInstance } from '@/storage/db';

// These regressions exercise caption revisions with the existing event fixture.
vi.mock('@/features/recording/gemini-pcm-capture', () => ({
  GeminiPcmCapture: class {
    state = 'running';
    async prepare() {}
    async start() {}
    async stop() {}
  },
}));
vi.mock('@/features/recording/gemini-transcribe-recognition', async () => {
  const { WebSpeechRecognizer } = await vi.importActual<typeof import('@/features/recording/speech-recognition')>('@/features/recording/speech-recognition');
  return { GeminiTranscribeRecognizer: class extends WebSpeechRecognizer {
    pushPcm() {}
    updateSettings() {}
  } };
});


class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  state: RecordingState = 'inactive';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, Array<() => void>>();
  constructor(stream: MediaStream, options?: MediaRecorderOptions) { void stream; void options; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['final audio']) } as BlobEvent);
    this.listeners.get('stop')?.forEach((listener) => listener());
  }
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), listener]);
  }
}

type ResultInput = { transcript: string; isFinal: boolean };

class FakeSpeechRecognition {
  static instances: FakeSpeechRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 1;
  onresult: ((event: Event & { resultIndex: number; results: SpeechRecognitionResultList }) => void) | null = null;
  onerror: ((event: Event & { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  constructor() { FakeSpeechRecognition.instances.push(this); }
  start() { this.onstart?.(); }
  stop() { this.onend?.(); }
  abort() { this.onend?.(); }
  send(resultIndex: number, inputs: ResultInput[]) {
    const results = inputs.map(({ transcript, isFinal }) => {
      const alternative = { transcript } as SpeechRecognitionAlternative;
      return { 0: alternative, isFinal, length: 1 } as unknown as SpeechRecognitionResult;
    }) as unknown as SpeechRecognitionResultList;
    this.onresult?.({ resultIndex, results } as Event & { resultIndex: number; results: SpeechRecognitionResultList });
  }
}

function completedResponse(text: string) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(streamController) {
      streamController.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ delta: `Dịch: ${text}` })}\n\n`));
      streamController.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ fullText: `Dịch: ${text}`, modelKey: 'test' })}\n\n`));
      streamController.close();
    },
  }), { status: 200 });
}

describe('ClassroomController provider result rows', () => {
  beforeEach(() => {
    FakeSpeechRecognition.instances = [];
    resetDbInstance(new AppDatabase(`speech_items_${Date.now()}_${Math.random()}`));
  });
  afterEach(() => {
    resetDbInstance();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps concurrent interim result indices in separate captions through their final callbacks', async () => {
    const track = { stop: vi.fn() };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) } });
    vi.stubGlobal('window', { SpeechRecognition: FakeSpeechRecognition });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as { text: string };
      return completedResponse(request.text);
    }));

    const controller = new ClassroomController();
    await controller.start({ pauseMs: 10_000 });
    const recognition = FakeSpeechRecognition.instances[0];
    recognition.send(0, [
      { transcript: 'first phrase', isFinal: false },
      { transcript: 'second phrase', isFinal: false },
    ]);
    recognition.send(0, [
      { transcript: 'first phrase final', isFinal: true },
      { transcript: 'second phrase final', isFinal: true },
    ]);

    await vi.waitFor(() => expect(controller.snapshot().captions.filter((caption) => caption.isFinal)).toHaveLength(2));
    expect(controller.snapshot().captions.map((caption) => caption.source)).toEqual([
      'first phrase final',
      'second phrase final',
    ]);
    await controller.stop();
  });

  it('keeps result identities separate when Web Speech reconnects in the same session epoch', async () => {
    const track = { stop: vi.fn() };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) } });
    vi.stubGlobal('window', { SpeechRecognition: FakeSpeechRecognition });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as { text: string };
      return completedResponse(request.text);
    }));

    const controller = new ClassroomController();
    await controller.start({ pauseMs: 10_000 });
    const oldRecognition = FakeSpeechRecognition.instances[0];
    oldRecognition.send(0, [{ transcript: 'before reconnect', isFinal: true }]);
    oldRecognition.onend?.();
    await new Promise((resolve) => setTimeout(resolve, 350));
    const newRecognition = FakeSpeechRecognition.instances[1];
    newRecognition.send(0, [{ transcript: 'after reconnect', isFinal: true }]);

    await vi.waitFor(() => expect(controller.snapshot().captions.filter((caption) => caption.isFinal)).toHaveLength(2));
    expect(controller.snapshot().captions.map((caption) => caption.source)).toEqual([
      'before reconnect',
      'after reconnect',
    ]);
    await controller.stop();
  });
});
