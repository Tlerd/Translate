import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSpeechRecognizer } from '@/features/recording/speech-recognition';
import { LiveUtteranceAssembler, type TranscriptSnapshot } from '@/features/recording/utterance-assembler';
import { LiveTranslationScheduler, type ScheduledTranslationEvent } from '@/features/recording/translation-scheduler';

type Result = { transcript: string; isFinal: boolean };

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 1;
  onresult: ((event: Event & { resultIndex: number; results: SpeechRecognitionResultList }) => void) | null = null;
  onerror: ((event: Event & { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;

  constructor() { FakeRecognition.instances.push(this); }
  start() { this.onstart?.(); }
  stop() { this.onend?.(); }
  abort() { this.onend?.(); }

  send(resultIndex: number, rows: Result[]) {
    const results = rows.map(({ transcript, isFinal }) => {
      const alternative = { transcript } as SpeechRecognitionAlternative;
      return { 0: alternative, isFinal, length: 1 } as unknown as SpeechRecognitionResult;
    }) as unknown as SpeechRecognitionResultList;
    this.onresult?.({ resultIndex, results } as Event & { resultIndex: number; results: SpeechRecognitionResultList });
  }
}

afterEach(() => {
  FakeRecognition.instances = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('WebSpeechRecognizer result identity', () => {
  it('keeps simultaneous interim result indices as separate provider items', () => {
    vi.stubGlobal('window', { SpeechRecognition: FakeRecognition });
    const onTranscript = vi.fn();
    const recognizer = new WebSpeechRecognizer({
      onTranscript,
      onError: vi.fn(),
      onStateChange: vi.fn(),
    });
    recognizer.start(1);
    const provider = FakeRecognition.instances[0];

    provider.send(0, [
      { transcript: 'first spoken phrase', isFinal: false },
      { transcript: 'second phrase', isFinal: false },
    ]);

    expect(onTranscript.mock.calls.map(call => [call[0], call[1], call[3]])).toEqual([
      ['first spoken phrase', false, 'speech-1-1-0'],
      ['second phrase', false, 'speech-1-1-1'],
    ]);

    provider.send(1, [
      { transcript: 'first spoken phrase', isFinal: false },
      { transcript: 'second phrase, corrected', isFinal: false },
    ]);
    expect(onTranscript.mock.calls.at(-1)?.slice(0, 2)).toEqual(['second phrase, corrected', false]);
    expect(onTranscript.mock.calls.at(-1)?.[3]).toBe('speech-1-1-1');
    void recognizer.stop();
  });

  it('ignores callbacks after stop and preserves the accepted final before a late correction', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { SpeechRecognition: FakeRecognition });
    const onTranscript = vi.fn();
    const recognizer = new WebSpeechRecognizer({
      onTranscript,
      onError: vi.fn(),
      onStateChange: vi.fn(),
    });
    recognizer.start(7);
    const provider = FakeRecognition.instances[0];
    provider.send(0, [{ transcript: 'initial wording', isFinal: false }]);
    provider.send(0, [{ transcript: 'accepted wording', isFinal: true }]);
    provider.send(0, [{ transcript: 'legitimate corrected wording', isFinal: true }]);

    expect(onTranscript.mock.calls.map(call => [call[0], call[1], call[3], call[4]])).toEqual([
      ['initial wording', false, 'speech-7-1-0', 1],
      ['accepted wording', true, 'speech-7-1-0', 2],
      ['legitimate corrected wording', true, 'speech-7-1-0', 3],
    ]);

    const stopping = recognizer.stop();
    provider.send(0, [{ transcript: 'stale after stop', isFinal: true }]);
    expect(onTranscript).toHaveBeenCalledTimes(3);
    await vi.runAllTimersAsync();
    await stopping;
  });

  it('ignores result and end callbacks from an ended recognition instance after restart', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { SpeechRecognition: FakeRecognition });
    const onTranscript = vi.fn();
    const onStateChange = vi.fn();
    const recognizer = new WebSpeechRecognizer({
      onTranscript,
      onError: vi.fn(),
      onStateChange,
    });
    recognizer.start(9);
    const oldProvider = FakeRecognition.instances[0];
    oldProvider.onend?.();
    await vi.advanceTimersByTimeAsync(300);
    const currentProvider = FakeRecognition.instances[1];

    oldProvider.send(0, [{ transcript: 'stale old session result', isFinal: true }]);
    oldProvider.onend?.();
    currentProvider.send(0, [{ transcript: 'current result', isFinal: true }]);

    expect(onTranscript.mock.calls.map(([text]) => text)).toEqual(['current result']);
    expect(onStateChange.mock.calls.map(([state]) => state)).toEqual(['listening', 'reconnecting', 'listening']);
    const stopping = recognizer.stop();
    await vi.runAllTimersAsync();
    await stopping;
  });
});

describe('final transcript lifecycle', () => {
  const snapshot = (overrides: Partial<TranscriptSnapshot>): TranscriptSnapshot => ({
    connectionEpoch: 1, providerItemId: 'speech-a', blockId: 1, captionId: 1,
    revision: 1, text: 'accepted words', isFinal: true, startMs: 0, endMs: 500,
    ...overrides,
  });

  it('accepts a correction from the finalized provider item but rejects a different late result', () => {
    const assembler = new LiveUtteranceAssembler('lecture');
    const emitted: TranscriptSnapshot[] = [];
    assembler.subscribe((value) => emitted.push(value));
    assembler.handleSnapshot(snapshot({}));

    assembler.handleSnapshot(snapshot({
      providerItemId: 'speech-b', revision: 2, text: 'unrelated late sentence', isFinal: true,
    }));
    assembler.handleSnapshot(snapshot({
      providerItemId: 'speech-a', revision: 2, text: 'corrected accepted words', isFinal: true,
    }));

    expect(emitted.map(({ providerItemId, text, isFinal }) => [providerItemId, text, isFinal])).toEqual([
      ['speech-a', 'accepted words', true],
      ['speech-a', 'corrected accepted words', true],
    ]);
    expect(assembler.currentCaptionId).toBe(2);
  });

  it('does not let a newer interim snapshot rewrite a finalized scheduler row', async () => {
    const calls: string[] = [];
    const scheduler = new LiveTranslationScheduler({
      runner: async (source) => { calls.push(source); return `target:${source}`; },
      minIntervalMs: 0,
    });
    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((event) => events.push(event));
    const final = snapshot({ revision: 2 });
    scheduler.onSnapshot(final);
    await scheduler.drain();
    const acceptedEventCount = events.length;

    scheduler.onSnapshot({ ...final, revision: 3, text: 'different unrelated phrase', isFinal: false });
    await scheduler.drain();

    expect(calls).toEqual(['accepted words']);
    expect(events).toHaveLength(acceptedEventCount);
    scheduler.close();
  });
});
