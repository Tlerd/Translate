import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { verifyNemotronTicket } from './lib/nemotron-ticket.mjs';

/**
 * Browser sockets use one-use, origin-bound tickets issued by the authenticated
 * Next.js route. The persistent NeMo API key stays on this server.
 * @param {{secret: string, backendUrl: string, apiKey?: string, maxStreams?: number}} config
 */
export function createNemotronGateway(config) {
  if (config.secret.length < 32) throw new Error('Missing NEMOTRON_GATEWAY_SECRET (at least 32 characters).');
  const upstreamUrl = new URL('/v1/audio/transcriptions/realtime', config.backendUrl);
  if (!['http:', 'https:'].includes(upstreamUrl.protocol) || upstreamUrl.username || upstreamUrl.password) throw new Error('Invalid Nemotron backend.');
  upstreamUrl.protocol = upstreamUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const server = createServer((request, response) => {
    response.writeHead(request.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ ready: request.url === '/health', service: 'nemotron-gateway' }));
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024, perMessageDeflate: false });
  const usedTickets = new Map();
  server.on('upgrade', (request, socket, head) => {
    let claims;
    try {
      const url = new URL(request.url ?? '', 'http://gateway.local');
      if (url.pathname !== '/speech') throw new Error('Invalid route');
      claims = verifyNemotronTicket(config.secret, url.searchParams.get('ticket') ?? '', request.headers.origin ?? '');
      for (const [nonce, expiry] of usedTickets) if (expiry <= Date.now()) usedTickets.delete(nonce);
      if (usedTickets.has(claims.nonce) || sockets.clients.size >= (config.maxStreams ?? 4)) throw new Error('Session unavailable');
      usedTickets.set(claims.nonce, claims.expiresAt);
    } catch {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      const upstream = new WebSocket(upstreamUrl, {
        headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
        maxPayload: 1024 * 1024, handshakeTimeout: 12_000, perMessageDeflate: false,
      });
      let configured = false;
      const deadline = setTimeout(() => client.close(1000, 'Session expired'), Math.max(0, claims.sessionExpiresAt - Date.now()));
      const ping = setInterval(() => {
        if (upstream.readyState === WebSocket.OPEN) upstream.ping();
        if (client.readyState === WebSocket.OPEN) client.ping();
      }, 15_000);
      const cleanup = () => { clearTimeout(deadline); clearInterval(ping); };
      upstream.on('open', () => upstream.send(JSON.stringify({ type: 'session.update', session: {
        sample_rate: 16_000, language: claims.language, endpointing_ms: claims.endpointingMs,
        automatic_punctuation: true, verbatim: true, word_timestamps: true, speaker_diarization: false,
      } })));
      upstream.on('message', (data, binary) => {
        if (client.readyState !== WebSocket.OPEN) return;
        if (!binary) {
          try { if (JSON.parse(data.toString()).type === 'session.updated') configured = true; } catch { /* Forward provider data in order. */ }
        }
        if (client.bufferedAmount + data.length > 512 * 1024) { client.close(1013, 'Transcript receiver too slow'); return; }
        client.send(data, { binary });
      });
      client.on('message', (data, binary) => {
        if (!configured || upstream.readyState !== WebSocket.OPEN) { client.close(1008, 'Session not ready'); return; }
        if (upstream.bufferedAmount + data.length > 512 * 1024) { client.close(1013, 'Audio receiver too slow'); return; }
        if (binary) {
          if (data.length % 2) { client.close(1008, 'Invalid PCM16'); return; }
          upstream.send(data, { binary: true });
          return;
        }
        try {
          const event = JSON.parse(data.toString());
          if (!['input_audio_buffer.commit', 'input_audio_buffer.clear'].includes(event.type)) throw new Error('Unsupported event');
          upstream.send(JSON.stringify({ type: event.type }));
        } catch { client.close(1008, 'Invalid audio event'); }
      });
      upstream.on('error', () => client.close(1011, 'Nemotron backend unavailable'));
      upstream.on('close', () => { cleanup(); client.close(1000, 'Nemotron session ended'); });
      client.on('error', () => upstream.terminate());
      client.on('close', () => { cleanup(); upstream.terminate(); });
    });
  });
  return { server, sockets, close: () => { for (const client of sockets.clients) client.terminate(); sockets.close(); server.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile('.env.local'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const gateway = createNemotronGateway({ secret: process.env.NEMOTRON_GATEWAY_SECRET ?? '', backendUrl: process.env.NEMOTRON_BASE_URL ?? '', apiKey: process.env.NEMOTRON_API_KEY });
  gateway.server.listen(Number(process.env.NEMOTRON_GATEWAY_PORT ?? 8081), process.env.NEMOTRON_GATEWAY_HOST ?? '127.0.0.1', () => console.log('Nemotron gateway ready.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => gateway.close());
}
