/*
 * Real end-to-end check: Chrome plays a WAV file as the microphone and the app
 * talks to the real Gemini Live Translate API. Costs about 30 s of API audio.
 * Usage: BASE_URL=http://localhost:3100 node scripts/gemini-translate-real-smoke.cjs <speech.wav>
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE_PATH, 'playwright',
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')];
  for (const candidate of candidates.filter(Boolean)) {
    try { return require(candidate); } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('Cài Playwright: npm install --save-dev playwright; npx playwright install chromium');
}

const { chromium } = loadPlaywright();
const baseUrl = process.env.BASE_URL || 'http://localhost:3100';
const wavPath = path.resolve(process.argv[2] || '');
if (!fs.existsSync(wavPath)) throw new Error('Usage: node scripts/gemini-translate-real-smoke.cjs <speech.wav>');
const outputDir = path.resolve(process.env.BROWSER_TEST_OUTPUT || 'test-results/browser');
fs.mkdirSync(outputDir, { recursive: true });

async function run() {
  const browser = await chromium.launch({
    headless: process.env.HEADED !== '1',
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' }),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wavPath}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  const wire = { url: '', audioFrames: 0, received: 0, closed: null };
  page.on('websocket', (socket) => {
    if (!socket.url().includes('generativelanguage.googleapis.com')) return;
    wire.url = socket.url().replace(/access_token=[^&]+/, 'access_token=<redacted>');
    socket.on('framesent', (frame) => { if (String(frame.payload).includes('"audio"')) wire.audioFrames++; });
    socket.on('framereceived', (frame) => {
      wire.received++;
      if (!process.env.DEBUG_FRAMES) return;
      const text = Buffer.isBuffer(frame.payload) ? frame.payload.toString('utf8') : String(frame.payload);
      if (/Transcription|setupComplete|error|goAway/.test(text)) { let compact = text; try { const m = JSON.parse(text); if (m.serverContent?.modelTurn) m.serverContent.modelTurn = 'audio'; compact = JSON.stringify(m); } catch {} console.log('recv', compact.slice(0, 220)); }
    });
    if (process.env.DEBUG_FRAMES) socket.on('framesent', (frame) => { if (!String(frame.payload).includes('"audio"')) console.log('sent', String(frame.payload).slice(0, 200)); });
    socket.on('close', () => { wire.closed = Date.now(); });
  });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  if (process.env.DEBUG_FRAMES) page.on('console', (message) => console.log('console', message.type(), message.text().slice(0, 200)));

  try {
    await page.goto(`${baseUrl}/new/source/record`);
    await page.locator('label', { hasText: 'Người nói bằng' }).locator('select').selectOption('ja-JP');
    await page.locator('label', { hasText: 'Dịch sang' }).locator('select').selectOption('vi');
    await page.locator('label', { hasText: 'Gemini 3.5 Live Translate' }).click();
    await page.waitForTimeout(500);
    const startedAt = Date.now();
    await page.getByRole('button', { name: 'Bắt đầu ghi âm' }).click();
    await page.waitForURL('**/recording', { timeout: 20_000 });

    const timeline = [];
    let last = '';
    while (Date.now() - startedAt < 25_000) {
      const sources = await page.getByTestId('caption-source').allInnerTexts().catch(() => []);
      const translations = await page.getByTestId('caption-translation').allInnerTexts().catch(() => []);
      const text = sources.map((source, index) => `${source.trim()} => ${(translations[index] || '').trim()}`).join(' | ');
      if (text && text !== last) { timeline.push({ ms: Date.now() - startedAt, text }); last = text; }
      await page.waitForTimeout(250);
    }
    await page.screenshot({ path: path.join(outputDir, 'gemini-translate-real.png'), fullPage: true });
    const firstJa = timeline.find((entry) => /[぀-ヿ一-鿿]/.test(entry.text));
    const firstVi = timeline.find((entry) => /mọi người|văn hóa|Nhật Bản|lịch sử|Trung Quốc/i.test(entry.text));
    console.log(JSON.stringify({
      wire, firstJapaneseMs: firstJa?.ms ?? null, firstVietnameseMs: firstVi?.ms ?? null,
      timeline: timeline.slice(0, 60), pageErrors,
    }, null, 2));
    assert.ok(wire.audioFrames > 50, `audio frames sent: ${wire.audioFrames}`);
    assert.ok(firstJa, 'Japanese source text never appeared');
    assert.ok(firstVi, 'Vietnamese translation never appeared');
  } finally {
    await browser.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
