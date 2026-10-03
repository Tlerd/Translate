import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createNemotronGateway } from '../scripts/nemotron-gateway.mjs';
import { createNemotronTicket } from '../scripts/lib/nemotron-ticket.mjs';

const secret = 'gateway-server-secret-with-at-least-32-characters';
const origin = 'http://localhost:3000';
const cleanups = [];
async function fixture() {
  const received = [];
  const backend = createServer();
  const peers = new WebSocketServer({ server: backend });
  let authorization;
  peers.on('connection', (peer, request) => {
    authorization = request.headers.authorization;
    peer.send(JSON.stringify({ type: 'session.created' }));
    peer.on('message', (data, binary) => {
      if (binary) { received.push(Buffer.from(data)); return; }
      const event = JSON.parse(data.toString());
      received.push(event);
      if (event.type === 'session.update') peer.send(JSON.stringify({ type: 'session.updated' }));
      if (event.type === 'input_audio_buffer.commit') {
        peer.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Xin chào.' }));
        peer.send(JSON.stringify({ type: 'input_audio_buffer.committed' }));
      }
    });
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  const gateway = createNemotronGateway({ secret, backendUrl: `http://127.0.0.1:${backend.address().port}`, apiKey: 'persistent-key' });
  gateway.server.listen(0, '127.0.0.1'); await once(gateway.server, 'listening');
  const base = `ws://127.0.0.1:${gateway.server.address().port}/speech`;
  cleanups.push(async () => {
    gateway.close();
    for (const peer of peers.clients) peer.terminate();
    await new Promise(resolve => peers.close(resolve));
    await new Promise(resolve => backend.close(resolve));
  });
  const ticket = () => createNemotronTicket(secret, { origin, language: 'vi-VN', endpointingMs: 1200 }).token;
  const connect = (token = ticket(), clientOrigin = origin) => new WebSocket(`${base}?ticket=${token}`, { origin: clientOrigin });
  return { received, connect, ticket, authorization: () => authorization };
}
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

describe('Nemotron WebSocket gateway', () => {
  it('sets signed configuration and private credentials, forwards PCM, and preserves final-before-commit order', async () => {
    const { received, connect, authorization } = await fixture();
    const client = connect();
    const messages = [];
    client.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await once(client, 'open');
    await new Promise(resolve => {
      const listener = raw => { if (JSON.parse(raw.toString()).type === 'session.updated') { client.off('message', listener); resolve(); } };
      client.on('message', listener);
    });
    expect(authorization()).toBe('Bearer persistent-key');
    expect(received[0]).toMatchObject({ type: 'session.update', session: { language: 'vi-VN', endpointing_ms: 1200, sample_rate: 16000, verbatim: true, speaker_diarization: false } });
    client.send(Buffer.from([0, 1, 2, 3]));
    client.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    await new Promise(resolve => {
      const listener = raw => { if (JSON.parse(raw.toString()).type === 'input_audio_buffer.committed') { client.off('message', listener); resolve(); } };
      client.on('message', listener);
    });
    expect(received[1]).toEqual(Buffer.from([0, 1, 2, 3]));
    expect(messages.slice(-2).map(message => message.type)).toEqual(['conversation.item.input_audio_transcription.completed', 'input_audio_buffer.committed']);
    expect(JSON.stringify(messages)).not.toContain('persistent-key');
    client.close(); await once(client, 'close');
  });

  it('rejects replayed tickets and tickets used from another origin', async () => {
    const { connect, ticket } = await fixture();
    const token = ticket();
    const client = connect(token);
    client.on('error', () => {});
    await once(client, 'open');
    client.close(); await once(client, 'close');
    for (const [used, clientOrigin] of [[token, origin], [ticket(), 'http://other.example.com']]) {
      const rejected = connect(used, clientOrigin);
      const error = await new Promise(resolve => rejected.once('error', resolve));
      expect(error.message).toContain('401');
    }
  });
});
