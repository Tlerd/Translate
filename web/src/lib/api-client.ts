/**
 * Client API caller for models, translation SSE stream, summarization, and image generation.
 */

import type {
  ModelsResponse,
  TranslateRequest,
  SummarizeRequest,
  SummarizeResponse,
  GenerateImageRequest,
  ApiErrorResponse,
} from '@/shared/ai-contracts';

export async function fetchModels(): Promise<ModelsResponse> {
  const res = await fetch('/api/models', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as ApiErrorResponse;
    throw new Error(errorBody.error?.message || `Lỗi tải danh sách model: HTTP ${res.status}`);
  }
  return res.json();
}

export async function streamTranslate(
  req: TranslateRequest,
  onDelta: (delta: string) => void,
  onDone: (fullText: string, modelKey: string) => void,
  onError: (error: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(req),
    signal,
    cache: 'no-store',
  });

  if (!res.ok) {
    const errJson = (await res.json().catch(() => ({}))) as ApiErrorResponse;
    const msg = errJson.error?.message || `Lỗi dịch: HTTP ${res.status}`;
    onError(msg);
    throw new Error(msg);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    onError('Không đọc được stream từ server.');
    throw new Error('Không đọc được stream từ server.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullTranslatedText = '';
  let modelKeyUsed = req.modelKey;
  let streamError: string | null = null;
  let receivedDone = false;

  const dispatchFrame = (frame: string) => {
    let currentEvent = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) currentEvent = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (!dataLines.length) return;
    const dataStr = dataLines.join('\n');
    let data: Record<string, unknown> | null = null;
    try { data = JSON.parse(dataStr) as Record<string, unknown>; } catch { /* raw delta fallback */ }
    if (currentEvent === 'delta') {
      const delta = typeof data?.delta === 'string' ? data.delta : dataStr;
      fullTranslatedText += delta;
      onDelta(delta);
    } else if (currentEvent === 'done') {
      if (streamError) return;
      if (typeof data?.fullText === 'string' && data.fullText) fullTranslatedText = data.fullText;
      if (typeof data?.modelKey === 'string' && data.modelKey) modelKeyUsed = data.modelKey;
      receivedDone = true;
    } else if (currentEvent === 'error') {
      streamError = typeof data?.message === 'string' ? data.message : 'Lỗi xử lý stream dịch.';
      onError(streamError);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let separator: RegExpExecArray | null;
      while ((separator = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const frame = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        dispatchFrame(frame);
      }
      if (streamError) {
        await reader.cancel(streamError).catch(() => {});
        break;
      }
      if (done) break;
    }
    // Some servers close immediately after the final data line without the
    // optional blank line; process that complete trailing frame as well.
    if (buffer.trim()) dispatchFrame(buffer);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (!streamError) onError(signal?.aborted ? 'Translation stream aborted.' : message);
    streamError ||= signal?.aborted ? 'Translation stream aborted.' : message;
  } finally {
    reader.releaseLock();
  }

  if (streamError) throw new Error(streamError);
  if (!receivedDone) {
    const message = signal?.aborted
      ? 'Translation stream aborted.'
      : 'Stream dịch kết thúc trước khi hoàn tất.';
    onError(message);
    throw new Error(message);
  }
  onDone(fullTranslatedText, modelKeyUsed);
}

export async function requestSummary(req: SummarizeRequest): Promise<SummarizeResponse> {
  const res = await fetch('/api/summarize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(req),
    cache: 'no-store',
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as ApiErrorResponse;
    throw new Error(errorBody.error?.message || `Lỗi tóm tắt: HTTP ${res.status}`);
  }

  return res.json();
}

export async function requestImage(req: GenerateImageRequest): Promise<{ blob: Blob; modelKey: string }> {
  const res = await fetch('/api/images', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(req),
    cache: 'no-store',
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as ApiErrorResponse;
    throw new Error(errorBody.error?.message || `Lỗi tạo ảnh: HTTP ${res.status}`);
  }

  const modelKey = res.headers.get('X-Model-Key') || req.modelKey;
  const blob = await res.blob();
  return { blob, modelKey };
}
