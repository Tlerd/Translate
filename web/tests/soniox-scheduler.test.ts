import { afterEach, expect, it, vi } from 'vitest';
import { LiveTranslationScheduler } from '@/features/recording/translation-scheduler';
afterEach(() => vi.useRealTimers());
it('retraction drops pending provisional text while preserving every queued final', async () => {
  vi.useFakeTimers();
  let finish!: (text: string) => void;
  const runner = vi.fn((source: string) => new Promise<string>((resolve) => { finish = (text) => resolve(`${source}: ${text}`); }));
  const scheduler = new LiveTranslationScheduler({ runner, minIntervalMs: 0 });
  const snapshot = (captionId: number, text: string, revision = 1, isFinal = true) => ({ connectionEpoch: 0, providerItemId: `id-${captionId}`, captionId, blockId: 1, text, revision, isFinal, startMs: 0, endMs: 100 });
  scheduler.onSnapshot(snapshot(1, 'first'));
  await vi.advanceTimersByTimeAsync(0);
  scheduler.onSnapshot(snapshot(2, 'second'));
  scheduler.onSnapshot(snapshot(3, 'third'));
  scheduler.onSnapshot(snapshot(4, 'retract me', 1, false));
  scheduler.onSnapshot(snapshot(4, '', 2, false));
  for (let i = 0; i < 3; i++) { finish('translation'); await vi.advanceTimersByTimeAsync(0); }
  await scheduler.drain();
  expect(runner.mock.calls.map((call) => call[0])).toEqual(['first', 'second', 'third']);
  scheduler.close();
});
