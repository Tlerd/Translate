import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAllowedOrigin, publicOrigin } from '@/server/http/public-origin';

const cloudHost = 'translate-web-1.asia-southeast1.run.app';
const cloudRun = (headers: HeadersInit = { Host: cloudHost, 'X-Forwarded-Proto': 'https' }) => new Request('http://0.0.0.0:8080/api/speech/soniox/session', { method: 'POST', headers });

describe('public origin', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('derives the browser-facing origin from Cloud Run forwarded headers', () => {
    const req = cloudRun();
    expect(publicOrigin(req)).toBe(`https://${cloudHost}`);
    expect(isAllowedOrigin(req, `https://${cloudHost}`)).toBe(true);
  });
  it('uses the first forwarded value and prefers x-forwarded-host', () => {
    const req = cloudRun({ 'X-Forwarded-Proto': 'https, http', 'X-Forwarded-Host': 'App.Example.com, internal', Host: 'internal:8080' });
    expect(publicOrigin(req)).toBe('https://app.example.com');
  });
  it('ignores unsupported forwarded protocols and malformed hosts', () => {
    expect(publicOrigin(cloudRun({ Host: cloudHost, 'X-Forwarded-Proto': 'javascript' }))).toBe(`http://${cloudHost}`);
    expect(publicOrigin(cloudRun({ 'X-Forwarded-Host': 'bad host/with path' }))).toBe('http://0.0.0.0:8080');
  });
  it('rejects foreign origins', () => {
    expect(isAllowedOrigin(cloudRun(), 'https://evil.example')).toBe(false);
    expect(isAllowedOrigin(cloudRun(), `http://${cloudHost}`)).toBe(false);
  });
  it('allows the configured AUTH_URL origin', () => {
    vi.stubEnv('AUTH_URL', 'https://translate.example.com/some/path');
    expect(isAllowedOrigin(cloudRun(), 'https://translate.example.com')).toBe(true);
    expect(isAllowedOrigin(cloudRun(), 'https://evil.example')).toBe(false);
  });
  it('allows the configured NEXTAUTH_URL origin when AUTH_URL is unset', () => {
    vi.stubEnv('AUTH_URL', ''); vi.stubEnv('NEXTAUTH_URL', 'https://legacy.example.com');
    expect(isAllowedOrigin(cloudRun(), 'https://legacy.example.com')).toBe(true);
  });
  it('works for plain local requests without forwarded headers', () => {
    const req = new Request('http://localhost:3000/api/x', { method: 'POST' });
    expect(publicOrigin(req)).toBe('http://localhost:3000');
    expect(isAllowedOrigin(req, 'http://localhost:3000')).toBe(true);
    expect(isAllowedOrigin(req, 'http://localhost:3001')).toBe(false);
  });
  it('still accepts the internal request origin', () => {
    expect(isAllowedOrigin(cloudRun(), 'http://0.0.0.0:8080')).toBe(true);
  });
  it('rejects malformed origins', () => {
    for (const bad of ['', 'not a url', 'null', '://x']) expect(isAllowedOrigin(cloudRun(), bad)).toBe(false);
  });
});
