import { AudioTranscriptionConfigMode, GoogleGenAI, Modality } from '@google/genai';
import { getServerEnv } from '@/config/env.server';
import { googleProviderErrorResponse } from '@/server/ai/google-provider-error';
import { verifyAuthGuard, makeErrorResponse } from '@/server/http/guard';

export const dynamic = 'force-dynamic';

const MODEL = 'gemini-3.5-transcribe-live';
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
    (typeof languageCode !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(languageCode))
  ) {
    return makeErrorResponse(400, 'INTERNAL_ERROR', 'Mã ngôn ngữ không hợp lệ.');
  }

  const transcriptionMode = typeof body === 'object' && body !== null && 'transcriptionMode' in body ? body.transcriptionMode : 'verbatim';
  if (transcriptionMode !== 'verbatim' && transcriptionMode !== 'smart') return makeErrorResponse(400, 'INTERNAL_ERROR', 'Chế độ phiên âm không hợp lệ.');

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
          model: MODEL,
          config: {
            responseModalities: [Modality.TEXT],
            inputAudioTranscription: {
              languageCodes: languageCode ? [languageCode] : [],
              mode: transcriptionMode === 'smart' ? AudioTranscriptionConfigMode.SMART : AudioTranscriptionConfigMode.VERBATIM,
            },
          },
        },
      },
    });
    if (!token.name) throw new Error('Gemini returned an empty ephemeral token.');

    return Response.json(
      {
        token: token.name,
        model: MODEL,
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
