/* Real local NeMo ASR + gateway + Next.js; only microphone, translation and cloud use fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function playwright() {
  for (const module of [process.env.PLAYWRIGHT_MODULE_PATH, 'playwright', path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean)) {
    try { return require(module); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Install Playwright or set PLAYWRIGHT_MODULE_PATH.');
}
function browserPath(chromium) {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (fs.existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (fs.existsSync(cache)) {
    for (const folder of fs.readdirSync(cache).filter(folder => /^chromium-\d+$/.test(folder)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))) {
      for (const suffix of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
        const file = path.join(cache, folder, suffix); if (fs.existsSync(file)) return file;
      }
    }
  }
}
function readPcm16(wav) {
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  let format; let pcm;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const name = wav.toString('ascii', offset, offset + 4); const size = wav.readUInt32LE(offset + 4);
    const chunk = wav.subarray(offset + 8, offset + 8 + size);
    if (name === 'fmt ') format = { encoding: chunk.readUInt16LE(0), channels: chunk.readUInt16LE(2), rate: chunk.readUInt32LE(4), bits: chunk.readUInt16LE(14) };
    if (name === 'data') pcm = chunk;
    offset += 8 + size + size % 2;
  }
  assert.deepEqual(format, { encoding: 1, channels: 1, rate: 16000, bits: 16 }); assert(pcm?.length);
  return Array.from({ length: pcm.length / 2 }, (_, index) => pcm.readInt16LE(index * 2) / 32768);
}
function microphoneFixture() {
  window.__micCalls = 0; window.__nemoSockets = [];
  const NativeSocket = window.WebSocket;
  window.WebSocket = class extends NativeSocket {
    constructor(...args) { super(...args); window.__nemoSockets.push(this); }
  };
  const track = new EventTarget(); track.stop = () => {}; track.label = 'Nemotron WAV fixture';
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { window.__micCalls++; return stream; } });
  window.MediaRecorder = class extends EventTarget {
    static isTypeSupported() { return true; }
    state = 'inactive';
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive'; queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['saved-audio-fixture'], { type: 'audio/webm' }) });
        this.dispatchEvent(new Event('stop')); this.onstop?.();
      });
    }
  };
  window.AudioContext = class {
    state = 'suspended'; sampleRate = 16000; destination = {};
    createScriptProcessor() {
      const processor = { onaudioprocess: null, connect() {}, disconnect() {} };
      window.__feedPcm = input => processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => input }, outputBuffer: { getChannelData: () => new Float32Array(input.length) } });
      return processor;
    }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 256, getByteTimeDomainData(data) { data.fill(128); } }; }
    async resume() { this.state = 'running'; this.onstatechange?.(); }
    async close() { this.state = 'closed'; }
  };
}
async function rows(page, table) {
  return page.evaluate(table => new Promise((resolve, reject) => {
    const opening = indexedDB.open('may_dich_offline_db'); opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      try {
        const tx = db.transaction(table, 'readonly'); const query = tx.objectStore(table).getAll();
        query.onsuccess = () => resolve(query.result.map(row => row.blob ? { ...row, blob: { size: row.blob.size } } : row));
        query.onerror = () => reject(query.error); tx.oncomplete = () => db.close();
      } catch (error) { db.close(); reject(error); }
    };
  }), table);
}
async function until(check, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(label);
}
async function main() {
  const base = process.env.BASE_URL || 'http://localhost:3100';
  const output = path.resolve('test-results/nemotron'); fs.mkdirSync(output, { recursive: true });
  const file = path.resolve('.cache/nemotron/jfk.wav');
  if (!fs.existsSync(file)) {
    const response = await fetch('https://raw.githubusercontent.com/NVIDIA/NeMo-Speech.cpp/v0.2.0/test_files/asr/wav/test/jfk.wav');
    assert(response.ok, 'Official WAV fixture download'); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  const samples = readPcm16(fs.readFileSync(file));
  const { chromium } = playwright();
  const browser = await chromium.launch({ headless: true, executablePath: browserPath(chromium) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const { encode } = await import('next-auth/jwt');
    const name = 'authjs.session-token';
    const value = await encode({ secret: 'fixture-auth-secret-over-thirty-two-characters', salt: name, token: { sub: 'nemotron-fixture', email: 'owner@example.com' }, maxAge: 3600 });
    await context.addCookies([{ name, value, url: base, httpOnly: true, sameSite: 'Lax' }]);
    await context.storageState({ path: path.join(output, 'auth-state.json') });
    await context.addInitScript(microphoneFixture);
    await context.route('**/api/translate', async route => {
      const request = route.request().postDataJSON();
      const fullText = `Bản dịch kiểm thử: ${request.text}`;
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `event: delta\ndata: ${JSON.stringify({ delta: fullText })}\n\nevent: done\ndata: ${JSON.stringify({ fullText, modelKey: request.modelKey })}\n\n` });
    });
    await context.route('**/api/recordings/**', route => {
      const request = route.request();
      const body = request.method() === 'PUT'
        ? { row: { id: request.postDataJSON().id, payload: request.postDataJSON().payload, version: 1 } }
        : { items: [], nextCursor: null };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage(); const errors = []; const sessionResponses = []; const events = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', async response => {
      if (response.url().endsWith('/api/speech/nemotron/session')) sessionResponses.push({ status: response.status(), body: await response.json() });
    });
    page.on('websocket', socket => socket.on('framereceived', frame => {
      if (typeof frame.payload === 'string') { try { events.push(JSON.parse(frame.payload).type); } catch { /* Binary PCM is sent upstream. */ } }
    }));
    await page.goto(`${base}/settings`);
    await page.locator('#speech-provider').selectOption('nemotron');
    await page.getByRole('button', { name: 'Lưu cài đặt', exact: true }).click();
    await until(async () => (await rows(page, 'settings')).some(row => row.key === 'speechProvider' && row.value === 'nemotron'), 'Nemotron selection saved');
    await page.reload();
    await until(async () => await page.locator('#speech-provider').inputValue() === 'nemotron', 'Nemotron survives reload');
    assert(await page.locator('#transcription-mode').isDisabled());
    await page.getByRole('button', { name: 'Kiểm tra API nhận giọng', exact: true }).click();
    await page.getByText(/Nemotron 3.5 ASR kết nối thành công/).waitFor();
    assert.equal(await page.evaluate(() => window.__micCalls), 0, 'Connection test never opens microphone');
    await page.locator('#speech-provider').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'settings-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForTimeout(350); // Wait for the existing responsive sidebar transition.
    await page.locator('#speech-provider').scrollIntoViewIfNeeded();
    const box = await page.locator('#speech-provider').boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= 360, 'Nemotron selector fits mobile viewport');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Nemotron settings fit mobile');
    await page.screenshot({ path: path.join(output, 'settings-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}/app`);
    const language = page.getByRole('combobox', { name: 'Ngôn ngữ đầu vào', exact: true });
    await until(async () => await language.locator('option').count() === 32, 'Nemotron language catalogue');
    assert(await language.locator('option[value="vi-VN"]').count()); assert(await language.locator('option[value="ja-JP"]').count());
    await language.selectOption('en-US');
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).click();
    await until(() => page.evaluate(() => window.__nemoSockets.some(socket => socket.readyState === 1) && Boolean(window.__feedPcm)), 'Real NeMo socket and capture ready');
    await until(() => events.filter(type => type === 'session.updated').length >= 2, 'Real NeMo session configured');
    await page.evaluate(async samples => {
      for (let index = 0; index < samples.length; index += 3200) {
        window.__feedPcm(new Float32Array(samples.slice(index, index + 3200)));
        await new Promise(resolve => setTimeout(resolve, 60));
      }
    }, samples);
    await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).click();
    await page.getByRole('button', { name: 'Kết thúc và lưu', exact: true }).click();
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).waitFor();
    const captions = await rows(page, 'captionItems');
    const transcript = captions.map(caption => caption.source).join(' ');
    assert.match(transcript, /fellow Americans/i); assert.match(transcript, /your country/i);
    assert(captions.every(caption => caption.isFinal && caption.translation), 'Final captions and translations persist');
    assert.equal(await page.evaluate(() => window.__micCalls), 1, 'One microphone owner');
    assert(await page.evaluate(() => window.__nemoSockets.every(socket => socket.readyState === 3)), 'Stop closes sockets');
    assert((await rows(page, 'audioChunks')).some(row => row.blob.size > 0), 'Final audio chunk persists');
    assert(sessionResponses.length >= 2 && sessionResponses.every(response => response.status === 200));
    assert(sessionResponses.every(response => !('apiKey' in response.body) && !('secret' in response.body)));
    assert(events.includes('input_audio_buffer.committed'), 'Commit acknowledgement received');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, 'transcript-desktop.png') });
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, audioSeconds: samples.length / 16000, transcript, captions: captions.length, microphoneCalls: 1, sessionStatuses: sessionResponses.map(response => response.status), events, errors }, null, 2));
    console.log('PASS Nemotron selection/reload, connection without mic, 32 locales, mobile, real GPU streaming, commit/final captions, translation fixture, IndexedDB/audio persistence, one mic and closed sockets.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
