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
  interim(text: string) {
    const result = { transcript: text } as SpeechRecognitionAlternative;
    const results = [{ 0: result, isFinal: false, length: 1 }] as unknown as SpeechRecognitionResultList;
    this.onresult?.({ resultIndex: 0, results } as Event & { resultIndex: number; results: SpeechRecognitionResultList });
  }
  final(text: string) {
    const alternative = { transcript: text } as SpeechRecognitionAlternative;
    const results = [{ 0: alternative, isFinal: true, length: 1 }] as unknown as SpeechRecognitionResultList;
    this.onresult?.({ resultIndex: 0, results } as Event & { resultIndex: number; results: SpeechRecognitionResultList });
  }
}

function streamingResponse(delta: string) {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      streamController.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ delta })}\n\n`));
    },
  }), { status: 200 });
  return {
    response,
    finish(fullText: string) {
      controller!.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ fullText, modelKey: 'm' })}\n\n`));
      controller!.close();
    },
  };
}

function completedResponse(delta: string) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ delta })}\n\n`));
      controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ fullText: delta, modelKey: 'm' })}\n\n`));
      controller.close();
    },
  }), { status: 200 });
}

describe('ClassroomController stop boundary', () => {
  beforeEach(() => {
    FakeSpeechRecognition.instances = [];
    resetDbInstance(new AppDatabase(`controller_test_${Date.now()}_${Math.random()}`));
  });
  afterEach(() => {
    resetDbInstance();
    vi.unstubAllGlobals();
  });

  it('keeps streamed targets live and drains the final transcript revision before stopping', async () => {
    const track = { stop: vi.fn() };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) } });
    vi.stubGlobal('window', { SpeechRecognition: FakeSpeechRecognition });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    const requests: Array<Record<string, unknown>> = [];
    const streams: ReturnType<typeof streamingResponse>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      const stream = streamingResponse(`target-${requests.length}`);
      streams.push(stream);
      return stream.response;
    }));

    const controller = new ClassroomController();
    await controller.start({ pauseMs: 10_000 });
    FakeSpeechRecognition.instances[0].interim('unfinished source');
    await vi.waitFor(() => expect(controller.snapshot().captions.some((caption) => caption.translation === 'target-1')).toBe(true));
    expect(controller.snapshot().captions[0]).toMatchObject({ source: 'unfinished source', state: 'streaming' });

    const stopping = controller.stop();
    await vi.waitFor(() => expect(controller.snapshot().captions.some((caption) => caption.isFinal)).toBe(true));
    expect(controller.snapshot().captions[0]).toMatchObject({ state: 'streaming', isFinal: true });
    streams[0].finish('complete interim translation');
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toMatchObject({ captionId: 1, revision: 2 });
    streams[1].finish('final translation');
    await stopping;

    expect(controller.snapshot()).toMatchObject({ state: 'stopped' });
    expect(controller.snapshot().captions[0]).toMatchObject({
      source: 'unfinished source', translation: 'final translation', state: 'done', isFinal: true,
    });
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('keeps a finalized source and partial target while marking a failed request', async () => {
    const track = { stop: vi.fn() };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) } });
    vi.stubGlobal('window', { SpeechRecognition: FakeSpeechRecognition });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(streamController) {
        const encoder = new TextEncoder();
        streamController.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ delta: 'partial target' })}\n\n`));
        streamController.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: 'provider failed' })}\n\n`));
        streamController.close();
      },
    }), { status: 200 })));

    const controller = new ClassroomController();
    await controller.start({  });
    FakeSpeechRecognition.instances[0].final('final source');
    await vi.waitFor(() => expect(controller.snapshot().captions[0]?.state).toBe('failed'));
    expect(controller.snapshot().captions[0]).toMatchObject({
      source: 'final source', translation: 'partial target', state: 'failed', isFinal: true,
      error: 'provider failed',
    });
    await controller.stop();
  });

  it('updates the same caption when Web Speech final arrives after the silence pause', async () => {
    const track = { stop: vi.fn() };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) } });
    vi.stubGlobal('window', { SpeechRecognition: FakeSpeechRecognition });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as { text: string };
      return completedResponse(`Dịch: ${request.text}`);
    }));

    const controller = new ClassroomController();
    await controller.start({ pauseMs: 600 });
    const recognizer = FakeSpeechRecognition.instances[0];
    recognizer.interim('rough source');
    await vi.waitFor(() => expect(controller.snapshot().captions[0]?.source).toBe('rough source'));
    await new Promise((resolve) => setTimeout(resolve, 650));
    await vi.waitFor(() => expect(controller.snapshot().captions[0]?.isFinal).toBe(true));

    recognizer.final('final source');
    await vi.waitFor(() => expect(controller.snapshot().captions[0]?.source).toBe('final source'));
    expect(controller.snapshot().captions).toHaveLength(1);
    await controller.stop();
  });
});
