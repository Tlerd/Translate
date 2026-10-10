import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/** @typedef {{version: 1, nonce: string, origin: string, language: string, endpointingMs: number, expiresAt: number, sessionExpiresAt: number}} NemotronTicket */

/** @param {string} secret @param {string} payload */
function signature(secret, payload) {
  if (secret.length < 32) throw new Error('Nemotron gateway secret must contain at least 32 characters.');
  return createHmac('sha256', secret).update(payload).digest();
}

/** @param {string} secret @param {{origin: string, language: string, endpointingMs: number}} options @param {number} [now] */
export function createNemotronTicket(secret, options, now = Date.now()) {
  /** @type {NemotronTicket} */
  const claims = { version: 1, nonce: randomUUID(), ...options, expiresAt: now + 60_000, sessionExpiresAt: now + 600_000 };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return { token: `${payload}.${signature(secret, payload).toString('base64url')}`, expiresAt: claims.sessionExpiresAt };
}

/** @param {string} secret @param {string} token @param {string} origin @param {number} [now] @returns {NemotronTicket} */
export function verifyNemotronTicket(secret, token, origin, now = Date.now()) {
  if (token.length > 2048) throw new Error('Invalid Nemotron ticket.');
  const parts = token.split('.');
  if (parts.length !== 2) throw new Error('Invalid Nemotron ticket.');
  const expected = signature(secret, parts[0]);
  const received = Buffer.from(parts[1], 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error('Invalid Nemotron ticket.');
  const claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  if (claims.version !== 1 || typeof claims.nonce !== 'string' || claims.origin !== origin ||
      typeof claims.language !== 'string' || !/^[a-z]{2,3}-[A-Z]{2}$/.test(claims.language) ||
      !Number.isSafeInteger(claims.endpointingMs) || claims.endpointingMs < 600 || claims.endpointingMs > 10_000 ||
      !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= now || claims.expiresAt > now + 60_000 ||
      !Number.isSafeInteger(claims.sessionExpiresAt) || claims.sessionExpiresAt <= now || claims.sessionExpiresAt > now + 600_000) {
    throw new Error('Expired or invalid Nemotron ticket.');
  }
  return claims;
}
