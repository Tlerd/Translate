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
  window.__transcriptionQueue = [];
  window.__transcriptionRequests = [];
  window.__liveSockets = [];
  window.__sonioxSockets = [];
  window.__sonioxSessions = [];
  window.__micCalls = 0;
  window.__liveTokenRequests = [];
  window.__NativeAudioContext = window.AudioContext;
  window.__NativeMediaRecorder = window.MediaRecorder;
  const NativeWebSocket = window.WebSocket;
  class FixtureLiveSocket {
    constructor(url, protocols) {
      if (String(url) === 'wss://stt-rt.soniox.com/transcribe-websocket') {
        this.readyState = 0; this.bufferedAmount = 0; this.soniox = true; this.frames = 0;
        window.__sonioxSockets.push(this);
        setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
        return;
      }
      if (!String(url).startsWith('wss://fixture.test/')) return new NativeWebSocket(url, protocols);
      this.readyState = 0; this.bufferedAmount = 0;
      window.__liveSockets.push(this);
      setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
    }
    send(raw) {
      if (this.soniox) {
        if (typeof raw !== 'string') { this.frames++; return; }
        if (raw === '') { setTimeout(() => this.message({ finished: true }), 10); return; }
        const message = JSON.parse(raw);
        if (message.api_key) this.config = message;
        if (message.type === 'finalize') this.message({ tokens: [{ text: '<fin>', is_final: true }] });
        return;
      }
      const message = JSON.parse(raw);
      if (message.setup) {
        this.mode = message.setup.inputAudioTranscription.mode;
        this.setup = message.setup;
        setTimeout(() => this.message({ setupComplete: {} }), 0);
      }
      if (message.realtimeInput?.audioStreamEnd) this.message({ serverContent: { turnComplete: true } });
    }
    message(value) { this.onmessage?.({ data: new TextEncoder().encode(JSON.stringify(value)).buffer }); }
    say(text) {
      if (this.setup.model === 'models/gemini-3.1-flash-live-preview') window.__feedPcm?.(new Float32Array(1600).fill(0.2));
      this.message({ serverContent: { inputTranscription: { text, finished: true } } });
    }
    close(code = 1000, reason = '') { this.readyState = 3; this.onclose?.({ code, reason }); }
  }
  window.WebSocket = FixtureLiveSocket;
  class FixtureRecorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor() { super(); this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        const event = new Event('dataavailable');
        Object.defineProperty(event, 'data', { value: window.__validAudioBlob || new Blob(['final-audio-fixture'], { type: 'audio/webm' }) });
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
    configurable: true, value: async () => { window.__micCalls++; return fixtureStream; },
  });
  class FixtureAudioContext {
    state = 'suspended';
    onstatechange = null;
    sampleRate = 16000;
    destination = {};
    createScriptProcessor() {
      const processor = { onaudioprocess: null, connect() {}, disconnect() {} };
      window.__feedPcm = (input) => processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => input }, outputBuffer: { getChannelData: () => new Float32Array(input.length) } });
      window.__speech = { say(text, isFinal) {
        window.__transcriptionQueue.push(text);
        const feed = (input) => processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => input }, outputBuffer: { getChannelData: () => new Float32Array(input.length) } });
        feed(new Float32Array(8000).fill(0.2));
        if (isFinal) feed(new Float32Array(16000));
      } };
      return processor;
    }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
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
    if (String(url).endsWith('/api/speech/soniox/session')) {
      window.__sonioxSessions.push(JSON.parse(options.body));
      return Response.json({ token: 'fixture-soniox', expiresAt: new Date(Date.now() + 120000).toISOString(), model: 'stt-rt-v5', websocketUrl: 'wss://stt-rt.soniox.com/transcribe-websocket', sessionLimitMs: 3600000, renewAfterMs: 3300000 });
    }
    if (String(url).endsWith('/api/speech/token')) {
      const request = JSON.parse(options.body); window.__liveTokenRequests.push(request);
      return Response.json({ token: 'fixture-live-token', model: request.model, websocketUrl: 'wss://fixture.test/live', sessionLimitMs: 600000 });
    }
    if (String(url).endsWith('/api/speech/transcribe')) {
      const form = options.body;
      const mode = form.get('transcriptionMode');
      const count = form.get('speakerCount');
      const model = form.get('model') || 'gemini-3.5-transcribe';
      window.__transcriptionRequests.push({ mode, count, model, durationMs: form.get('durationMs'), audioType: form.get('audio').type });
      const text = window.__transcriptionQueue.shift() || '';
      const turns = mode === 'verbatim' && text ? (window.__nextTurns || [{ text, speakerLabel: 'spk_1', startMs: 0, endMs: Math.min(500, Number(form.get('durationMs'))) }]) : [];
      window.__nextTurns = null;
      return Response.json({ text, turns, model });
    }
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
    await page.goto(`${baseUrl}/settings`);
    const modelSelector = page.getByRole('combobox', { name: 'Model dịch:', exact: true });
    await modelSelector.locator('option[value="google:gemini-3.5-flash-lite"]').waitFor({ state: 'attached' });
    const textModelKeys = await modelSelector.locator('option').evaluateAll((options) => options.map((option) => option.value));
    assert.deepEqual(textModelKeys.slice(0, 2), ['google:gemini-3.1-flash-lite', 'google:gemini-3.5-flash-lite']);
    assert.equal(await modelSelector.inputValue(), 'google:gemini-3.1-flash-lite');
    const effortSelector = page.locator('#translation-thinking');
    await effortSelector.selectOption('high');
    await modelSelector.selectOption('google:gemini-3.5-flash-lite');
    await effortSelector.selectOption('low');
    const pause = page.getByRole('slider', { name: 'Khoảng nghỉ để chốt câu, giây' });
    await pause.focus();
    await pause.press('ArrowRight');
    assert.equal(await pause.inputValue(), '1000');
    await page.getByRole('button', { name: 'Lưu cài đặt', exact: true }).click();
    await waitUntil(async () => (await storedRows(page, 'settings')).some((setting) => setting.key === 'translationThinkingLevel' && setting.value === 'low'), 'Effort setting saved');
    await page.reload();
    await waitUntil(async () => await modelSelector.inputValue() === 'google:gemini-3.5-flash-lite' && await effortSelector.inputValue() === 'low', 'Model and effort persist');
    await modelSelector.selectOption('google:gemini-3.1-flash-lite');
    await effortSelector.selectOption('minimal');
    await pause.focus();
    await pause.press('ArrowLeft');
    await page.getByRole('button', { name: 'Lưu cài đặt', exact: true }).click();
    await page.screenshot({ path: path.join(outputDir, 'models-toolbar.png') });
    check('Model 3.1/3.5 đúng thứ tự, effort theo model và thiết lập giữ sau tải lại');
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
    assert.equal(await page.locator('input[type=file]').count(), 0, 'Redundant sidebar upload was removed');
    await page.evaluate(bundle => new Promise((resolve, reject) => {
      const open = indexedDB.open('may_dich_offline_db'); open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result, transaction = database.transaction(['recordings', 'captionItems', 'summaries'], 'readwrite');
        transaction.objectStore('recordings').put(bundle.recording);
        bundle.captions.forEach(caption => transaction.objectStore('captionItems').put(caption));
        transaction.objectStore('summaries').put(bundle.summary);
        transaction.oncomplete = () => { database.close(); resolve(); }; transaction.onerror = () => reject(transaction.error);
      };
    }), bundle);
    await page.goto(`${baseUrl}/recordings/${recordingId}`);
    assert.equal(await page.getByRole('combobox', { name: 'Người nói cho câu 1', exact: true }).inputValue(), 'Giảng viên');
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

    await page.goto(`${baseUrl}/settings`);
    await page.locator('#transcription-mode').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#speech-provider option').count(), 5);
    assert.equal(await page.locator('#speech-provider option[value="nemotron"]').count(), 1);
    await page.locator('#speech-provider').selectOption('google-transcribe');
    assert.equal(await page.locator('#transcription-mode option').count(), 2);
    assert.equal(await page.locator('#speaker-count option').count(), 8);
    assert.match(await page.locator('#speaker-count').inputValue(), /^[1-8]$/);
    assert.match(await page.locator('body').innerText(), /0,005 USD\/phút/);
    await page.locator('#transcription-mode').selectOption('smart');
    await page.locator('#speaker-count').selectOption('8');
    await page.getByRole('button', { name: 'Lưu cài đặt', exact: true }).click();
    await page.getByRole('link', { name: 'Về phòng học', exact: true }).click();
    await page.getByRole('button', { name: 'Luyện đọc', exact: true }).click();
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).click();
    await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).waitFor();
    const meter = page.getByRole('progressbar', { name: 'Mức âm lượng micro' });
    await page.getByText('Nhận giọng: Gemini 3.5 Transcribe · smart', { exact: true }).waitFor();
    await page.getByText('8 người nói', { exact: true }).waitFor();
    await page.getByText('Mic: đang bật', { exact: true }).waitFor();
    await waitUntil(() => page.evaluate(() => Boolean(window.__speech)), 'PCM fixture starts');
    await page.evaluate(() => { window.__micSpeaking = true; });
    await waitUntil(async () => Number(await meter.getAttribute('aria-valuenow')) > 0, 'Micro meter rises during fixture speech');
    await page.evaluate(() => { window.__micSpeaking = false; });
    check('Cấu hình smart + 8 người áp dụng ngay qua điều hướng; giữ lựa chọn Live và Gemini Transcribe');
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
    await page.getByRole('button', { name: 'Kết thúc và lưu', exact: true }).click();
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
    const nativeRequests = await page.evaluate(() => window.__transcriptionRequests);
    assert(nativeRequests.every(request => request.mode === 'smart' && request.count === '8' && request.audioType === 'audio/wav'));
    const speakerSelector = page.getByRole('combobox', { name: 'Người nói cho câu 1', exact: true });
    assert.equal(await speakerSelector.locator('option').count(), 9);
    await speakerSelector.selectOption('spk_8');
    await waitUntil(async () => (await storedRows(page, 'captionItems', liveRecordingId))[0].speakerLabel === 'spk_8', 'Manual smart speaker persists');
    const labelledCaption = (await storedRows(page, 'captionItems', liveRecordingId))[0];
    assert.equal(labelledCaption.source, '私は音楽が好きです。');
    assert.equal(labelledCaption.translation, 'Tôi thích âm nhạc.');
    assert.equal(await page.getByRole('button', { name: /Phân biệt.*người nói/ }).count(), 0);
    check('Smart gán Speaker 8 thủ công và lưu nguyên bản dịch, không gọi diarization');

    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).click();
    await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).waitFor();
    await page.evaluate(() => { window.__failTranslation = 'API失敗。'; window.__speech.say('API失敗。', true); });
    await page.getByText('Lỗi dịch: Lỗi API mô phỏng để kiểm thử', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).click();
    await page.getByRole('button', { name: 'Kết thúc và lưu', exact: true }).click();
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
    await page.evaluate(() => window.__speech.say('遅れて届いた結果を全部残します。', false));
    await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).click();
    await page.getByRole('button', { name: 'Kết thúc và lưu', exact: true }).click();
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).waitFor();
    await page.getByText('遅れて届いた結果を全部残します。', { exact: true }).waitFor();
    const correctedRecordingId = await page.evaluate(() => window.__translationRequests.at(-1).recordingId);
    const corrected = await storedRows(page, 'captionItems', correctedRecordingId);
    assert.equal(corrected.length, 1, 'Pending unary audio becomes a single final reading caption');
    assert.equal(corrected[0].source, '遅れて届いた結果を全部残します。');
    assert.equal(corrected[0].state, 'done');
    check('Dừng chờ nhận giọng theo đoạn và lưu đủ lời cuối, không nhân đôi dòng');
    await page.getByRole('link', { name: 'Cấu hình AI', exact: true }).last().click();
    await page.locator('#transcription-mode').selectOption('verbatim');
    await page.locator('#speaker-count').selectOption('2');
    await page.getByRole('button', { name: 'Lưu cài đặt', exact: true }).click();
    await page.getByRole('link', { name: 'Về phòng học', exact: true }).click();
    await page.getByRole('button', { name: 'Giảng bài', exact: true }).click();
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).click();
    await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).waitFor();
    await page.evaluate(() => {
      window.__nextTurns = [
        { text: '一人目。', speakerLabel: 'spk_1', startMs: 0, endMs: 200 },
        { text: '二人目。', speakerLabel: 'spk_2', startMs: 300, endMs: 500 },
      ];
      window.__speech.say('一人目。二人目。', true);
    });
    await page.getByText('Speaker 1', { exact: true }).waitFor();
    await page.getByText('Speaker 2', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).click();
    await page.getByRole('button', { name: 'Kết thúc và lưu', exact: true }).click();
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Người nói cho câu 1', exact: true }).inputValue(), 'spk_1');
    assert.equal(await page.getByRole('combobox', { name: 'Người nói cho câu 2', exact: true }).inputValue(), 'spk_2');
    const diarizedRecordingId = await page.evaluate(() => window.__translationRequests.at(-1).recordingId);
    const nativeCaptions = await storedRows(page, 'captionItems', diarizedRecordingId);
    assert.deepEqual(nativeCaptions.map(caption => caption.speakerLabel), ['spk_1', 'spk_2']);
    const lastTranscription = await page.evaluate(() => window.__transcriptionRequests.at(-1));
    assert.equal(lastTranscription.mode, 'verbatim');
    assert.equal(lastTranscription.count, '2');
    await page.screenshot({ path: path.join(outputDir, 'transcribe-speakers-desktop.png') });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForTimeout(300); // Wait for the sidebar's responsive transition.
    await page.screenshot({ path: path.join(outputDir, 'transcribe-speakers-mobile.png') });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Speaker controls fit mobile screen');
    check('Verbatim nhận hai Speaker trong cùng lượt phiên âm, lưu nhãn và hiển thị trên mobile');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('link', { name: 'Cấu hình AI', exact: true }).last().click();
    await page.locator('#speech-provider').waitFor({ state: 'visible' });
    await page.locator('#speech-provider').selectOption('google-flash-live');
    assert.match(await page.locator('#transcription-mode-help').innerText(), /gán Speaker thủ công/);
    assert.match(await page.locator('body').innerText(), /0,005 USD/);
    await page.getByRole('button', { name: 'Lưu cài đặt', exact: true }).click();
    await page.reload();
    await page.locator('#speech-provider').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#speech-provider').inputValue(), 'google-flash-live');
    await page.getByRole('button', { name: 'Kiểm tra API nhận giọng', exact: true }).click();
    await page.getByText(/Gemini 3 Flash Live kết nối thành công/).waitFor();
    assert.equal(await page.evaluate(() => window.__liveTokenRequests.at(-1).model), 'gemini-3.1-flash-live-preview');
    await page.screenshot({ path: path.join(outputDir, 'flash-settings-desktop.png') });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outputDir, 'flash-settings-mobile.png'), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Flash settings fit mobile screen');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('link', { name: 'Về phòng học', exact: true }).click();
    await page.getByRole('button', { name: 'Luyện đọc', exact: true }).click();
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).click();
    await page.getByText('Nhận giọng: Gemini 3 Flash Live', { exact: true }).waitFor();
    await waitUntil(() => page.evaluate(() => window.__liveSockets.at(-1)?.setup?.model === 'models/gemini-3.1-flash-live-preview'), 'Flash Live socket setup');
    assert(await page.evaluate(() => window.__transcriptionRequests.length === 0), 'Flash Live never calls segmented transcription');
    await page.evaluate(() => {
      window.__feedPcm(new Float32Array(16000));
      window.__liveSockets.at(-1).message({ serverContent: { inputTranscription: { text: 'ええ。', finished: true }, outputTranscription: { text: 'invented reply' }, modelTurn: { parts: [{ text: 'invented reply' }] } } });
    });
    assert.equal(await page.getByTestId('caption-source').count(), 0, 'Silence and model-generated replies produce no classroom captions');
    await page.evaluate(() => {
      window.__feedPcm(new Float32Array(1600).fill(0.2));
      const socket = window.__liveSockets.at(-1);
      socket.message({ serverContent: { inputTranscription: { text: '私は音楽が' } } });
      socket.message({ serverContent: { inputTranscription: { text: '好きです。', finished: true } } });
    });
    await page.getByText('Tôi thích âm nhạc.', { exact: true }).waitFor();
    // Real Flash input ASR need not send finished or any model turnComplete.
    // Repeat the read → pause → read flow that previously lost the next row.
    await page.evaluate(() => {
      window.__feedPcm(new Float32Array(1600).fill(0.2));
      window.__liveSockets.at(-1).message({ serverContent: { inputTranscription: { text: '次の文です。' }, waitingForInput: true } });
    });
    await page.getByText('Đây là câu tiếp theo.', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('caption-source').count(), 2, 'A second spoken sentence creates its own source and translation row');
    await page.evaluate(() => {
      window.__feedPcm(new Float32Array(1600).fill(0.2));
      const socket = window.__liveSockets.at(-1);
      socket.message({ serverContent: { inputTranscription: { text: '最後まで' } } });
      socket.message({ serverContent: { turnComplete: true, outputTranscription: { text: 'irrelevant model response' } } });
      socket.message({ serverContent: { inputTranscription: { text: '保存します。' } } });
    });
    await page.getByText('Lưu đến hết câu.', { exact: true }).waitFor();
    assert.deepEqual(await page.getByTestId('caption-source').allTextContents(), ['私は音楽が好きです。', '次の文です。', '最後まで保存します。']);
    assert.equal(await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).count(), 1, 'Capture remains active across Flash sentence pauses');
    await page.screenshot({ path: path.join(outputDir, 'flash-live-multiple-sentences.png') });

    await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).click();
    await page.getByRole('button', { name: 'Kết thúc và lưu', exact: true }).click();
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__liveTokenRequests.at(-1).model), 'gemini-3.1-flash-live-preview');
    const flashRecordingId = await page.evaluate(() => window.__translationRequests.at(-1).recordingId);
    const flashCaptions = await storedRows(page, 'captionItems', flashRecordingId);
    assert.equal(flashCaptions[0].source, '私は音楽が好きです。');
    assert.equal(flashCaptions[0].translation, 'Tôi thích âm nhạc.');
    assert.equal(flashCaptions[0].speakerLabel, undefined);
    assert.deepEqual(flashCaptions.map(caption => [caption.source, caption.translation]), [['私は音楽が好きです。', 'Tôi thích âm nhạc.'], ['次の文です。', 'Đây là câu tiếp theo.'], ['最後まで保存します。', 'Lưu đến hết câu.']]);
    assert(await page.evaluate(() => window.__liveSockets.at(-1).readyState === 3), 'Stop closes the Flash Live socket');
    await page.evaluate(() => window.__liveSockets.at(-1).message({ serverContent: { inputTranscription: { text: 'late phantom text', finished: true } } }));
    assert.equal(await page.getByTestId('caption-source').count(), 3, 'Late replies after Stop cannot add captions');
    check('Flash Live chọn/lưu/reload, đúng token và WebSocket, im lặng không sinh chữ, 3 câu liên tiếp qua khoảng nghỉ → dịch → lưu, lượt model kết thúc lệch không mất chữ, Dừng đóng socket, mobile không tràn');
    await page.getByRole('link', { name: 'Cấu hình AI', exact: true }).last().click();
    await page.locator('#speech-provider').waitFor({ state: 'visible' });
    await page.locator('#speech-provider').selectOption('google');
    await page.locator('#transcription-mode').selectOption('smart');
    await page.locator('#speaker-count').selectOption('8');
    await page.getByRole('button', { name: 'Lưu cài đặt', exact: true }).click();
    await page.getByRole('link', { name: 'Về phòng học', exact: true }).click();
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).click();
    await page.getByText('Nhận giọng: Gemini 3.5 Transcribe Live · smart', { exact: true }).waitFor();
    await waitUntil(() => page.evaluate(() => window.__liveSockets.at(-1)?.mode === 'SMART'), 'Live smart socket setup');
    await page.evaluate(() => window.__liveSockets.at(-1).say('私は音楽が好きです。'));
    await page.getByText('Tôi thích âm nhạc.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).click();
    await page.getByRole('button', { name: 'Kết thúc và lưu', exact: true }).click();
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Người nói cho câu 1', exact: true }).selectOption('spk_8');
    const liveSocketRecordingId = await page.evaluate(() => window.__translationRequests.at(-1).recordingId);
    await waitUntil(async () => (await storedRows(page, 'captionItems', liveSocketRecordingId))[0].speakerLabel === 'spk_8', 'Live manual speaker persists');
    assert(await page.evaluate(() => window.__liveSockets.every(socket => socket.readyState === 3)), 'Live socket closes after stop');
    await page.goto(`${baseUrl}/settings`);
    await page.locator('#speech-provider').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#speech-provider').inputValue(), 'google');
    check('Live smart nhận chữ qua WebSocket, dịch, lưu Speaker 8 và giữ lựa chọn sau reload');
    await page.locator('#speech-provider').selectOption('soniox');
    assert(await page.locator('#transcription-mode').isDisabled());
    assert(await page.locator('#speaker-count').isEnabled());
    await page.getByRole('button', { name: 'Lưu cài đặt', exact: true }).click();
    await page.reload();
    await page.locator('#speech-provider').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#speech-provider').inputValue(), 'soniox');
    assert.match(await page.locator('body').innerText(), /0,12 USD/);
    await page.getByRole('button', { name: 'Kiểm tra API nhận giọng', exact: true }).click();
    await page.getByText(/Soniox · stt-rt-v5 kết nối thành công/).waitFor();
    await page.evaluate(async () => {
      // A real playable synthetic tone exercises audio persistence without a mic.
      const context = new window.__NativeAudioContext();
      const destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator(); oscillator.frequency.value = 440;
      oscillator.connect(destination); await context.resume(); oscillator.start();
      const recorder = new window.__NativeMediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' });
      const chunks = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      const stopped = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.start(); await new Promise(resolve => setTimeout(resolve, 1000)); recorder.stop();
      await stopped; oscillator.stop(); destination.stream.getTracks().forEach(track => track.stop()); await context.close();
      window.__validAudioBlob = new Blob(chunks, { type: 'audio/webm' });
    });
    assert.equal(await page.evaluate(() => window.__micCalls), 0, 'Connection test never opens mic');
    assert(await page.evaluate(() => window.__sonioxSockets[0].frames > 0 && window.__sonioxSockets[0].readyState === 3));
    await page.getByRole('link', { name: 'Về phòng học', exact: true }).click();
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).click();
    await waitUntil(() => page.evaluate(() => window.__sonioxSockets.at(-1)?.config?.model === 'stt-rt-v5'), 'Soniox configured');
    await page.evaluate(() => {
      window.__feedPcm(new Float32Array(1600));
      window.__sonioxSockets.at(-1).message({ tokens: [{ text: '私は音楽が' }] });
    });
    await page.getByText('私は音楽が', { exact: true }).waitFor();
    await page.evaluate(() => window.__sonioxSockets.at(-1).message({ tokens: [{ text: '私は音楽が好きです。', is_final: true }, { text: '<fin>', is_final: true }] }));
    await page.getByText('Tôi thích âm nhạc.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Dừng API', exact: true }).click();
    await waitUntil(() => page.evaluate(() => window.__sonioxSockets.at(-1).readyState === 3), 'Pause closes Soniox');
    const beforePause = await page.evaluate(() => window.__sonioxSessions.length);
    await page.evaluate(() => window.__feedPcm(new Float32Array(1600).fill(0.3)));
    assert.equal(await page.evaluate(() => window.__sonioxSessions.length), beforePause);
    await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await waitUntil(() => page.evaluate(count => window.__sonioxSessions.length === count + 1, beforePause), 'Resume new Soniox session');
    await waitUntil(() => page.evaluate(() => window.__sonioxSockets.at(-1)?.config), 'Resume socket configured');
    await page.evaluate(() => {
      window.__feedPcm(new Float32Array(1600));
      window.__sonioxSockets.at(-1).message({ tokens: [{ text: '次の文です。', is_final: true }, { text: '<fin>', is_final: true }] });
    });
    await page.getByText('Đây là câu tiếp theo.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__micCalls), 1, 'Pause/resume shares one microphone');
    await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).click();
    await page.getByRole('button', { name: 'Kết thúc và lưu', exact: true }).click();
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).waitFor();
    const sonioxRecordingId = await page.evaluate(() => window.__translationRequests.at(-1).recordingId);
    assert.equal((await storedRows(page, 'captionItems', sonioxRecordingId)).length, 2);
    assert((await storedRows(page, 'audioChunks', sonioxRecordingId)).some(chunk => chunk.blob.size > 0));
    await page.goto(`${baseUrl}/recordings/${sonioxRecordingId}`);
    await page.reload();
    await page.getByText('私は音楽が好きです。', { exact: true }).waitFor();
    assert.equal((await storedRows(page, 'captionItems', sonioxRecordingId)).length, 2);
    await page.getByRole('button', { name: 'Ghi âm', exact: true }).click();
    const sonioxAudio = page.locator('audio[aria-label="Nghe toàn bộ buổi học"]');
    await sonioxAudio.waitFor();
    await sonioxAudio.evaluate(audio => audio.play());
    await waitUntil(() => sonioxAudio.evaluate(audio => audio.currentTime > 0 && !audio.error), 'Persisted synthetic audio plays after reload');
    await sonioxAudio.evaluate(audio => audio.pause());
    await page.screenshot({ path: path.join(outputDir, 'soniox-after-reload.png'), fullPage: true });
    check('Soniox chọn/lưu/reload, test không mic chờ finished, PCM im lặng, chữ tạm/final, pause đóng stream, resume token mới với một mic, kết thúc lưu chữ và audio qua reload (fixture)');
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
