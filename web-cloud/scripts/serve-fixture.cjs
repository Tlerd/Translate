/* Local-only production browser test server. No real OAuth, AI or cloud keys. */
const { spawn } = require('node:child_process');
const path = require('node:path');
const environment = { ...process.env };
// Empty values prevent Next.js from reloading real credentials from .env.local.
for (const name of ['SONIOX_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'SUMMARY_GOOGLE_API_KEY', 'SUMMARY_OPENAI_API_KEY', 'IMAGE_GOOGLE_API_KEY', 'IMAGE_OPENAI_API_KEY', 'DATABASE_URL', 'POSTGRES_URL', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'REDIS_URL']) environment[name] = '';
Object.assign(environment, { NODE_ENV: 'production', AUTH_SECRET: 'fixture-auth-secret-over-thirty-two-characters', OWNER_EMAIL: 'owner@example.com',
  AUTH_URL: 'http://localhost:3100', AUTH_GOOGLE_ID: 'fixture-client-id', AUTH_GOOGLE_SECRET: 'fixture-client-secret' });
const child = spawn(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), 'start', '-p', '3100', '-H', '127.0.0.1'], { stdio: 'inherit', env: environment, windowsHide: true });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
