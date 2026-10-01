/* Deterministic browser regression checks; AI and microphone boundaries are fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');

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

function executablePath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (fs.existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (fs.existsSync(cache)) {
    const folders = fs.readdirSync(cache).filter((folder) => /^chromium-\d+$/.test(folder))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const folder of folders) {
      for (const suffix of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
        const binary = path.join(cache, folder, suffix);
        if (fs.existsSync(binary)) return binary;
      }
    }
  }
  return undefined;
}

async function waitUntil(check, message, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(message);
}

async function storedRows(page, table, recordingId) {
  return page.evaluate(({ table, recordingId }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('may_dich_offline_db');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction(table, 'readonly');
      const query = transaction.objectStore(table).getAll();
      query.onerror = () => reject(query.error);
      query.onsuccess = () => resolve(query.result.filter((row) => !recordingId || row.recordingId === recordingId)
        .map((row) => row.blob ? { ...row, blob: { size: row.blob.size, type: row.blob.type } } : row));
      transaction.oncomplete = () => database.close();
    };
  }), { table, recordingId });
}

function installRecordingFixtures() {
  window.__translationRequests = [];
  window.__translationDone = [];
  window.__failTranslation = '';
  window.__micSpeaking = false;
  class FixtureRecorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor() { super(); this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        const event = new Event('dataavailable');
        Object.defineProperty(event, 'data', { value: new Blob(['final-audio-fixture'], { type: 'audio/webm' }) });
        this.dispatchEvent(event);
        this.ondataavailable?.(event);
        const stop = new Event('stop');
        this.dispatchEvent(stop);
        this.onstop?.(stop);
      });
    }
  }
  window.MediaRecorder = FixtureRecorder;
  const fixtureTrack = new EventTarget();
  fixtureTrack.stop = () => {};
  const fixtureStream = { getTracks: () => [fixtureTrack], getAudioTracks: () => [fixtureTrack] };
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    configurable: true, value: async () => fixtureStream,
  });
  class FixtureAudioContext {
    state = 'suspended';
    onstatechange = null;
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() {
      return { fftSize: 256, getByteTimeDomainData(data) { data.fill(window.__micSpeaking ? 160 : 128); } };
    }
    async resume() { this.state = 'running'; this.onstatechange?.(); }
    async close() { this.state = 'closed'; }
  }
  window.AudioContext = FixtureAudioContext;
  class FixtureSpeech extends EventTarget {
    constructor() { super(); this.results = []; this.index = 0; this.pending = false; }
    start() { window.__speech = this; this.onstart?.(); }
    say(text, isFinal) {
      window.__micSpeaking = !isFinal;
      const result = { 0: { transcript: text, confidence: 1 }, length: 1, isFinal };
      this.results[this.index] = result;
      this.onresult?.({ resultIndex: this.index, results: this.results });
      this.pending = !isFinal;
      if (isFinal) { this.index++; window.__micSpeaking = false; }
    }
    stop() {
      queueMicrotask(() => {
        if (this.pending) this.say(this.results[this.index][0].transcript, true);
        this.onend?.();
      });
    }
    abort() { this.onend?.(); }
  }
  window.SpeechRecognition = FixtureSpeech;
  window.webkitSpeechRecognition = FixtureSpeech;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (url, options) => {
    if (!String(url).endsWith('/api/translate')) return originalFetch(url, options);
    const request = JSON.parse(options.body);
    window.__translationRequests.push(request);
    const fails = request.text === window.__failTranslation;
    const translations = {
      '私は音楽が好きです。': 'Tôi thích âm nhạc.',
      '次の文です。': 'Đây là câu tiếp theo.',
      '最後まで保存します。': 'Lưu đến hết câu.',
    };
    const fullText = translations[request.text] || `Bản dịch: ${request.text}`;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let finished = false;
        const timers = [];
        const send = (event, data) => {
          if (!finished) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        timers.push(setTimeout(() => send('delta', { delta: fullText.slice(0, 8) }), 80));
        timers.push(setTimeout(() => {
          if (fails) send('error', { message: 'Lỗi API mô phỏng để kiểm thử' });
          else {
            send('delta', { delta: fullText.slice(8) });
            send('done', { fullText, modelKey: request.modelKey });
          }
          window.__translationDone.push(request.text);
          finished = true;
          controller.close();
        }, 1200));
        options.signal?.addEventListener('abort', () => {
          if (finished) return;
          finished = true;
          timers.forEach(clearTimeout);
          controller.error(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  };
}

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath: executablePath() });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  if (process.env.BROWSER_TEST_AUTH_SECRET) {
    const { encode } = await import('next-auth/jwt');
    const name = new URL(baseUrl).protocol === 'https:' ? '__Secure-authjs.session-token' : 'authjs.session-token';
    const value = await encode({ secret: process.env.BROWSER_TEST_AUTH_SECRET, salt: name, token: { sub: 'browser-fixture', email: process.env.BROWSER_TEST_OWNER_EMAIL }, maxAge: 3600 });
    await context.addCookies([{ name, value, url: baseUrl, httpOnly: true, sameSite: 'Lax', secure: new URL(baseUrl).protocol === 'https:' }]);
  }
  await context.addInitScript(installRecordingFixtures);
  const page = await context.newPage();
  const errors = [];
  const checks = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const check = (name) => { checks.push(name); console.log(`PASS ${name}`); };
  async function checkMobileTranscriptLayout() {
    for (const viewport of [{ width: 360, height: 800 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(300);
      const source = page.getByTestId('caption-source').first();
      const translation = page.getByTestId('caption-translation').first();
      await source.waitFor({ state: 'visible' });
      await translation.waitFor({ state: 'visible' });
      const layout = await page.evaluate(() => {
        const paneElement = document.querySelector('[data-testid="transcript-pane"]');
        const cardElement = document.querySelector('[data-testid="caption-card"]');
        const sourceElement = document.querySelector('[data-testid="caption-source"]');
        const translationElement = document.querySelector('[data-testid="caption-translation"]');
        const pane = paneElement.getBoundingClientRect();
        const card = cardElement.getBoundingClientRect();
        const source = sourceElement.getBoundingClientRect();
        const translation = translationElement.getBoundingClientRect();
        return {
          paneHeight: pane.height,
          paneX: pane.x,
          paneTop: pane.top,
          paneRight: pane.right,
          paneBottom: pane.bottom,
          cardX: card.x,
          cardRight: card.right,
          sourceTop: source.top,
          sourceBottom: source.bottom,
          translationTop: translation.top,
          translationBottom: translation.bottom,
          paneOverflowY: getComputedStyle(paneElement).overflowY,
          scrollHeight: paneElement.scrollHeight,
          clientHeight: paneElement.clientHeight,
          documentWidth: document.documentElement.scrollWidth,
        };
      });
      assert(layout.paneHeight >= 140, `${viewport.width}x${viewport.height}: transcript pane must remain usable, got ${layout.paneHeight}px`);
      assert(layout.paneX >= 0 && layout.paneRight <= viewport.width, `${viewport.width}px: transcript pane stays within screen width`);
      assert(layout.cardX >= layout.paneX && layout.cardRight <= layout.paneRight, `${viewport.width}px: caption card stays within transcript pane`);
      assert(layout.paneBottom <= viewport.height, `${viewport.height}px: transcript pane stays within visible viewport`);
      assert(layout.sourceTop >= layout.paneTop && layout.sourceBottom <= layout.paneBottom, `${viewport.width}px: source box stays visible in transcript pane`);
      assert(layout.translationTop >= layout.paneTop && layout.translationBottom <= layout.paneBottom, `${viewport.width}px: translation box stays visible in transcript pane`);
      assert(layout.documentWidth <= viewport.width, `${viewport.width}px: no horizontal page overflow`);
      assert(['auto', 'scroll'].includes(layout.paneOverflowY), 'Transcript content remains in its own scroll area');
      await page.screenshot({ path: path.join(outputDir, `transcript-mobile-${viewport.width}x${viewport.height}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    check('Nguồn và bản dịch giữ trong vùng cuộn ở 360x800 và 320x568');
  }
  try {
    await page.goto(`${baseUrl}/app`);
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).waitFor();
    assert(!(await page.locator('[data-nextjs-dialog]').count()), 'No Next.js error overlay');
    check('Trang tải, các nút ghi âm hiển thị');
    const modelSelector = page.getByRole('combobox', { name: 'Model dịch:', exact: true });
    await modelSelector.locator('option[value="google:gemini-2.5-flash-lite"]').waitFor({ state: 'attached' });
    const textModelKeys = await modelSelector.locator('option').evaluateAll((options) => options.map((option) => option.value));
    assert.deepEqual(textModelKeys.slice(0, 2), ['google:gemini-3.1-flash-lite', 'google:gemini-2.5-flash-lite']);
    assert.equal(await modelSelector.inputValue(), 'google:gemini-3.1-flash-lite');
    const effortSelector = page.locator('#translation-thinking');
    await effortSelector.selectOption('high');
    await modelSelector.selectOption('google:gemini-2.5-flash-lite');
    assert.equal(await effortSelector.locator('option[value="minimal"]').count(), 0);
    await effortSelector.selectOption('low');
    await waitUntil(async () => (await storedRows(page, 'settings')).some((setting) => setting.key === 'translationThinkingLevel' && setting.value === 'low'), 'Effort setting saved');
    await page.reload();
    await waitUntil(async () => await modelSelector.inputValue() === 'google:gemini-2.5-flash-lite' && await effortSelector.inputValue() === 'low', 'Model and effort persist');
    await modelSelector.selectOption('google:gemini-3.1-flash-lite');
    await effortSelector.selectOption('minimal');
    await page.screenshot({ path: path.join(outputDir, 'models-toolbar.png') });
    check('Model 3.1/2.5 đúng thứ tự, effort theo model và thiết lập giữ sau tải lại');
    const pause = page.getByRole('slider', { name: 'Khoảng nghỉ để chốt câu, giây' });
    await pause.focus();
    await pause.press('ArrowRight');
    assert.equal(await pause.inputValue(), '1000');
    await waitUntil(async () => (await storedRows(page, 'settings')).some((setting) => setting.key === 'pauseMs' && setting.value === '1000'), 'Pause setting saved');
    await page.reload();
    await waitUntil(async () => (await pause.inputValue()) === '1000', 'Pause setting persists across reload');
    await pause.focus();
    await pause.press('ArrowLeft');
    check('Khoảng nghỉ thay đổi và được giữ sau tải lại');

    const recordingId = 'browser-acceptance-fixture';
    const sources = ['私の趣味は音楽です。', 'クラシックが好きです。', '休みの日は友だちと出かけます。'];
    const captions = sources.map((source, index) => ({
      id: index + 1, recordingId, blockId: 1, startMs: index * 3000, endMs: index * 3000 + 2000,
      source, translation: ['Sở thích của tôi là âm nhạc.', 'Tôi thích nhạc cổ điển.', 'Ngày nghỉ tôi đi chơi với bạn.'][index],
      revision: 1, targetSourceRevision: 1, isFinal: true, state: 'done',
      ...(index === 0 ? { speakerLabel: 'Giảng viên', sourceHistory: [{ text: '私の趣味は音楽です', revision: 1 }] } : {}),
    }));
    const sourceHash = createHash('sha256').update(JSON.stringify(captions.map((c) => ({ id: c.id, text: c.source })))).digest('hex');
    const bundle = {
      schemaVersion: 1, exportedAt: new Date().toISOString(), hasAudio: false, hasImage: false,
      recording: { id: recordingId, title: 'Buổi kiểm thử popup', createdAt: new Date().toISOString(),
        mode: 'readingPractice', sourceLanguage: 'ja-JP', targetLanguage: 'vi', state: 'stopped',
        durationMs: 8000, audioState: 'missing', config: { translationModelKey: 'google:gemini-3.5-flash-lite' } },
      captions,
      summary: { id: `sum_${recordingId}`, recordingId, sourceHash, preset: 'default',
        modelKey: 'google:gemini-3.8-flash', title: 'Sở thích âm nhạc', overview: 'Âm nhạc và hoạt động ngày nghỉ.',
        sections: [{ heading: 'Sở thích', bullets: ['Nghe nhạc cổ điển.'], captionIds: [1, 2] }], generatedAt: new Date().toISOString() },
    };
    await page.locator('input[type=file]').setInputFiles({ name: 'recording.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
    await page.waitForURL(`**/recordings/${recordingId}`);
    await page.getByText('Giảng viên', { exact: true }).waitFor();
    const history = page.getByText('Lời nhận dạng trước đó (1)', { exact: true });
    await history.click();
    await page.getByText('私の趣味は音楽です', { exact: true }).waitFor();
    check('Nhãn người nói và lịch sử kết quả nhận dạng được hiển thị');
    const edit = page.getByRole('button', { name: 'Chỉnh sửa kịch bản', exact: true });
    await edit.click();
    const dialog = page.getByRole('dialog', { name: 'Chỉnh sửa kịch bản' });
    await dialog.waitFor();
    assert.equal(await dialog.locator('textarea').count(), 3);
    await dialog.getByRole('button', { name: 'Lưu', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Đóng cửa sổ chỉnh sửa');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Lưu');
    await dialog.getByRole('textbox', { name: 'Câu 1', exact: true }).fill('Chưa lưu');
    await page.keyboard.press('Escape');
    assert.equal((await storedRows(page, 'captionItems', recordingId))[0].source, sources[0]);
    check('Popup/Escape giữ nguyên dữ liệu chưa lưu');

    await edit.click();
    await dialog.getByRole('textbox', { name: 'Câu 1', exact: true }).fill('');
    await dialog.getByRole('button', { name: 'Lưu', exact: true }).click();
    assert(await dialog.getByRole('alert').isVisible(), 'Blank source line must not be silently deleted');
    await dialog.getByRole('button', { name: 'Hủy', exact: true }).click();
    check('Hủy và kiểm tra câu rỗng không làm mất dòng');

    await edit.click();
    await dialog.getByRole('textbox', { name: 'Tìm nội dung', exact: true }).fill('音楽');
    await dialog.getByRole('textbox', { name: 'Thay bằng', exact: true }).fill('ピアノ');
    await dialog.getByRole('button', { name: 'Thay tất cả', exact: true }).click();
    await page.screenshot({ path: path.join(outputDir, 'popup-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    const box = await dialog.boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= 391, 'Popup fits mobile width');
    assert(box.y >= 0 && box.y + box.height <= 845, 'Popup fits mobile height');
    await page.screenshot({ path: path.join(outputDir, 'popup-mobile.png') });
    await dialog.getByRole('button', { name: 'Lưu', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const edited = await storedRows(page, 'captionItems', recordingId);
    assert.equal(edited.length, 3);
    assert.equal(edited[0].source, '私の趣味はピアノです。');
    assert.equal(edited[0].revision, 2);
    assert.equal(edited[0].translation, captions[0].translation);
    assert.equal(edited[2].endMs, captions[2].endMs);
    check('Tìm/thay thế, Lưu, giữ ID/timing/bản dịch và popup vừa màn hình nhỏ');

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await page.getByText(edited[0].source, { exact: true }).waitFor();
    await page.getByRole('button', { name: /^Tóm tắt/ }).first().click();
    let summaryRequest;
    await page.route('**/api/summarize', async (route) => {
      summaryRequest = route.request().postDataJSON();
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        requestId: summaryRequest.requestId, recordingId, sourceHash: summaryRequest.sourceHash,
        modelKey: 'google:gemini-3.8-flash', title: 'Tóm tắt kịch bản đã chỉnh sửa',
        overview: 'Nội dung đã sửa thành sở thích piano.',
        sections: [{ heading: 'Piano', bullets: ['Sở thích piano.'], captionIds: [1] }], generatedAt: new Date().toISOString(),
      }) });
    });
    await page.getByRole('button', { name: 'Tạo lại', exact: true }).click();
    await page.getByText('Tóm tắt kịch bản đã chỉnh sửa', { exact: true }).waitFor();
    assert.equal(summaryRequest.captions[0].source, edited[0].source);
    assert.notEqual(summaryRequest.sourceHash, sourceHash);
    check('Tải lại giữ chữ sửa; Tạo lại tóm tắt dùng bản ghi/hash mới');

    await page.goto(`${baseUrl}/app`);
    await page.getByRole('button', { name: 'Luyện đọc', exact: true }).click();
    await page.locator('#speech-provider').selectOption('browser');
    assert.equal(await page.locator('#speech-provider').inputValue(), 'browser');
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).click();
    await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).waitFor();
    const meter = page.getByRole('progressbar', { name: 'Mức âm lượng micro' });
    await page.getByText('Nhận giọng: Trình duyệt', { exact: true }).waitFor();
    await page.getByText('Mic: đang bật', { exact: true }).waitFor();
    await waitUntil(() => page.evaluate(() => Boolean(window.__speech)), 'Speech fixture starts');
    await page.evaluate(() => { window.__micSpeaking = true; });
    await waitUntil(async () => Number(await meter.getAttribute('aria-valuenow')) > 0, 'Micro meter rises during fixture speech');
    await page.evaluate(() => { window.__micSpeaking = false; });
    check('Chọn được nhận giọng trình duyệt; mức mic và trạng thái audio hiện rõ');
    const started = Date.now();
    await page.evaluate(() => window.__speech.say('私は音楽が好きです。', true));
    await page.getByText('私は音楽が好きです。', { exact: true }).waitFor();
    const sourceLatencyMs = Date.now() - started;
    await waitUntil(() => page.getByText('Tôi thíc', { exact: true }).isVisible(), 'SSE delta must render before done');
    const deltaLatencyMs = Date.now() - started;
    assert.equal(await page.evaluate(() => window.__translationDone.length), 0);
    check(`Chữ gốc và delta SSE hiện trước done (fixture: ${sourceLatencyMs}/${deltaLatencyMs} ms)`);
    await page.getByText('Tôi thích âm nhạc.', { exact: true }).waitFor();
    await checkMobileTranscriptLayout();
    await page.evaluate(() => window.__speech.say('次の文です。', true));
    await page.getByText('Đây là câu tiếp theo.', { exact: true }).waitFor();
    await page.evaluate(() => window.__speech.say('最後まで保存します。', false));
    await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).click();
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).waitFor();
    await page.getByText('Lưu đến hết câu.', { exact: true }).waitFor();
    const requests = await page.evaluate(() => window.__translationRequests);
    const liveRecordingId = requests[0].recordingId;
    const liveCaptions = (await storedRows(page, 'captionItems', liveRecordingId)).sort((a, b) => a.id - b.id);
    assert.deepEqual(liveCaptions.map((c) => c.source), ['私は音楽が好きです。', '次の文です。', '最後まで保存します。']);
    assert(liveCaptions.every((c) => c.isFinal && c.state === 'done' && c.translation));
    const audio = await storedRows(page, 'audioChunks', liveRecordingId);
    assert(audio.some((chunk) => chunk.blob.size > 0), 'Final audio chunk persists after Stop');
    assert.equal((await storedRows(page, 'captionItems', recordingId)).length, 3, 'New recording keeps earlier captions');
    check('0,9s chốt luyện đọc; Dừng giữ đủ 3 câu, bản dịch cuối và audio cuối');

    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).click();
    await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).waitFor();
    await page.evaluate(() => { window.__failTranslation = 'API失敗。'; window.__speech.say('API失敗。', true); });
    await page.getByText('Lỗi dịch: Lỗi API mô phỏng để kiểm thử', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).click();
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).waitFor();
    const errorRecordingId = await page.evaluate(() => window.__translationRequests.at(-1).recordingId);
    const failed = await storedRows(page, 'captionItems', errorRecordingId);
    assert.equal(failed[0].state, 'failed');
    assert(failed[0].translation, 'Keep partial translation on failure');
    assert.equal(failed[0].source, 'API失敗。');
    assert.equal(failed[0].isFinal, true, 'Final source remains finalized when translation fails');
    check('Lỗi SSE hiện failed, giữ chữ gốc và bản dịch tạm');

    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).click();
    await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).waitFor();
    await page.evaluate(() => window.__speech.say('遅れて届いた結果', false));
    await page.getByText('遅れて届いた結果', { exact: true }).waitFor();
    await page.waitForTimeout(1100); // The fixture is silent for longer than the chosen 900 ms pause.
    await page.evaluate(() => window.__speech.say('遅れて届いた結果を全部残します。', true));
    await page.getByText('遅れて届いた結果を全部残します。', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).click();
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).waitFor();
    const correctedRecordingId = await page.evaluate(() => window.__translationRequests.at(-1).recordingId);
    const corrected = await storedRows(page, 'captionItems', correctedRecordingId);
    assert.equal(corrected.length, 1, 'A late STT final corrects its existing reading caption');
    assert.equal(corrected[0].source, '遅れて届いた結果を全部残します。');
    assert.equal(corrected[0].state, 'done');
    check('Kết quả nhận giọng cuối đến muộn sửa đúng câu, không nhân đôi dòng');
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    check('Không có lỗi JavaScript chưa xử lý');
    fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify({
      passed: true, boundary: 'Browser + real app + IndexedDB; microphone/STT/AI responses are fixtures',
      checks, sourceLatencyMs, deltaLatencyMs, errors,
    }, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(outputDir, 'failure.png'), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(outputDir, 'failure.json'), JSON.stringify({ passed: false, checks, errors, error: error.message }, null, 2));
    throw error;
  } finally {
    await browser.close();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
