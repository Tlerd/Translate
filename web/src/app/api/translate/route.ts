import { after } from 'next/server';
import { TranslateRequestSchema } from '@/shared/ai-contracts';
import { executeTranslation } from '@/server/ai/translate';
import {
  usageStoreEnabled,
  insertTranslationUsage,
  type TranslationUsageRecord,
} from '@/server/cloud/translation-usage-store';
import { verifyAuthGuard, makeErrorResponse } from '@/server/http/guard';
import { checkRateLimit } from '@/server/http/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const guard = await verifyAuthGuard(req);
  if (guard) return guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return makeErrorResponse(400, 'INTERNAL_ERROR', 'Request body không phải JSON hợp lệ.');
  }

  const parsed = TranslateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return makeErrorResponse(
      400,
      'INTERNAL_ERROR',
      `Dữ liệu gửi lên không đúng định dạng: ${parsed.error.message}`
    );
  }

  const data = parsed.data;

  // Rate limit
  const rateLimitKey = `translate:${data.recordingId}`;
  const rateLimit = await checkRateLimit(rateLimitKey, 120, 60);
  if (!rateLimit.allowed) {
    return makeErrorResponse(
      429,
      'RATE_LIMIT_EXCEEDED',
      'Đã vượt quá giới hạn tần suất dịch live.',
      data.requestId,
      rateLimit.retryAfterMs
    );
  }

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  let stopped = false;
  let finished = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

  const cleanup = () => {
    req.signal.removeEventListener('abort', onRequestAbort);
  };

  const abortWork = () => {
    if (stopped || finished) return;
    stopped = true;
    abortController.abort();
    cleanup();
  };

  const onRequestAbort = () => {
    abortWork();
    try {
      streamController?.close();
    } catch {
      // The consumer may have canceled or the stream may already be closed.
    }
  };

  let resolveUsageRecord: ((record: TranslationUsageRecord | null) => void) | undefined;
  let finalUsage: TranslationUsageRecord | null = null;
  const usageRecordPromise = new Promise<TranslationUsageRecord | null>((resolve) => {
    resolveUsageRecord = resolve;
  });

  if (usageStoreEnabled()) {
    try {
      after(async () => {
        const rec = await usageRecordPromise;
        if (rec) {
          try {
            await insertTranslationUsage(rec);
          } catch (e: unknown) {
            console.warn(
              '[translation-usage] persist failed',
              e instanceof Error ? e.message : String(e)
            );
          }
        }
      });
    } catch (e: unknown) {
      console.warn(
        '[translation-usage] schedule after failed',
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  const onUsageRecord = (record: TranslationUsageRecord) => {
    finalUsage = record;
    if (resolveUsageRecord) {
      resolveUsageRecord(record);
      resolveUsageRecord = undefined;
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;
      req.signal.addEventListener('abort', onRequestAbort, { once: true });
      if (req.signal.aborted) {
        onRequestAbort();
        return;
      }

      let fullText = '';
      const enqueue = (message: string) => {
        if (stopped || abortController.signal.aborted) return false;
        try {
          controller.enqueue(encoder.encode(message));
          return true;
        } catch {
          // A cancellation can race with an enqueue after a provider yields.
          abortWork();
          return false;
        }
      };

      void (async () => {
        try {
          for await (const delta of executeTranslation(data, abortController.signal, onUsageRecord)) {
            if (stopped || abortController.signal.aborted) break;
            fullText += delta;
            const deltaMsg = `event: delta\ndata: ${JSON.stringify({ delta })}\n\n`;
            if (!enqueue(deltaMsg)) break;
          }

          if (!stopped) {
            const usage = finalUsage as TranslationUsageRecord | null;
            if (usage) enqueue(`event: usage\ndata: ${JSON.stringify({
              requestId: usage.requestId,
              historyTurns: usage.historyTurns,
              promptVersion: usage.promptVersion ?? 'legacy-unknown',
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              thinkingTokens: usage.thinkingTokens,
              cachedInputTokens: usage.cachedInputTokens,
              usageStatus: usage.usageStatus,
            })}\n\n`);
            const doneMsg = `event: done\ndata: ${JSON.stringify({ fullText, modelKey: data.modelKey })}\n\n`;
            enqueue(doneMsg);
          }
        } catch (err: unknown) {
          if (!stopped && !abortController.signal.aborted) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            const errEvent = `event: error\ndata: ${JSON.stringify({ message: errorMsg })}\n\n`;
            enqueue(errEvent);
          }
        } finally {
          finished = true;
          cleanup();
          if (resolveUsageRecord) {
            resolveUsageRecord(null);
            resolveUsageRecord = undefined;
          }
          if (!stopped) {
            try {
              controller.close();
            } catch {
              // The stream may have been canceled as the provider completed.
            }
          }
        }
      })();
    },
    cancel() {
      abortWork();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Request-Id': data.requestId,
    },
  });
}
