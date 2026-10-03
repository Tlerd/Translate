/* Real browser media/worker/storage; OAuth, cloud transport and paid AI are fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
function loadPlaywright() {
  for (const candidate of [process.env.PLAYWRIGHT_MODULE_PATH, 'playwright', path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean)) {
    try { return require(candidate); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Install Playwright or set PLAYWRIGHT_MODULE_PATH.');
}
const { chromium } = loadPlaywright();
const baseUrl = process.env.BASE_URL || 'http://localhost:3100';
const output = path.resolve('test-results/ui');
fs.mkdirSync(output, { recursive: true });
async function rows(page, table) {
  return page.evaluate(table => new Promise((resolve, reject) => {
    const open = indexedDB.open('may_dich_offline_db');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction(table, 'readonly'), read = tx.objectStore(table).getAll();
      read.onsuccess = () => resolve(read.result.map(row => row.blob ? { ...row, blob: { size: row.blob.size, type: row.blob.type } } : row));
      read.onerror = () => reject(read.error);
      tx.oncomplete = () => db.close();
    };
  }), table);
}
async function waitUntil(fn, message, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(message);
}
async function run() {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const { encode } = await import('next-auth/jwt');
  const name = new URL(baseUrl).protocol === 'https:' ? '__Secure-authjs.session-token' : 'authjs.session-token';
  if (!process.env.BROWSER_TEST_AUTH_SECRET) throw new Error('Use check-fixture.cjs ui with the local fixture server.');
  await context.addCookies([{ name, value: await encode({ secret: process.env.BROWSER_TEST_AUTH_SECRET, salt: name, token: { email: process.env.BROWSER_TEST_OWNER_EMAIL }, maxAge: 3600 }), url: baseUrl, httpOnly: true, sameSite: 'Lax', secure: new URL(baseUrl).protocol === 'https:' }]);
  await context.addInitScript(() => {
    window.__mediaStarts = 0; window.__micAcquisitions = 0;
    const NativeRecorder = window.MediaRecorder;
    window.MediaRecorder = class extends NativeRecorder {
      start(...args) { window.__mediaStarts++; window.__mediaStartedAt = performance.now(); return super.start(...args); }
    };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      window.__micAcquisitions++;
      const audio = new AudioContext(), oscillator = audio.createOscillator(), gain = audio.createGain(), destination = audio.createMediaStreamDestination();
      oscillator.frequency.value = 300; gain.gain.value = .12;
      oscillator.connect(gain).connect(destination); oscillator.start(); await audio.resume();
      window.__tone = { audio, oscillator };
      return destination.stream;
    } });
  });
  const cloud = new Map(), hints = [], errors = [], checks = [];
  const check = name => { checks.push(name); console.log(`PASS ${name}`); };
  await context.route('**/api/recordings/sync*', async route => {
    const request = route.request(), url = new URL(request.url());
    let body, status = 200;
    if (request.method() === 'PUT') {
      const candidate = request.postDataJSON(), previous = cloud.get(candidate.id);
      if ((previous?.version ?? 0) !== candidate.expectedVersion) { status = 409; body = { error: 'Conflict' }; }
      else { const row = { id: candidate.id, version: candidate.expectedVersion + 1, payload: candidate.payload }; cloud.set(row.id, row); body = { row }; }
    } else if (url.searchParams.has('id')) body = { row: cloud.get(url.searchParams.get('id')) ?? null };
    else body = { items: [...cloud.values()].map(({ id, version }) => ({ id, version })), nextCursor: null };
    await route.fulfill({ status, json: body });
  });
  await context.route('**/api/recordings/audio*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== 'GET') return route.fulfill({ status: 503, json: { error: 'Fixture: audio cloud chưa kết nối' } });
    await route.fulfill({ json: url.searchParams.has('id') ? { audio: null } : { items: [], nextCursor: null } });
  });
  await context.route('**/api/speech/transcribe', async route => {
    const raw = route.request().postDataBuffer().toString('utf8');
    hints.push(raw.match(/name="language"\r\n\r\n([^\r]+)/)?.[1]);
    await route.fulfill({ json: { text: '', turns: [], model: 'gemini-3.5-transcribe' } });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${baseUrl}/app`);
    const input = page.getByRole('combobox', { name: 'Ngôn ngữ đầu vào', exact: true });
    const outputLanguage = page.getByRole('combobox', { name: 'Ngôn ngữ đầu ra', exact: true });
    await input.waitFor();
    assert.equal(await input.inputValue(), 'ja-JP'); assert.equal(await outputLanguage.inputValue(), 'vi');
    assert.equal(await input.locator('option').count(), 83);
    assert.equal(await page.locator('input[type=file]').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Mở danh sách bản ghi' }).isVisible(), false);
    check('Mặc định Nhật → Việt; 83 mã đầu vào; bỏ upload và ẩn menu desktop');
    await input.selectOption('es-419'); await outputLanguage.selectOption('vi-VN');
    await waitUntil(async () => (await rows(page, 'settings')).some(row => row.key === 'sourceLanguage' && row.value === 'es-419'), 'Language preferences saved');
    await page.reload();
    await waitUntil(async () => await input.inputValue() === 'es-419' && await outputLanguage.inputValue() === 'vi-VN', 'Language preferences restored');
    await page.getByRole('button', { name: 'Tìm ngôn ngữ đầu vào', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Từ khóa ngôn ngữ đầu vào' }).fill('quang dong');
    assert.equal(await input.locator('option[value="yue-Hant-HK"]').count(), 1);
    await input.selectOption('yue-Hant-HK');
    await page.getByRole('button', { name: 'Đổi chiều ngôn ngữ' }).click();
    assert.equal(await input.inputValue(), 'vi-VN'); assert.equal(await outputLanguage.inputValue(), 'yue-Hant-HK');
    await page.getByRole('button', { name: 'Đổi chiều ngôn ngữ' }).click();
    assert.equal(await input.inputValue(), 'yue-Hant-HK');
    await outputLanguage.selectOption('es-419');
    check('Tìm bằng tiếng Việt không dấu, đổi chiều, lưu/reload mã script và vùng số');
    await page.screenshot({ path: path.join(output, 'desktop.png') });
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).click();
    await page.getByRole('button', { name: 'Dừng API', exact: true }).waitFor();
    assert.equal(await input.isDisabled(), true); assert.equal(await outputLanguage.isDisabled(), true);
    await page.waitForTimeout(650);
    for (let index = 0; index < 3; index++) {
      await page.getByRole('button', { name: 'Dừng API', exact: true }).click();
      await page.getByRole('button', { name: 'Tiếp tục', exact: true }).waitFor();
      const sent = hints.length;
      await page.evaluate(index => { window.__tone.oscillator.frequency.value = 500 + index * 100; }, index);
      await page.waitForTimeout(650);
      assert.equal(hints.length, sent, 'Paused API does not send new audio');
      await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
      await page.getByRole('button', { name: 'Dừng API', exact: true }).waitFor();
      await page.waitForTimeout(650);
    }
    await page.getByRole('link', { name: 'Cấu hình AI', exact: true }).first().click();
    await page.waitForURL('**/settings');
    await page.getByRole('link', { name: 'Máy Dịch Lớp Học', exact: true }).click();
    await page.waitForURL('**/app');
    await page.getByRole('button', { name: 'Dừng API', exact: true }).click();
    await page.getByRole('button', { name: 'Tiếp tục', exact: true }).waitFor();
    await page.waitForTimeout(500);
    const elapsedMs = await page.evaluate(() => performance.now() - window.__mediaStartedAt);
    await page.getByRole('button', { name: 'Kết thúc buổi', exact: true }).click();
    await page.getByRole('button', { name: 'Kết thúc và lưu', exact: true }).click();
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__mediaStarts), 1);
    assert.equal(await page.evaluate(() => window.__micAcquisitions), 1);
    assert(hints.length >= 3); assert(hints.every(code => code === 'yue-Hant-HK'));
    await waitUntil(async () => (await rows(page, 'audioAssets')).some(row => row.blob && row.file?.durationMs > 0), 'Actual worker normalizes encoded audio');
    const asset = (await rows(page, 'audioAssets')).find(row => row.file), recording = (await rows(page, 'recordings')).find(row => row.id === asset.recordingId);
    assert.equal(recording.sourceLanguage, 'yue-Hant-HK'); assert.equal(recording.targetLanguage, 'es-419');
    assert(Math.abs(asset.file.durationMs - elapsedMs) < 900, `Whole-session audio includes all API pauses: ${asset.file.durationMs} / ${elapsedMs}`);
    assert((await rows(page, 'audioChunks')).length > 0, 'Original chunks retained');
    assert((await rows(page, 'audioJobs')).some(job => job.recordingId === recording.id), 'Persistent upload queue survives cloud failure');
    check('Một MediaRecorder/micro qua 3 lần nghỉ API và chuyển trang; kết thúc lúc nghỉ vẫn đủ audio, giữ bản gốc và hàng đợi');
    await page.getByRole('button', { name: 'Ghi âm', exact: true }).click();
    const audio = page.locator('audio[controls]'); await audio.waitFor();
    await waitUntil(async () => audio.evaluate(element => Number.isFinite(element.duration) && element.duration > 0), 'Finite HTML audio duration');
    assert.equal(await audio.count(), 1);
    const playback = await audio.evaluate(async element => {
      const duration = element.duration, samples = [];
      for (const fraction of [.05, .5, .85]) {
        element.currentTime = duration * fraction;
        await new Promise(resolve => element.addEventListener('seeked', resolve, { once: true }));
        const before = element.currentTime; await element.play();
        await new Promise(resolve => setTimeout(resolve, 140)); element.pause();
        samples.push({ fraction, before, after: element.currentTime });
      }
      return { duration, samples };
    });
    assert(Math.abs(playback.duration * 1000 - asset.file.durationMs) < 20);
    assert(playback.samples.every(sample => sample.after > sample.before));
    const downloadWait = page.waitForEvent('download'); await page.getByRole('link', { name: 'Tải toàn buổi' }).click();
    const download = await downloadWait, downloadPath = path.join(output, download.suggestedFilename());
    await download.saveAs(downloadPath); assert.equal(fs.statSync(downloadPath).size, asset.file.sizeBytes);
    await page.screenshot({ path: path.join(output, 'whole-audio.png') });
    await page.getByRole('button', { name: 'Đóng ghi âm', exact: true }).click();
    check('Một trình phát, thời lượng file hữu hạn, tua đầu/giữa/cuối và tải file toàn buổi đúng dung lượng');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Mở danh sách bản ghi', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Đóng danh sách bản ghi', exact: true }).getAttribute('aria-expanded'), 'true');
    await page.locator('[aria-label="Đóng thanh bên"]').click({ position: { x: 375, y: 300 } });
    await page.getByRole('button', { name: 'Mở danh sách bản ghi', exact: true }).waitFor();
    await waitUntil(() => page.locator('#recording-library').evaluate(element => element.getBoundingClientRect().right <= 1), 'Drawer closes fully after outside click');
    await page.getByRole('button', { name: 'Mở danh sách bản ghi', exact: true }).click();
    await page.locator(`#recording-library a[href="/recordings/${recording.id}"]`).click();
    await page.waitForURL(`**/recordings/${recording.id}`);
    await page.getByRole('button', { name: 'Mở danh sách bản ghi', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Mở danh sách bản ghi', exact: true }).getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('[aria-label="Đóng thanh bên"]').count(), 0);
    await waitUntil(() => page.locator('#recording-library').evaluate(element => element.getBoundingClientRect().right <= 1), 'Drawer closes fully after selection');
    await page.screenshot({ path: path.join(output, 'mobile.png') });
    check('Menu điện thoại mở/đóng, đóng khi bấm ra ngoài và chọn bản ghi');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${baseUrl}/settings`);
    await page.locator('#speech-provider').selectOption('google-flash-live');
    await page.getByRole('button', { name: 'Lưu cài đặt', exact: true }).click();
    await page.getByRole('link', { name: 'Về phòng học', exact: true }).click();
    await waitUntil(async () => await input.inputValue() === 'ja' && await outputLanguage.inputValue() === 'es-419', 'Provider switches to supported input without losing saved output');
    assert.equal(await input.locator('option').count(), 100);
    await page.reload();
    await waitUntil(async () => await input.inputValue() === 'ja' && await outputLanguage.inputValue() === 'es-419', 'Model-specific language pair restored');
    check('Flash Live hiện đủ 100 mã; đổi model giữ đầu ra và chọn đầu vào được hỗ trợ qua reload');
    assert.deepEqual(errors, []); check('Không có lỗi JavaScript chưa xử lý');
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ checks, elapsedMs, file: asset.file, playback, languageHints: hints, cloud: 'transport fixtures', media: 'real Chrome MediaRecorder, worker and IndexedDB', physicalIPhone: false }, null, 2));
  } catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }); throw error; }
  finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
