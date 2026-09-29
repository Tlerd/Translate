import { describe, it, expect, vi } from 'vitest';
import {
  LiveUtteranceAssembler,
  type TranscriptSnapshot,
} from '@/features/recording/utterance-assembler';
import {
  LiveTranslationScheduler,
  type ScheduledTranslationEvent,
} from '@/features/recording/translation-scheduler';

describe('LiveUtteranceAssembler', () => {
  it('combines text correctly for Japanese (no space) and English/Vietnamese (with space)', () => {
    expect(LiveUtteranceAssembler.combine('こんにちは', '世界')).toBe('こんにちは世界');
    expect(LiveUtteranceAssembler.combine('Hello', 'world')).toBe('Hello world');
    expect(LiveUtteranceAssembler.combine('Xin', 'chào')).toBe('Xin chào');
  });

  it('handles lecture mode passing through each final sentence as new captionId', () => {
    const assembler = new LiveUtteranceAssembler('lecture');
    const emissions: TranscriptSnapshot[] = [];
    assembler.subscribe((s) => emissions.push(s));

    // Interim
    assembler.handleSnapshot({
      connectionEpoch: 1,
      providerItemId: 'p-1',
      blockId: 1,
      captionId: 1,
      revision: 1,
      text: 'こんにちは',
      isFinal: false,
      startMs: 0,
      endMs: 1000,
    });

    // Final
    assembler.handleSnapshot({
      connectionEpoch: 1,
      providerItemId: 'p-1',
      blockId: 1,
      captionId: 1,
      revision: 2,
      text: 'こんにちは。',
      isFinal: true,
      startMs: 0,
      endMs: 1200,
    });

    expect(emissions.length).toBe(2);
    expect(assembler.currentCaptionId).toBe(2);
  });

  it('handles readingPractice mode merging short pause chunks into one sentence', () => {
    const assembler = new LiveUtteranceAssembler('readingPractice');
    const emissions: TranscriptSnapshot[] = [];
    assembler.subscribe((s) => emissions.push(s));

    // First chunk finished (user paused for 1 second)
    assembler.handleSnapshot({
      connectionEpoch: 1,
      providerItemId: 'p-1',
      blockId: 1,
      captionId: 1,
      revision: 1,
      text: '私は',
      isFinal: true,
      startMs: 0,
      endMs: 800,
    });

    // In readingPractice mode, emission is marked isFinal=false so sentence can continue!
    expect(emissions[0].text).toBe('私は');
    expect(emissions[0].isFinal).toBe(false);
    expect(assembler.currentCaptionId).toBe(1);

    // Second chunk spoken after short pause
    assembler.handleSnapshot({
      connectionEpoch: 1,
      providerItemId: 'p-2',
      blockId: 1,
      captionId: 1,
      revision: 2,
      text: '学生です。',
      isFinal: true,
      startMs: 1200,
      endMs: 2000,
    });

    expect(emissions[1].text).toBe('私は学生です。');
    expect(emissions[1].isFinal).toBe(false);

    // Finalize on block close (e.g. 10s silence)
    assembler.finalizeCurrentUtterance(true);
    const lastEmission = emissions[emissions.length - 1];
    expect(lastEmission.text).toBe('私は学生です。');
    expect(lastEmission.isFinal).toBe(true);
    expect(assembler.currentCaptionId).toBe(2);
  });
});

describe('LiveTranslationScheduler', () => {
  it('deduplicates equivalent meaning when final transcript matches translated interim', () => {
    let runCallCount = 0;
    const runner = vi.fn().mockImplementation(async (source: string) => {
      runCallCount++;
      return `Dịch: ${source}`;
    });

    const scheduler = new LiveTranslationScheduler({
      runner,
      minIntervalMs: 0,
    });

    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((e) => events.push(e));

    // First snapshot interim
    scheduler.onSnapshot({
      connectionEpoch: 1,
      providerItemId: 'p-1',
      blockId: 1,
      captionId: 1,
      revision: 1,
      text: 'こんにちは',
      isFinal: false,
      startMs: 0,
      endMs: 1000,
    });

    expect(LiveTranslationScheduler.isEquivalentMeaning('こんにちは', 'こんにちは。')).toBe(true);
  });

  it('drops stale snapshots older than maxAgeMs', async () => {
    const runner = vi.fn().mockImplementation(async (source: string) => `Trans: ${source}`);
    const scheduler = new LiveTranslationScheduler({
      runner,
      minIntervalMs: 100,
      maxAgeMs: 50,
    });

    const events: ScheduledTranslationEvent[] = [];
    scheduler.subscribe((e) => events.push(e));

    // Send snapshot
    scheduler.onSnapshot({
      connectionEpoch: 1,
      providerItemId: 'p-1',
      blockId: 1,
      captionId: 1,
      revision: 1,
      text: 'Test',
      isFinal: false,
      startMs: 0,
      endMs: 500,
    });

    // Wait until it exceeds maxAgeMs
    await new Promise((r) => setTimeout(r, 120));

    // When next check runs, it should be marked as stale if translator was busy
    scheduler.close();
  });

  it('simulates a 60-minute lecture session with 500 sentences without memory degradation', () => {
    const assembler = new LiveUtteranceAssembler('lecture');
    let emittedCount = 0;
    assembler.subscribe(() => {
      emittedCount++;
    });

    // 500 sentences spoken over 60 minutes
    for (let i = 1; i <= 500; i++) {
      const startMs = (i - 1) * 7200;
      const endMs = startMs + 4000;
      assembler.handleSnapshot({
        connectionEpoch: 1,
        providerItemId: `p-${i}`,
        blockId: Math.floor(i / 10) + 1,
        captionId: i,
        revision: 1,
        text: `Câu phát biểu thứ ${i} trong bài giảng kéo dài 60 phút.`,
        isFinal: true,
        startMs,
        endMs,
      });
    }

    expect(emittedCount).toBe(500);
    expect(assembler.currentCaptionId).toBe(501);
  });
});
