import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createNemotronGateway } from './nemotron-gateway.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
try { process.loadEnvFile('.env.local'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
let installation = {};
try { installation = JSON.parse((await readFile('.cache/nemotron/installation.json', 'utf8')).replace(/^\uFEFF/, '')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const executable = process.env.NEMOTRON_EXECUTABLE || installation.executable;
const model = process.env.NEMOTRON_MODEL_PATH || installation.model;
if (!executable || !model) throw new Error('Run npm run speech:nemotron:setup first, or set NEMOTRON_EXECUTABLE and NEMOTRON_MODEL_PATH.');
const backendUrl = new URL(process.env.NEMOTRON_BASE_URL ?? 'http://127.0.0.1:8080');
if (!['127.0.0.1', 'localhost'].includes(backendUrl.hostname)) throw new Error('The local launcher requires a loopback backend. Run the gateway separately for a remote backend.');
const gateway = createNemotronGateway({ secret: process.env.NEMOTRON_GATEWAY_SECRET ?? '', backendUrl: backendUrl.toString(), apiKey: process.env.NEMOTRON_API_KEY });
const runtimeEnv = { ...process.env };
for (const name of Object.keys(runtimeEnv)) {
  if (/^(AUTH_|OWNER_EMAIL$|NEMOTRON_|DATABASE_|POSTGRES_|REDIS_)|(?:API_KEY|TOKEN|SECRET)$/.test(name)) delete runtimeEnv[name];
}
runtimeEnv.NEMO_SPEECH_HTTP_API_KEY = process.env.NEMOTRON_API_KEY ?? '';
const runtime = spawn(executable, ['serve', '--asr-model', model, '--host', '127.0.0.1', '--port', backendUrl.port || '8080', '--threads', '6', '--read-timeout', '900'], {
  stdio: 'inherit', windowsHide: true,
  env: runtimeEnv,
});
const stop = () => { gateway.close(); runtime.kill(); };
runtime.on('error', (error) => { console.error(error.message); stop(); process.exitCode = 1; });
runtime.on('exit', (code) => { gateway.close(); process.exitCode = code ?? 0; });
gateway.server.on('error', (error) => { console.error(error.message); stop(); process.exitCode = 1; });
const gatewayPort = Number(process.env.NEMOTRON_GATEWAY_PORT ?? 8081);
gateway.server.listen(gatewayPort, '127.0.0.1', () => console.log(`Nemotron gateway listening at 127.0.0.1:${gatewayPort}. Waiting for model readiness…`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
