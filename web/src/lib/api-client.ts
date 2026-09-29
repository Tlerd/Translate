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
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    onError('Không đọc được stream từ server.');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullTranslatedText = '';
  let modelKeyUsed = req.modelKey;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent = 'message';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim();
        } else if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim();
          try {
            const data = JSON.parse(dataStr);
            if (currentEvent === 'delta') {
              const delta = data.delta || '';
              fullTranslatedText += delta;
              onDelta(delta);
            } else if (currentEvent === 'done') {
              if (data.fullText) fullTranslatedText = data.fullText;
              if (data.modelKey) modelKeyUsed = data.modelKey;
              onDone(fullTranslatedText, modelKeyUsed);
            } else if (currentEvent === 'error') {
              onError(data.message || 'Lỗi xử lý stream dịch.');
            }
          } catch {
            // raw string delta fallback
            if (currentEvent === 'delta') {
              fullTranslatedText += dataStr;
              onDelta(dataStr);
            }
          }
        }
      }
    }
  } catch (err: unknown) {
    if (signal?.aborted) return;
    onError(err instanceof Error ? err.message : String(err));
  } finally {
    reader.releaseLock();
  }
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
