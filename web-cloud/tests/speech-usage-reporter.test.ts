import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeechUsageReporter, SPEECH_USAGE_FLUSH_MS, type SpeechUsageReport } from '@/features/recording/speech-usage-reporter';

const UUIDS = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);

function setup(send: (report: SpeechUsageReport, options: { keepalive: boolean }) => unknown = () => undefined) {
  const sent: Array<{ report: SpeechUsageReport; keepalive: boolean }> = [];
  let ids = 0;
  const pageTarget = new EventTarget();
  const reporter = new SpeechUsageReporter('rec-1', {
    send: (report, options) => { sent.push({ report, keepalive: options.keepalive }); return send(report, options); },
    newSessionId: () => UUIDS[ids++],
    pageTarget,
  });
  reporter.start();
  return { reporter, sent, pageTarget };
}

describe('SpeechUsageReporter', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] }); vi.setSystemTime(new Date('2026-10-10T03:00:00.000Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('flushes the growing open-stream time every minute under one sessionId', async () => {
    const { reporter, sent } = setup();
    reporter.openStream({ provider: 'soniox', translated: true });
    await vi.advanceTimersByTimeAsync(SPEECH_USAGE_FLUSH_MS);
    await vi.advanceTimersByTimeAsync(SPEECH_USAGE_FLUSH_MS);
    expect(sent.map((s) => s.report.audioMs)).toEqual([60_000, 120_000]);
    expect(new Set(sent.map((s) => s.report.sessionId)).size).toBe(1);
    expect(sent[0].report).toMatchObject({
      sessionId: UUIDS[0], recordingId: 'rec-1', provider: 'soniox', model: 'stt-rt-v5', translated: true,
      startedAt: '2026-10-10T03:00:00.000Z',
    });
    expect(sent[0].report.endedAt).toBeUndefined();
    expect(sent.every((s) => !s.keepalive)).toBe(true);
    reporter.finish();
  });

  it('sums renewals of the same session and excludes closed (paused) time', async () => {
    const { reporter, sent } = setup();
    const first = reporter.openStream({ provider: 'nemotron', translated: false });
    await vi.advanceTimersByTimeAsync(10_000);
    reporter.closeStream(first);
    await vi.advanceTimersByTimeAsync(5_000); // between renewals / not streaming
    const second = reporter.openStream({ provider: 'nemotron', translated: false });
    await vi.advanceTimersByTimeAsync(7_000);
    reporter.closeStream(second);
    reporter.closeStream(second); // idempotent
    reporter.finish();
    expect(sent).toHaveLength(1);
    expect(sent[0].report).toMatchObject({ audioMs: 17_000, provider: 'nemotron', endedAt: expect.any(String) });
  });

  it('adds sent segment audio for google-transcribe', () => {
    const { reporter, sent } = setup();
    reporter.addAudio({ provider: 'google-transcribe', translated: false }, 3000);
    reporter.addAudio({ provider: 'google-transcribe', translated: false }, 2500);
    reporter.addAudio({ provider: 'google-transcribe', translated: false }, Number.NaN);
    reporter.finish();
    expect(sent.map((s) => s.report.audioMs)).toEqual([5500]);
    expect(sent[0].report.model).toBe('gemini-3.5-transcribe');
  });

  it('never reports 0 ms, including on stop and for streams opened and closed instantly', async () => {
    const { reporter, sent } = setup();
    const id = reporter.openStream({ provider: 'google', translated: false });
    reporter.closeStream(id);
    await vi.advanceTimersByTimeAsync(SPEECH_USAGE_FLUSH_MS * 3);
    reporter.finish();
    expect(sent).toEqual([]);
  });

  it('does not resend unchanged totals', async () => {
    const { reporter, sent } = setup();
    reporter.addAudio({ provider: 'google-transcribe', translated: false }, 1000);
    await vi.advanceTimersByTimeAsync(SPEECH_USAGE_FLUSH_MS * 3);
    expect(sent).toHaveLength(1);
    reporter.finish();
    expect(sent).toHaveLength(2); // final report with endedAt
    expect(sent[1].report.endedAt).toBeDefined();
  });

  it('starts a new sessionId after rollover and still closes the old one when its stream drains late', async () => {
    const { reporter, sent } = setup();
    const draining = reporter.openStream({ provider: 'soniox', translated: false });
    await vi.advanceTimersByTimeAsync(4_000);
    reporter.rollover(); // resume while the old stream is still draining
    const resumed = reporter.openStream({ provider: 'soniox', translated: false });
    await vi.advanceTimersByTimeAsync(2_000);
    reporter.closeStream(draining);
    await vi.advanceTimersByTimeAsync(3_000);
    reporter.closeStream(resumed);
    reporter.finish();
    const finals = sent.filter((s) => s.report.endedAt).map((s) => [s.report.sessionId, s.report.audioMs]).sort();
    expect(finals).toEqual([[UUIDS[0], 6_000], [UUIDS[1], 5_000]]);
  });

  it('keeps providers and Soniox translation modes in separate sessions', () => {
    const { reporter, sent } = setup();
    reporter.addAudio({ provider: 'soniox', translated: false }, 1000);
    reporter.addAudio({ provider: 'soniox', translated: true }, 2000);
    reporter.finish();
    expect(sent.map((s) => [s.report.translated, s.report.audioMs])).toEqual([[false, 1000], [true, 2000]]);
    expect(new Set(sent.map((s) => s.report.sessionId)).size).toBe(2);
  });

  it('flushes with keepalive on pagehide', () => {
    const { reporter, sent, pageTarget } = setup();
    reporter.addAudio({ provider: 'google', translated: true }, 4000);
    pageTarget.dispatchEvent(new Event('pagehide'));
    expect(sent).toHaveLength(1);
    expect(sent[0].keepalive).toBe(true);
    reporter.finish();
  });

  it('swallows sender errors, sync and async', async () => {
    const throwing = setup(() => { throw new Error('boom'); });
    throwing.reporter.addAudio({ provider: 'google', translated: false }, 1000);
    expect(() => throwing.reporter.finish()).not.toThrow();

    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const rejecting = setup(() => Promise.reject(new Error('offline')));
    rejecting.reporter.addAudio({ provider: 'google', translated: false }, 1000);
    expect(() => rejecting.reporter.flush()).not.toThrow();
    await vi.advanceTimersByTimeAsync(10);
    await new Promise((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    rejecting.reporter.finish();
  });

  it('stops its timer and ignores events after finish', async () => {
    const { reporter, sent } = setup();
    reporter.finish();
    reporter.addAudio({ provider: 'google', translated: false }, 1000);
    expect(reporter.openStream({ provider: 'google', translated: false })).toBe(0);
    await vi.advanceTimersByTimeAsync(SPEECH_USAGE_FLUSH_MS * 2);
    expect(sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
