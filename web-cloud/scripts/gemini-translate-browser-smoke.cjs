/* Real Chrome + fake microphone; the Gemini token route and Live socket are fixtures, so no AI cost. */
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
const outputDir = path.resolve(process.env.BROWSER_TEST_OUTPUT || 'test-results/browser');
fs.mkdirSync(outputDir, { recursive: true });
const FIXTURE_SOCKET = 'wss://gemini.fixture.test/live';

async function run() {
  const browser = await chromium.launch({
    headless: process.env.HEADED !== '1',
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' }),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ permissions: ['microphone'] });
  const tokenRequests = [];
  const live = { setup: null, audioFrames: 0, firstAudioAt: 0, streamEnds: 0, sentText: false };

  await context.route('**/api/speech/token', async (route) => {
    tokenRequests.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ json: {
      token: 'fixture-token', websocketUrl: FIXTURE_SOCKET,
      expiresAt: new Date(Date.now() + 600_000).toISOString(), sessionLimitMs: 600_000,
    } });
  });
  await context.routeWebSocket(/gemini\.fixture\.test/, (socket) => {
    const reply = (value) => socket.send(JSON.stringify(value));
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.setup) { live.setup = message.setup; reply({ setupComplete: {} }); return; }
      if (message.realtimeInput?.audioStreamEnd) { live.streamEnds++; return; }
      if (!message.realtimeInput?.audio) return;
      live.audioFrames++;
      live.firstAudioAt ||= Date.now();
      // Gemini Live Translate streams deltas while the speaker talks.
      if (live.audioFrames === 5) reply({ serverContent: { inputTranscription: { text: 'こんにちは' }, outputTranscription: { text: 'Xin chào' } } });
      if (live.audioFrames === 8) {
        reply({ serverContent: { inputTranscription: { text: '、皆さん。' }, outputTranscription: { text: ' mọi người.' } } });
        live.sentText = true;
      }
    });
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  try {
    await page.goto(`${baseUrl}/new/source/record`);
    await page.locator('label', { hasText: 'Người nói bằng' }).locator('select').selectOption('ja-JP');
    await page.locator('label', { hasText: 'Dịch sang' }).locator('select').selectOption('vi');
    await page.locator('label', { hasText: 'Gemini 3.5 Live Translate' }).click();
    await page.waitForTimeout(500);
    const startedAt = Date.now();
    await page.getByRole('button', { name: 'Bắt đầu ghi âm' }).click();
    await page.waitForURL('**/recording', { timeout: 20_000 });

    await page.getByText('Xin chào mọi người.').first().waitFor({ timeout: 20_000 });
    const captionMs = Date.now() - startedAt;
    await page.getByText('こんにちは、皆さん。').first().waitFor({ timeout: 5_000 });
    // Two more seconds of the fake device's beeps, for the frame-rate report.
    const framesBefore = live.audioFrames;
    await page.waitForTimeout(2000);
    const framesPerSecond = (live.audioFrames - framesBefore) / 2;
    await page.screenshot({ path: path.join(outputDir, 'gemini-translate-live.png'), fullPage: true });

    assert.equal(tokenRequests[0]?.model, 'gemini-3.5-live-translate-preview');
    assert.deepEqual(live.setup.generationConfig, {
      responseModalities: ['AUDIO'],
      translationConfig: { targetLanguageCode: 'vi', echoTargetLanguage: true },
    });
    assert.ok(!('translationConfig' in live.setup), 'translationConfig must sit under generationConfig');
    assert.ok(live.audioFrames > 0, 'microphone audio never reached Gemini');
    console.log(JSON.stringify({
      ok: true, captionMs, framesPerSecond, audioFrames: live.audioFrames, streamEnds: live.streamEnds,
      consoleErrors: consoleErrors.slice(0, 5),
    }, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(outputDir, 'gemini-translate-live-failure.png'), fullPage: true }).catch(() => undefined);
    console.error(JSON.stringify({ live: { ...live, setup: live.setup }, tokenRequests, consoleErrors: consoleErrors.slice(0, 10) }, null, 2));
    throw error;
  } finally {
    await browser.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
