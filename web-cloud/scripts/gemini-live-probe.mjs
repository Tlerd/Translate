/*
 * Real Gemini Live probe: streams a 16 kHz mono PCM16 WAV in real time through
 * the app's token route and prints message timing. Costs a few seconds of API audio.
 * Usage: node scripts/gemini-live-probe.mjs <file.wav> [model] [targetLanguage]
 */
import fs from 'node:fs';
import WebSocket from 'ws';

const [wavPath, model = 'gemini-3.5-live-translate-preview', target = 'vi'] = process.argv.slice(2);
const baseUrl = process.env.BASE_URL || 'http://localhost:3100';
if (!wavPath) throw new Error('Usage: node scripts/gemini-live-probe.mjs <file.wav> [model] [target]');

const wav = fs.readFileSync(wavPath);
const dataOffset = wav.indexOf(Buffer.from('data')) + 8;
const pcm = wav.subarray(dataOffset);
const rate = wav.readUInt32LE(24);
if (rate !== 16000 || wav.readUInt16LE(22) !== 1) throw new Error(`Need 16 kHz mono WAV, got ${rate} Hz`);

const tokenResponse = await fetch(`${baseUrl}/api/speech/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ languageCode: 'ja-JP', transcriptionMode: 'verbatim', model, ...(target !== 'none' ? { targetLanguageCode: target } : {}) }),
});
const token = await tokenResponse.json();
if (!tokenResponse.ok) throw new Error(`Token failed ${tokenResponse.status}: ${JSON.stringify(token)}`);

// Mirrors src/shared/live-speech-config.ts (kept inline so the probe runs in plain Node).
const setup = model === 'gemini-3.5-live-translate-preview'
  ? { setup: { model: `models/${model}`, generationConfig: { responseModalities: ['AUDIO'], translationConfig: { targetLanguageCode: target.split('-')[0], echoTargetLanguage: true } }, inputAudioTranscription: {}, outputAudioTranscription: {} } }
  : { setup: { model: `models/${model}`, generationConfig: { responseModalities: ['TEXT'] }, inputAudioTranscription: { languageCodes: ['ja-JP'], mode: 'VERBATIM' } } };
const url = new URL(token.websocketUrl);
url.searchParams.set('access_token', token.token);
const socket = new WebSocket(url);
const t0 = Date.now();
const log = (...args) => console.log(String(Date.now() - t0).padStart(6), ...args);
let audioStart = 0;

socket.on('open', () => { log('open'); socket.send(JSON.stringify(setup)); });
socket.on('close', (code, reason) => { log('close', code, String(reason)); process.exit(0); });
socket.on('error', (error) => log('error', error.message));
socket.on('message', (raw) => {
  const message = JSON.parse(String(raw));
  if (message.setupComplete) { log('setupComplete'); void stream(); return; }
  const content = message.serverContent;
  if (!content) { log('other', JSON.stringify(message).slice(0, 300)); return; }
  const summary = {};
  for (const [key, value] of Object.entries(content)) {
    if (key === 'modelTurn') summary.modelTurn = (value.parts || []).map((part) => part.text ?? `audio:${part.inlineData?.data?.length ?? 0}`);
    else summary[key] = value;
  }
  if (summary.modelTurn && Object.keys(summary).length === 1) return; // audio-only chunks are noise here
  log(`+${audioStart ? Date.now() - audioStart : 0}ms audio`, JSON.stringify(summary));
});

async function stream() {
  audioStart = Date.now();
  const chunkBytes = 3200; // 100 ms
  // PROBE_END_AT=<seconds>: send audioStreamEnd mid-stream, like the app's silence boundary.
  const endAt = Number(process.env.PROBE_END_AT || 0) * 32000;
  for (let offset = 0; offset < pcm.length; offset += chunkBytes) {
    if (endAt && offset === Math.floor(endAt / chunkBytes) * chunkBytes) { socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); log('mid audioStreamEnd'); }
    socket.send(JSON.stringify({ realtimeInput: { audio: { data: pcm.subarray(offset, offset + chunkBytes).toString('base64'), mimeType: 'audio/pcm;rate=16000' } } }));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  log('audio done', `${(pcm.length / 32000).toFixed(1)}s`);
  const silence = Buffer.alloc(chunkBytes);
  for (let i = 0; i < 30; i++) {
    socket.send(JSON.stringify({ realtimeInput: { audio: { data: silence.toString('base64'), mimeType: 'audio/pcm;rate=16000' } } }));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
  log('audioStreamEnd');
  setTimeout(() => socket.close(1000), 5000);
}
