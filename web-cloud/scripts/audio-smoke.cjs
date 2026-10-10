/* Real MediaRecorder + real worker/remux/decoder/player; no microphone or AI cost. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('node:http');
const { buildSync } = require('esbuild');
let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE_PATH, 'playwright', path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean)) {
  try { playwright = require(candidate); break; } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
}
if (!playwright) throw new Error('Playwright is required for real audio verification.');
function bundle(file, globalName) { return buildSync({ entryPoints: [file], bundle: true, write: false, platform: 'browser', format: 'iife', globalName }).outputFiles[0].text; }
async function run() {
  const browser = await playwright.chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' }), args: ['--autoplay-policy=no-user-gesture-required'] });
  const server = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Local audio verification</title>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const page = await browser.newPage();
    // WebCodecs decoders/encoders in workers require a secure context.
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.addScriptTag({ content: bundle('src/features/recording/audio-recorder.ts', 'Recorder') });
    const workerCode = bundle('src/features/recording/audio-normalizer.worker.ts');
    const result = await page.evaluate(async workerCode => {
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const ctx = new AudioContext({ sampleRate: 48000 }); await ctx.resume();
      const osc = ctx.createOscillator(), destination = ctx.createMediaStreamDestination();
      osc.connect(destination); osc.start();
      const workerUrl = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
      const normalize = parts => new Promise((resolve, reject) => {
        const worker = new Worker(workerUrl);
        worker.onmessage = event => { worker.terminate(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result); };
        worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
        worker.postMessage(parts);
      });
      const encodedPart = async (ms, frequency, mimeType = 'audio/webm;codecs=opus', stream = destination.stream) => {
        osc.frequency.value = frequency;
        const chunks = [], recorder = new MediaRecorder(stream, { mimeType });
        recorder.ondataavailable = event => chunks.push(event.data);
        recorder.start(150); await sleep(ms); await new Promise(resolve => { recorder.onstop = resolve; recorder.stop(); });
        return new Blob(chunks, { type: recorder.mimeType });
      };
      const endedTime = async blob => {
        const url = URL.createObjectURL(blob), audio = new Audio(url);
        const result = await new Promise((resolve, reject) => {
          audio.onerror = () => reject(new Error('HTML audio failed'));
          audio.onended = () => resolve({ duration: audio.duration, endedAt: audio.currentTime });
          void audio.play().catch(reject);
        }); URL.revokeObjectURL(url); return result;
      };
      const checkSeeking = async blob => {
        const url = URL.createObjectURL(blob), audio = new Audio(url); const results = [];
        await new Promise((resolve, reject) => { audio.onloadedmetadata = resolve; audio.onerror = reject; });
        for (const position of [0, audio.duration / 2, audio.duration - .25]) {
          audio.currentTime = position; await audio.play(); await sleep(160); audio.pause();
          results.push({ position, actual: audio.currentTime });
        }
        const duration = audio.duration; URL.revokeObjectURL(url); return { duration, results };
      };
      const legacyParts = [];
      for (const frequency of [300, 600, 900]) legacyParts.push(await encodedPart(900, frequency));
      const decoded = await Promise.all(legacyParts.map(async blob => ctx.decodeAudioData(await blob.arrayBuffer())));
      const expected = decoded.reduce((sum, audio) => sum + audio.duration, 0);
      const raw = await endedTime(new Blob(legacyParts, { type: 'audio/webm' }));
      const normalized = await normalize(legacyParts.map((blob, index) => ({ blob, segmentIndex: index + 1 })));
      const normalizedDecoded = await ctx.decodeAudioData(await normalized.blob.arrayBuffer());
      const normalizedPlayed = await endedTime(normalized.blob);
      const seeking = await checkSeeking(normalized.blob);
      const samples = normalizedDecoded.getChannelData(0), frequencies = [];
      let offset = 0;
      for (let index = 0; index < decoded.length; index++) {
        const start = Math.floor((offset + .2) * normalizedDecoded.sampleRate), length = Math.floor(.25 * normalizedDecoded.sampleRate);
        let crossings = 0;
        for (let i = start + 1; i < start + length; i++) if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
        frequencies.push(crossings / .25); offset += decoded[index].duration;
      }
      // Actual recorder uses one stream for API-active / API-paused / resumed
      // phases. Delayed writes verify stop() doesn't lose its final chunk.
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => destination.stream } });
      const continuousChunks = [];
      const recorder = new Recorder.WebAudioRecorder({
        onChunk: async (blob, sequence) => { await sleep(sequence % 2 ? 40 : 5); continuousChunks.push({ blob, sequence }); },
        onVolume() {}, onError(error) { throw new Error(error); },
      });
      osc.frequency.value = 440;
      await recorder.start(150);
      await sleep(600); // Active API.
      await sleep(600); // Paused API: recorder remains running.
      await sleep(600); // Resumed API.
      await recorder.stop(); continuousChunks.sort((a, b) => a.sequence - b.sequence);
      const continuous = await normalize([{ segmentIndex: 1, blob: new Blob(continuousChunks.map(chunk => chunk.blob), { type: 'audio/webm' }) }]);
      const continuousPlayed = await endedTime(continuous.blob);
      let aac = { supported: false };
      if (MediaRecorder.isTypeSupported('audio/mp4')) {
        // WebAudioRecorder.stop() correctly releases its old microphone track.
        const aacDestination = ctx.createMediaStreamDestination(); osc.connect(aacDestination);
        const parts = [await encodedPart(700, 300, 'audio/mp4', aacDestination.stream), await encodedPart(700, 600, 'audio/mp4', aacDestination.stream)];
        const decodedParts = await Promise.all(parts.map(async blob => ctx.decodeAudioData(await blob.arrayBuffer())));
        const expectedAac = decodedParts.reduce((sum, audio) => sum + audio.duration, 0);
        const result = await normalize(parts.map((blob, index) => ({ blob, segmentIndex: index + 1 })));
        const played = await endedTime(result.blob);
        aac = { supported: true, expected: expectedAac, duration: result.durationMs / 1000, played };
      }
      await ctx.close(); URL.revokeObjectURL(workerUrl);
      return { expected, raw: { ...raw, duration: Number.isFinite(raw.duration) ? raw.duration : 'Infinity' }, normalizedDuration: normalized.durationMs / 1000,
        decodedDuration: normalizedDecoded.duration, normalizedPlayed, seeking, frequencies, continuousDuration: continuous.durationMs / 1000, continuousPlayed,
        sequences: continuousChunks.map(chunk => chunk.sequence), aac };
    }, workerCode);
    assert(Math.abs(result.raw.endedAt - result.expected) > .5, 'Legacy concatenation must reproduce the early-end defect');
    assert(Math.abs(result.normalizedDuration - result.expected) < .015, 'Remux must retain all coded samples including missing final packet durations');
    assert(Math.abs(result.decodedDuration - result.expected) < .12, 'Decoded audio must retain the complete legacy recording');
    assert(Math.abs(result.normalizedPlayed.endedAt - result.expected) < .15, 'HTML playback must reach the actual end');
    assert(Number.isFinite(result.seeking.duration), 'Duration metadata must be finite');
    for (const seek of result.seeking.results) assert(seek.actual >= seek.position + .08, 'Seek must continue playing from the chosen position');
    result.frequencies.forEach((frequency, index) => assert(Math.abs(frequency - [300, 600, 900][index]) < 20, 'Content must remain in the original order without repeated/missing segments'));
    assert(result.continuousDuration > 1.6, 'The API pause interval must remain in full-session audio');
    assert(Math.abs(result.continuousPlayed.endedAt - result.continuousDuration) < .15);
    assert.deepEqual(result.sequences, result.sequences.map((_, index) => index), 'All final chunk writes must drain');
    if (result.aac.supported) {
      assert(Math.abs(result.aac.duration - result.aac.expected) < .15, 'Independent AAC priming must not be replayed at joins');
      assert(Math.abs(result.aac.played.endedAt - result.aac.expected) < .15, 'AAC playback reaches the complete file end');
    }
    fs.mkdirSync('test-results/audio', { recursive: true }); fs.writeFileSync('test-results/audio/report.json', JSON.stringify(result, null, 2));
    console.log('PASS real encoded audio: legacy red→green, packet preservation, duration, content order, beginning/middle/end seek, continuous capture and delayed final writes');
    console.log(JSON.stringify(result));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
