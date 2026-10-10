import { describe, expect, it } from 'vitest';
import { createNemotronTicket, verifyNemotronTicket } from '../scripts/lib/nemotron-ticket.mjs';

describe('Nemotron gateway tickets', () => {
  const secret = 'a-server-only-secret-with-at-least-32-characters';
  const origin = 'https://app.example.com';
  const ticket = () => createNemotronTicket(secret, { origin, language: 'vi-VN', endpointingMs: 900 }, 1000).token;

  it('binds signed locale and endpointing settings to an origin for a ten-minute session', () => {
    expect(verifyNemotronTicket(secret, ticket(), origin, 2000)).toMatchObject({
      language: 'vi-VN', endpointingMs: 900, expiresAt: 61_000, sessionExpiresAt: 601_000,
    });
  });
  it('rejects changed payloads, signatures, origins, keys and expired tickets', () => {
    const token = ticket();
    const [payload, signature] = token.split('.');
    const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), language: 'ja-JP' })).toString('base64url');
    expect(() => verifyNemotronTicket(secret, `${changed}.${signature}`, origin, 2000)).toThrow();
    expect(() => verifyNemotronTicket(secret, `${payload}.invalid`, origin, 2000)).toThrow();
    expect(() => verifyNemotronTicket(secret, token, 'https://other.example.com', 2000)).toThrow();
    expect(() => verifyNemotronTicket('another-server-secret-with-32-characters', token, origin, 2000)).toThrow();
    expect(() => verifyNemotronTicket(secret, token, origin, 61_000)).toThrow();
  });
});
