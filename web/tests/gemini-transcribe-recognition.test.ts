import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiTranscribeRecognizer, pcmWav } from '@/features/recording/gemini-transcribe-recognition';
import type { SpeakerCount, TranscriptionMode } from '@/shared/transcription';

function setup(mode: TranscriptionMode = 'verbatim', speakerCount: SpeakerCount = 1) {
  const callbacks = { onTranscript: vi.fn(), onError: vi.fn(), onStateChange: vi.fn() };
  const recognizer = new GeminiTranscribeRecognizer(callbacks, 'ja-JP', 900, mode, speakerCount);
  recognizer.start(7);
  return { recognizer, callbacks };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('unary Gemini transcription', () => {
  it('does not create phantom captions from a silent microphone, including while Stop drains', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ text: 'ええ。', turns: [] }));
    vi.stubGlobal('fetch', fetcher);
    const callbacks = { onTranscript: vi.fn(), onError: vi.fn(), onStateChange: vi.fn() };
    const recognizer = new GeminiTranscribeRecognizer(callbacks, 'ja-JP', 900, 'verbatim', 1);
    recognizer.start(7);
    for (let second = 0; second < 5; second++) recognizer.pushPcm(new Float32Array(16000), 16000);
    await recognizer.stop();
    expect(fetcher).not.toHaveBeenCalled();
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
  });
  it('bounds Stop when a speech request stalls and ignores responses arriving after cancellation', async () => {
    vi.useFakeTimers();
    let release!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { release = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    const { recognizer, callbacks } = setup();
    recognizer.pushPcm(new Float32Array(16000).fill(0.2), 16000); recognizer.finalizeUtterance();
    recognizer.pushPcm(new Float32Array(16000).fill(0.2), 16000);
    let stopped = false;
    const stopping = recognizer.stop().then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(20_001);
    expect(stopped).toBe(true);
    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('Audio'), 7);
    expect(fetcher).toHaveBeenCalledTimes(1);
    release(Response.json({ text: 'late phantom words' }));
    await stopping;
    await vi.advanceTimersByTimeAsync(0);
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('preserves recording timestamps when silent segments are skipped', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ text: 'speech after silence' }));
    vi.stubGlobal('fetch', fetcher);
    const { recognizer, callbacks } = setup();
    for (let second = 0; second < 5; second++) recognizer.pushPcm(new Float32Array(16000), 16000);
    recognizer.finalizeUtterance();
    recognizer.pushPcm(new Float32Array(8000).fill(0.2), 16000);
    await recognizer.stop();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(callbacks.onTranscript.mock.calls[0][5].startMs).toBeCloseTo(5000, 0);
    expect(callbacks.onTranscript.mock.calls[0][5].endMs).toBe(5500);
  });
  it('uses capture timestamps across VAD gaps instead of compressing omitted silence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ text: 'words' })));
    const { recognizer, callbacks } = setup();
    recognizer.pushPcm(new Float32Array(16000).fill(.2), 16000, 2000);
    recognizer.finalizeUtterance();
    recognizer.pushPcm(new Float32Array(8000).fill(.2), 16000, 10000);
    await recognizer.stop();
    expect(callbacks.onTranscript.mock.calls[0][5].startMs).toBe(2000);
    expect(callbacks.onTranscript.mock.calls[1][5].startMs).toBe(10000);
    expect(callbacks.onTranscript.mock.calls[1][5].endMs).toBeCloseTo(10500, 0);
  });
  it('sends the Transcribe model with queued PCM segments and preserves final timing', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ text: 'Transcribe transcript', turns: [] }));
    vi.stubGlobal('fetch', fetcher);
    const callbacks = { onTranscript: vi.fn(), onError: vi.fn(), onStateChange: vi.fn() };
    const recognizer = new GeminiTranscribeRecognizer(callbacks, 'ja-JP', 900, 'verbatim', 2);
    recognizer.start(7);
    recognizer.pushPcm(new Float32Array(8000).fill(0.2), 16000);
    await recognizer.stop();
    expect((fetcher.mock.calls[0][1].body as FormData).get('model')).toBe('gemini-3.5-transcribe');
    expect(callbacks.onTranscript).toHaveBeenCalledWith('Transcribe transcript', true, 7, 'transcribe_7_1', 1, { startMs: 0, endMs: 500 });
  });
  it('drains the final audio on stop, with a valid independent WAV and original timestamps', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ text: 'こんにちは' }));
    vi.stubGlobal('fetch', fetcher);
    const { recognizer, callbacks } = setup();
    recognizer.pushPcm(new Float32Array(8000).fill(0.2), 16000);
    await recognizer.stop();
    expect(callbacks.onTranscript).toHaveBeenCalledWith('こんにちは', true, 7, 'transcribe_7_1', 1, { startMs: 0, endMs: 500 });
    const form = fetcher.mock.calls[0][1].body as FormData;
    const audio = form.get('audio') as File;
    expect(audio.type).toBe('audio/wav');
    expect(audio.size).toBe(16044);
    expect(form.get('durationMs')).toBe('500');
    expect(form.get('language')).toBe('ja-JP');
    expect(form.get('transcriptionMode')).toBe('verbatim');
    expect(form.get('speakerCount')).toBe('1');
  });

  it('emits native speaker turns with recording-relative timestamps across consecutive chunks', async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ text: 'One. Two.', turns: [
      { text: 'One.', speakerLabel: 'spk_1', startMs: 100, endMs: 300 },
      { text: 'Two.', speakerLabel: 'spk_2', startMs: 600, endMs: 800 },
    ] }));
    vi.stubGlobal('fetch', fetcher);
    const { recognizer, callbacks } = setup('verbatim', 2);
    recognizer.pushPcm(new Float32Array(16000).fill(0.2), 16000); recognizer.finalizeUtterance();
    recognizer.pushPcm(new Float32Array(16000).fill(0.2), 16000);
    await recognizer.stop();
    // The streaming resampler retains one boundary sample until the next chunk.
    expect(callbacks.onTranscript.mock.calls.map(call => [call[0], { ...call[5], startMs: Math.round(call[5].startMs), endMs: Math.round(call[5].endMs) }])).toEqual([
      ['One.', { startMs: 100, endMs: 300, speakerLabel: 'spk_1' }],
      ['Two.', { startMs: 600, endMs: 800, speakerLabel: 'spk_2' }],
      ['One.', { startMs: 1100, endMs: 1300, speakerLabel: 'spk_1' }],
      ['Two.', { startMs: 1600, endMs: 1800, speakerLabel: 'spk_2' }],
    ]);
    expect(new Set(callbacks.onTranscript.mock.calls.map(call => call[3])).size).toBe(4);
  });

  it('keeps smart text intact and unlabelled even if a response contains stray speaker annotations', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ text: 'Clean text.', turns: [{ text: 'Wrong replacement', speakerLabel: 'spk_1', startMs: 0, endMs: 100 }] }));
    vi.stubGlobal('fetch', fetcher);
    const { recognizer, callbacks } = setup('smart', 8);
    recognizer.pushPcm(new Float32Array(8000).fill(0.2), 16000);
    await recognizer.stop();
    expect(callbacks.onTranscript).toHaveBeenCalledWith('Clean text.', true, 7, 'transcribe_7_1', 1, { startMs: 0, endMs: 500 });
    const form = fetcher.mock.calls[0][1].body as FormData;
    expect(form.get('transcriptionMode')).toBe('smart');
    expect(form.get('speakerCount')).toBe('8');
  });

  it('finishes existing audio with its original mode and applies saved settings to the next segment', async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ text: 'words' }));
    vi.stubGlobal('fetch', fetcher);
    const { recognizer } = setup();
    recognizer.pushPcm(new Float32Array(8000).fill(0.2), 16000);
    recognizer.updateSettings({ transcriptionMode: 'smart', speakerCount: 4 });
    recognizer.pushPcm(new Float32Array(8000).fill(0.2), 16000);
    await recognizer.stop();
    expect(fetcher.mock.calls.map(call => [(call[1].body as FormData).get('transcriptionMode'), (call[1].body as FormData).get('speakerCount')])).toEqual([['verbatim', '1'], ['smart', '4']]);
  });

  it('keeps segments ordered even while earlier requests are pending, without replacing previous text', async () => {
    let release!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }))
      .mockResolvedValueOnce(Response.json({ text: 'second' }));
    vi.stubGlobal('fetch', fetcher);
    const { recognizer, callbacks } = setup();
    recognizer.pushPcm(new Float32Array(16000).fill(0.2), 16000); recognizer.finalizeUtterance();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    recognizer.pushPcm(new Float32Array(16000).fill(0.2), 16000);
    const stopped = recognizer.stop();
    expect(fetcher).toHaveBeenCalledTimes(1);
    release(Response.json({ text: 'first' })); await stopped;
    expect(callbacks.onTranscript.mock.calls.map(call => call[0])).toEqual(['first', 'second']);
    expect(callbacks.onTranscript.mock.calls.map(call => call[3])).toEqual(['transcribe_7_1', 'transcribe_7_2']);
  });

  it('cuts after the configured short pause and surfaces API failure instead of returning success text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { message: 'quota' } }, { status: 429 })));
    const { recognizer, callbacks } = setup();
    recognizer.pushPcm(new Float32Array(8000).fill(0.2), 16000);
    recognizer.pushPcm(new Float32Array(15000), 16000);
    await vi.waitFor(() => expect(callbacks.onError).toHaveBeenCalled());
    await recognizer.stop();
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
    expect(callbacks.onError.mock.calls[0][0]).toContain('quota');
  });

  it('encodes clipped little endian PCM16 at 16 kHz mono', async () => {
    const bytes = new DataView(await pcmWav(new Float32Array([-2, 0, 2])).arrayBuffer());
    expect(bytes.getUint32(24, true)).toBe(16000);
    expect(bytes.getUint16(22, true)).toBe(1);
    expect(bytes.getInt16(44, true)).toBe(-32768);
    expect(bytes.getInt16(48, true)).toBe(32767);
  });
});
