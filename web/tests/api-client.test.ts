import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamTranslate } from '@/lib/api-client';

describe('streamTranslate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses event and UTF-8 boundaries split across arbitrary network chunks', async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode('event: delta\ndata: {"delta":"Xin chào 日本語"}\n\nevent: done\ndata: {"fullText":"Xin chào 日本語","modelKey":"m"}\n\n');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }), { status: 200 })));
    const received: string[] = [];
    const completed: string[] = [];
    await streamTranslate({ requestId: 'r', recordingId: 'rec', captionId: 1, sessionEpoch: 1, revision: 1, configRevision: 1, modelKey: 'm', sourceLanguage: 'ja', targetLanguage: 'vi', text: 'x' },
      (delta) => received.push(delta), (full) => completed.push(full), (error) => received.push(`ERROR:${error}`));
    expect(received).toEqual(['Xin chào 日本語']);
    expect(completed).toEqual(['Xin chào 日本語']);
  });

  it('retains partial deltas and reports a stream error without signaling success', async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: delta\ndata: {"delta":"partial"}\n\nevent: error\ndata: {"message":"provider failed"}\n\n'));
        controller.close();
      },
    }), { status: 200 })));
    const deltas: string[] = [];
    const completed: string[] = [];
    const errors: string[] = [];
    await expect(streamTranslate({ requestId: 'r', recordingId: 'rec', captionId: 1, sessionEpoch: 1, revision: 1, configRevision: 1, modelKey: 'm', sourceLanguage: 'ja', targetLanguage: 'vi', text: 'x' },
      (delta) => deltas.push(delta), (full) => completed.push(full), (error) => errors.push(error))).rejects.toThrow('provider failed');
    expect(deltas).toEqual(['partial']);
    expect(errors).toEqual(['provider failed']);
    expect(completed).toEqual([]);
  });

  it('rejects an aborted stream that never delivered a done event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.close(); } }), { status: 200 })));
    const abortController = new AbortController();
    abortController.abort();
    const completed: string[] = [];
    const errors: string[] = [];
    await expect(streamTranslate({ requestId: 'r', recordingId: 'rec', captionId: 1, sessionEpoch: 1, revision: 1, configRevision: 1, modelKey: 'm', sourceLanguage: 'ja', targetLanguage: 'vi', text: 'x' },
      () => {}, (full) => completed.push(full), (error) => errors.push(error), abortController.signal)).rejects.toThrow('aborted');
    expect(completed).toEqual([]);
    expect(errors).toEqual(['Translation stream aborted.']);
  });

  it('does not publish success if an error frame follows done before the stream closes', async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ fullText: 'maybe done' })}\n\n`));
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: 'late failure' })}\n\n`));
        controller.close();
      },
    }), { status: 200 })));
    const completed: string[] = [];
    await expect(streamTranslate({ requestId: 'r', recordingId: 'rec', captionId: 1, sessionEpoch: 1, revision: 1, configRevision: 1, modelKey: 'm', sourceLanguage: 'ja', targetLanguage: 'vi', text: 'x' },
      () => {}, (full) => completed.push(full), () => {})).rejects.toThrow('late failure');
    expect(completed).toEqual([]);
  });
});
