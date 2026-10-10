import { canonicalLanguage } from '@/shared/languages';
import { GoogleGenAI } from '@google/genai';
import { getServerEnv } from '@/config/env.server';
import { googleProviderErrorResponse } from '@/server/ai/google-provider-error';
import { verifyAuthGuard, makeErrorResponse } from '@/server/http/guard';
import { LIVE_TRANSCRIPTION_MODEL } from '@/shared/transcription';
import { liveSpeechConfig } from '@/shared/live-speech-config';

export const dynamic = 'force-dynamic';

const SESSION_LIMIT_MS = 10 * 60 * 1000;

export async function POST(req: Request): Promise<Response> {
  const guard = await verifyAuthGuard(req);
  if (guard) return guard;

  let body: unknown;
  try {
    if (!req.body) throw new Error('missing body');
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > 2048) {
        await reader.cancel();
        return makeErrorResponse(413, 'INPUT_TOO_LARGE', 'Request token vượt quá giới hạn 2 KB.');
      }
      chunks.push(value);
    }
    const bodyBytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bodyBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    body = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    return makeErrorResponse(400, 'INTERNAL_ERROR', 'Request body không phải JSON hợp lệ.');
  }

  const languageCode =
    typeof body === 'object' && body !== null && 'languageCode' in body
      ? (body as { languageCode?: unknown }).languageCode
      : undefined;
  if (
    languageCode !== undefined &&
    (typeof languageCode !== 'string' || !canonicalLanguage(languageCode))
  ) {
    return makeErrorResponse(400, 'INTERNAL_ERROR', 'Mã ngôn ngữ không hợp lệ.');
  }

  const targetLanguageCode =
    typeof body === 'object' && body !== null && 'targetLanguageCode' in body
      ? (body as { targetLanguageCode?: unknown }).targetLanguageCode
      : undefined;
  if (
    targetLanguageCode !== undefined &&
    targetLanguageCode !== 'none' &&
    (typeof targetLanguageCode !== 'string' || !canonicalLanguage(targetLanguageCode))
  ) {
    return makeErrorResponse(400, 'INTERNAL_ERROR', 'Mã ngôn ngữ đích không hợp lệ.');
  }

  const transcriptionMode = typeof body === 'object' && body !== null && 'transcriptionMode' in body ? body.transcriptionMode : 'verbatim';
  if (transcriptionMode !== 'verbatim' && transcriptionMode !== 'smart') return makeErrorResponse(400, 'INTERNAL_ERROR', 'Chế độ phiên âm không hợp lệ.');

  // The token is bound to the model the browser will connect to, so a stale client that still asks for a
  // retired model (e.g. Flash Live) must fail clearly instead of getting a token for a different model.
  const model = typeof body === 'object' && body !== null && 'model' in body ? body.model : LIVE_TRANSCRIPTION_MODEL;
  if (model !== LIVE_TRANSCRIPTION_MODEL) return makeErrorResponse(400, 'UNSUPPORTED_MODEL', 'Model nhận giọng Live không còn được hỗ trợ. Hãy tải lại trang để dùng phiên bản mới.');

  const apiKey = getServerEnv().GOOGLE_API_KEY;
  if (!apiKey) {
    return makeErrorResponse(503, 'MISSING_CONFIG', 'Chưa cấu hình GOOGLE_API_KEY cho nhận giọng Gemini.');
  }

  try {
    const now = Date.now();
    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(),
        expireTime: new Date(now + SESSION_LIMIT_MS).toISOString(),
        liveConnectConstraints: {
          model,
          config: liveSpeechConfig(
            transcriptionMode,
            languageCode as string | undefined,
            targetLanguageCode as string | undefined
          ),
        },
      },
    });
    if (!token.name) throw new Error('Gemini returned an empty ephemeral token.');

    return Response.json(
      {
        token: token.name,
        model,
        websocketUrl: 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained',
        expiresAt: new Date(now + SESSION_LIMIT_MS).toISOString(),
        sessionLimitMs: SESSION_LIMIT_MS,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: unknown) {
    return googleProviderErrorResponse('speech.token', error);
  }
}
