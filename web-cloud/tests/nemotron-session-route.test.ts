import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/speech/nemotron/session/route';
import { verifyNemotronTicket } from '../scripts/lib/nemotron-ticket.mjs';

const secret = 'a-server-only-secret-with-at-least-32-characters';
const request = (body: unknown, url = 'http://localhost:3000/api/speech/nemotron/session') => new Request(url, { method: 'POST', body: JSON.stringify(body) });

describe('POST /api/speech/nemotron/session', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('AUTH_SECRET', ''); vi.stubEnv('OWNER_EMAIL', '');
    vi.stubEnv('NEMOTRON_BASE_URL', 'http://127.0.0.1:8080');
    vi.stubEnv('NEMOTRON_WEBSOCKET_URL', 'ws://127.0.0.1:8081/speech');
    vi.stubEnv('NEMOTRON_GATEWAY_SECRET', secret); vi.stubEnv('NEMOTRON_API_KEY', 'persistent-backend-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ready: true, capabilities: ['asr'] })));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('issues an origin-bound ticket and keeps both persistent keys on the server', async () => {
    const response = await POST(request({ languageCode: 'vi', pauseMs: 1200 }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toMatchObject({ model: 'nvidia/nemotron-3.5-asr-streaming-0.6b', websocketUrl: 'ws://127.0.0.1:8081/speech', sessionLimitMs: 600_000 });
    expect(verifyNemotronTicket(secret, body.token, 'http://localhost:3000')).toMatchObject({ language: 'vi-VN', endpointingMs: 1200 });
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(JSON.stringify(body)).not.toContain('persistent-backend-key');
    expect(fetch).toHaveBeenCalledWith(new URL('http://127.0.0.1:8080/ready'), expect.objectContaining({ headers: { Authorization: 'Bearer persistent-backend-key' } }));
  });
  it.each(['th-TH', 'el-GR', 'ja-JP\n&key=leak'])('rejects unsupported locale %s before contacting the backend', async languageCode => {
    expect((await POST(request({ languageCode }))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects oversized bodies and invalid endpointing intervals', async () => {
    expect((await POST(request({ extra: 'x'.repeat(2100) }))).status).toBe(413);
    expect((await POST(request({ languageCode: 'ja-JP', pauseMs: 100.5 }))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reports unready or unavailable backends without leaking internal details', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('internal-host:8080 persistent-backend-key'));
    const response = await POST(request({ languageCode: 'ja-JP' }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('persistent-backend-key');
  });
  it('rejects a ready server that has no ASR model loaded', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ ready: true, capabilities: ['tts'] }));
    expect((await POST(request({ languageCode: 'ja-JP' }))).status).toBe(503);
  });
  it('requires WSS for HTTPS pages before contacting the backend', async () => {
    expect((await POST(request({ languageCode: 'ja-JP' }, 'https://app.example.com/api/speech/nemotron/session'))).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps production closed when owner authentication is unconfigured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await POST(request({ languageCode: 'ja-JP' }))).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
});
