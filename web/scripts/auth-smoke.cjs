/* Local-only authentication regression: signed fixtures, no Google credentials. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
function loadPlaywright() {
  for (const candidate of [process.env.PLAYWRIGHT_MODULE_PATH, 'playwright', path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean)) {
    try { return require(candidate); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
  throw new Error('Install Playwright: npm install --save-dev playwright; npx playwright install chromium');
}
const { chromium } = loadPlaywright();
const base = process.env.BASE_URL || 'http://localhost:3100';
const secret = process.env.BROWSER_TEST_AUTH_SECRET;
const owner = process.env.BROWSER_TEST_OWNER_EMAIL;
if (!secret || !owner) throw new Error('Set fixture BROWSER_TEST_AUTH_SECRET and BROWSER_TEST_OWNER_EMAIL to match the local test server.');
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Auth fixtures are for a local server only.');
const out = path.resolve('test-results/auth');
fs.mkdirSync(out, { recursive: true });
function executablePath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  try {
    if (fs.existsSync(chromium.executablePath())) return chromium.executablePath();
  } catch {}
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
async function run() {
  const { encode } = await import('next-auth/jwt');
  const browser = await chromium.launch({ headless: true, executablePath: executablePath() });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base);
    await page.getByRole('heading', { name: 'Nghe trọn câu. Hiểu rõ ý.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).count(), 0);
    await page.screenshot({ path: path.join(out, 'landing-desktop.png'), fullPage: true });
    for (const route of ['/app', '/settings', '/recordings/fixture']) {
      await page.goto(base + route);
      await page.waitForURL('**/login');
      await page.getByRole('button', { name: 'Tiếp tục với Google' }).waitFor();
    }
    console.log('PASS public landing and anonymous protected routes');
    const cookie = 'authjs.session-token';
    for (const [label, value] of [
      ['forged', 'arbitrary-cookie'],
      ['wrong-owner', await encode({ secret, salt: cookie, token: { email: 'other@example.com' }, maxAge: 3600 })],
      ['expired', await encode({ secret, salt: cookie, token: { email: owner }, maxAge: -3600 })],
    ]) {
      await ctx.clearCookies();
      await ctx.addCookies([{ name: cookie, value, url: base, httpOnly: true, sameSite: 'Lax' }]);
      await page.goto(base + '/app');
      await page.waitForURL('**/login');
      console.log(`PASS rejects ${label} session`);
    }
    await ctx.clearCookies();
    await ctx.addCookies([{ name: cookie, value: await encode({ secret, salt: cookie, token: { email: owner, sub: 'owner-fixture' }, maxAge: 3600 }), url: base, httpOnly: true, sameSite: 'Lax' }]);
    await page.goto(base + '/login');
    await page.waitForURL('**/app');
    await page.getByRole('button', { name: 'Bắt đầu thu', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    await page.waitForURL(base + '/');
    await page.goto(base + '/app');
    await page.waitForURL('**/login');
    console.log('PASS owner access, login redirect and sign-out revokes access');
    await page.goto(base + '/login?error=AccessDenied');
    await page.getByRole('alert').filter({ hasText: 'chưa được cấp quyền' }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, 'login-mobile.png'), fullPage: true });
    await page.goto(base);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile landing must not overflow');
    await page.screenshot({ path: path.join(out, 'landing-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS readable access error, responsive landing and no page errors');
  } finally { await browser.close(); }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
