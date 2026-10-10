const { spawn } = require('node:child_process');
const path = require('node:path');
const tests = { auth: 'auth-smoke.cjs', browser: 'browser-smoke.cjs', ui: 'ui-smoke.cjs' };
const test = tests[process.argv[2]];
if (!test) throw new Error('Choose auth, browser or ui for the local-only fixture server.');
const child = spawn(process.execPath, [path.join(__dirname, test)], { stdio: 'inherit', windowsHide: true,
  env: { ...process.env, BASE_URL: 'http://localhost:3100', BROWSER_TEST_AUTH_SECRET: 'fixture-auth-secret-over-thirty-two-characters', BROWSER_TEST_OWNER_EMAIL: 'owner@example.com' } });
child.on('exit', code => { process.exitCode = code ?? 1; });
