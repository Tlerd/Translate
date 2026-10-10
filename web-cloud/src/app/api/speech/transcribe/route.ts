import { canonicalLanguage } from '@/shared/languages';
import { GoogleGenAI } from '@google/genai';
import { getServerEnv } from '@/config/env.server';
import { googleProviderErrorResponse } from '@/server/ai/google-provider-error';
import { verifyAuthGuard, makeErrorResponse } from '@/server/http/guard';
import { diarizedTranscriptTurns, extractDiarizedWordSegments } from '@/server/ai/gemini-diarize';
import { isSpeakerCount, TRANSCRIPTION_MODEL } from '@/shared/transcription';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 64 * 1024;
const MAX_DURATION_MS = 20 * 1000;
const REQUEST_TIMEOUT_MS = 45 * 1000;

const SUPPORTED_AUDIO_TYPES = new Set([
  'audio/aac', 'audio/aiff', 'audio/flac', 'audio/m4a', 'audio/mpeg',
  'audio/mp3', 'audio/ogg', 'audio/opus', 'audio/wav', 'audio/webm',
]);

function audioMimeType(file: File): string | null {
  const declared = file.type.trim().toLowerCase();
  const extensionType: Record<string, string> = {
    aac: 'audio/aac', aif: 'audio/aiff', aiff: 'audio/aiff', flac: 'audio/flac',
    m4a: 'audio/m4a', mp3: 'audio/mpeg', mp4: 'audio/mp4', ogg: 'audio/ogg',
    opus: 'audio/opus', wav: 'audio/wav', webm: 'audio/webm',
  };
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const normalized = declared || extensionType[extension] || '';
  if (!SUPPORTED_AUDIO_TYPES.has(normalized) && normalized !== 'audio/mp4') return null;
  return normalized === 'audio/mp4' ? 'audio/m4a' : normalized;
}

async function readBoundedBody(req: Request): Promise<Uint8Array | null> {
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_MULTIPART_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseDurationMs(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || !/^\d{1,8}$/.test(value)) return null;
  const durationMs = Number(value);
  return Number.isSafeInteger(durationMs) && durationMs > 0 && durationMs <= MAX_DURATION_MS
    ? durationMs
    : null;
}

export async function POST(req: Request): Promise<Response> {
  const guard = await verifyAuthGuard(req);
  if (guard) return guard;

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    return makeErrorResponse(415, 'INTERNAL_ERROR', 'Yêu cầu phải chứa multipart audio.');
  }

  const boundedBody = await readBoundedBody(req);
  if (!boundedBody) {
    return makeErrorResponse(413, 'INTERNAL_ERROR', 'Tệp audio vượt quá giới hạn 4 MB.');
  }

  let form: FormData;
  try {
    const bodyBuffer = new ArrayBuffer(boundedBody.byteLength);
    new Uint8Array(bodyBuffer).set(boundedBody);
    const formRequest = new Request('http://local/speech/transcribe', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: bodyBuffer,
    });
    form = await formRequest.formData();
  } catch {
    return makeErrorResponse(400, 'INTERNAL_ERROR', 'Multipart audio không hợp lệ.');
  }

  const uploaded = form.get('audio');
  if (!(uploaded instanceof File) || uploaded.size === 0) {
    return makeErrorResponse(400, 'INTERNAL_ERROR', 'Thiếu tệp audio hợp lệ.');
  }
  if (uploaded.size > MAX_FILE_BYTES) {
    return makeErrorResponse(413, 'INTERNAL_ERROR', 'Tệp audio vượt quá giới hạn 4 MB.');
  }
  const durationMs = parseDurationMs(form.get('durationMs'));
  if (durationMs === null) {
    return makeErrorResponse(400, 'INTERNAL_ERROR', 'Thời lượng audio phải nằm trong khoảng 1 ms đến 20 giây.');
  }
  const mode = form.get('transcriptionMode') ?? 'verbatim';
  if (mode !== 'verbatim' && mode !== 'smart') {
    return makeErrorResponse(400, 'INTERNAL_ERROR', 'Chế độ phiên âm phải là verbatim hoặc smart.');
  }
  const model = form.get('model') ?? TRANSCRIPTION_MODEL;
  if (model !== TRANSCRIPTION_MODEL) {
    return makeErrorResponse(400, 'UNSUPPORTED_MODEL', 'Model nhận giọng theo đoạn không hợp lệ.');
  }
  const rawSpeakerCount = form.get('speakerCount');
  const speakerCount = typeof rawSpeakerCount === 'string' && /^[1-8]$/.test(rawSpeakerCount) ? Number(rawSpeakerCount) : null;
  if (!isSpeakerCount(speakerCount)) {
    return makeErrorResponse(400, 'INTERNAL_ERROR', 'Bắt buộc chọn số người nói từ 1 đến 8.');
  }
  const mimeType = audioMimeType(uploaded);
  if (!mimeType) {
    return makeErrorResponse(415, 'INTERNAL_ERROR', 'Định dạng audio chưa được hỗ trợ.');
  }

  const language = form.get('language');
  const languageCode = typeof language === 'string' && language ? canonicalLanguage(language) : undefined;
  if (language && !languageCode) return makeErrorResponse(400, 'INTERNAL_ERROR', 'Mã ngôn ngữ không hợp lệ.');
  const apiKey = getServerEnv().GOOGLE_API_KEY;
  if (!apiKey) {
    return makeErrorResponse(503, 'MISSING_CONFIG', 'Chưa cấu hình GOOGLE_API_KEY cho nhận giọng.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onRequestAbort = () => controller.abort();
  req.signal.addEventListener('abort', onRequestAbort, { once: true });
  const ai = new GoogleGenAI({ apiKey });
  let uploadedFileName: string | undefined;

  try {
    const fileBlob = new Blob([await uploaded.arrayBuffer()], { type: mimeType });
    const uploadedFile = await ai.files.upload({
      file: fileBlob,
      config: {
        mimeType,
        displayName: `speech-${Date.now()}.${mimeType === 'audio/m4a' ? 'm4a' : 'audio'}`,
        abortSignal: controller.signal,
      },
    });
    uploadedFileName = uploadedFile.name;
    if (!uploadedFile.uri) throw new Error('Provider did not return an uploaded file URI.');

    const interaction = await ai.interactions.create({
      model,
      input: [{ type: 'audio', uri: uploadedFile.uri, mime_type: mimeType }],
      generation_config: {
        transcription_config: {
          language_codes: languageCode && languageCode !== 'auto' ? [languageCode] : [],
          mode: mode === 'smart' ? 'smart' : {
            type: 'verbatim',
            diarization_mode: 'speaker',
            timestamp_granularities: ['word'],
          },
        },
      },
    }, { timeout_ms: REQUEST_TIMEOUT_MS, signal: controller.signal });

    if (controller.signal.aborted) {
      return makeErrorResponse(504, 'INTERNAL_ERROR', 'Phân tích audio đã hết thời gian chờ.');
    }
    const text = interaction.output_text;
    if (typeof text !== 'string') return makeErrorResponse(502, 'INTERNAL_ERROR', 'Gemini không trả về chữ hợp lệ.');
    const turns = mode === 'verbatim'
      ? diarizedTranscriptTurns(text, extractDiarizedWordSegments(interaction, durationMs), speakerCount)
      : [];
    return Response.json({ text, turns, model }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: unknown) {
    return googleProviderErrorResponse('speech.transcribe', error, controller.signal.aborted);
  } finally {
    clearTimeout(timeout);
    req.signal.removeEventListener('abort', onRequestAbort);
    if (uploadedFileName) {
      const cleanup = new AbortController();
      const cleanupTimeout = setTimeout(() => cleanup.abort(), 10_000);
      try {
        await ai.files.delete({ name: uploadedFileName, config: { abortSignal: cleanup.signal } });
      } catch {
        // Provider-side file cleanup is best effort; uploaded files also expire automatically.
      } finally {
        clearTimeout(cleanupTimeout);
      }
    }
  }
}
