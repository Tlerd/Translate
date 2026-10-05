// Opt-in offline/provider comparison. No network calls in the default mode.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=')];
}));
const mode = args.mode ?? 'offline';
if (!['offline', 'count', 'quality'].includes(mode)) throw new Error('mode must be offline, count or quality');
const limit = Number(args.limit ?? (mode === 'quality' ? 48 : 3));
const maxRequests = Number(args['max-requests'] ?? 300);
const maxUsd = Number(args['max-usd'] ?? 0.10);
const timeoutMs = Number(args['timeout-ms'] ?? 30000);
const historyLimits = (args.history ?? (mode === 'quality' ? '2' : '0,2,6')).split(',').map(Number);
if (!historyLimits.every((n) => Number.isInteger(n) && n >= 0 && n <= 6)) throw new Error('Invalid history limits');
if (![limit, maxRequests, timeoutMs].every((n) => Number.isInteger(n) && n > 0) || !Number.isFinite(maxUsd) || maxUsd <= 0) {
  throw new Error('Invalid limit, request cap, timeout or budget');
}

// Load the actual pure builders, compiling TS in memory; never duplicate the prompt.
async function loadPure(source) {
  const code = ts.transpileModule(source.replace(/import ['"]server-only['"];?/, ''), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const currentSource = await readFile(path.join(root, 'src/server/ai/prompts/translation.ts'), 'utf8');
const variants = await Promise.all([
  ['original-json', 'd16d22f^', await readFile(path.join(root, 'tests/fixtures/translation-prompt-original.txt'), 'utf8')],
  ['lean-v1', '9690936', await readFile(path.join(root, 'tests/fixtures/translation-prompt-lean-v1.txt'), 'utf8')],
  ['lean-fidelity-v5', 'working-tree', currentSource],
].map(async ([name, ref, source]) => ({ name, ref, sha256: createHash('sha256').update(source).digest('hex'), builder: await loadPure(source) })));
const registry = await loadPure(await readFile(path.join(root, 'src/config/ai-models.ts'), 'utf8'));
const modelId = args.model ?? 'gemini-3.1-flash-lite';
const model = registry.getModelConfig(`google:${modelId}`);
if (!model || !model.allowedTasks.includes('translate') || !model.enabled) throw new Error('Unsupported translation model');
const fixture = JSON.parse(await readFile(path.join(root, 'tests/fixtures/translation-quality.json'), 'utf8'));
const cases = fixture.groups.flatMap((group) => group.cases.map(([source, criteria, history = []], i) => ({
  id: `${group.category}-${i + 1}`, sourceLanguage: group.sourceLanguage, targetLanguage: group.targetLanguage,
  source, criteria, history: history.map(([source, translation]) => ({ source, translation })),
}))).slice(0, limit);
const seedHistory = [
  { source: '今日は日本語の授業です。', translation: 'Hôm nay là giờ học tiếng Nhật.' },
  { source: '次の例を確認します。', translation: 'Chúng ta xem ví dụ tiếp theo.' },
  { source: '分からない時は質問してください。', translation: 'Khi chưa hiểu, hãy hỏi.' },
  { source: 'まず音声を聞きます。', translation: 'Trước tiên nghe âm thanh.' },
  { source: '先生に連絡しました。', translation: 'Tôi đã liên lạc với giáo viên.' },
  { source: '明日の授業について話しています。', translation: 'Chúng ta đang nói về giờ học ngày mai.' },
];
const rows = [];
let calls = 0;
let estimatedSpent = 0;
let unknownCost = false;
let stopReason = null;
let client;
let minimalThinking;
function reserveRequest() {
  if (calls >= maxRequests) throw new Error('Request cap reached');
  calls++;
}
const output = path.resolve(root, args.output ?? '../audit/20261005-translation-evaluation.json');
async function save() {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ mode, model: modelId, thinkingLevel: 'minimal',
    generatedAt: new Date().toISOString(), pricingAsOf: model.pricingAsOf,
    pricingSource: 'https://ai.google.dev/gemini-api/docs/pricing', reviewStatus: fixture.reviewStatus,
    limits: { limit, historyLimits, maxRequests, maxUsd }, providerCalls: calls, estimatedSpent, unknownCost, stopReason,
    variants: variants.map(({ name, ref, sha256 }) => ({ name, ref, sha256 })), rows }, null, 2));
}

try {
  if (mode !== 'offline') {
    const nextEnv = await import('@next/env');
    (nextEnv.loadEnvConfig ?? nextEnv.default.loadEnvConfig)(root);
    if (!process.env.GOOGLE_API_KEY) { stopReason = 'missing GOOGLE_API_KEY; zero provider calls'; throw new Error('Missing configuration'); }
    const { GoogleGenAI, ThinkingLevel } = await import('@google/genai');
    minimalThinking = ThinkingLevel.MINIMAL;
    client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
  }
  for (const example of cases) {
    for (const historyLimit of historyLimits) {
      // Same pair ordering in all variants. Reverse for Vietnamese -> Japanese.
      const seed = example.sourceLanguage === 'ja' ? seedHistory : seedHistory.map((pair) => ({ source: pair.translation, translation: pair.source }));
      const allHistory = [...seed, ...example.history];
      const history = historyLimit === 0 ? [] : allHistory.slice(-historyLimit);
      for (const variant of variants) {
        const system = variant.builder.buildTranslationSystemPrompt(example.sourceLanguage, example.targetLanguage);
        const { payload, historyTurns } = variant.builder.buildTranslationPayloadWithStats({ sourceLanguage: example.sourceLanguage,
          targetLanguage: example.targetLanguage, currentUtterance: example.source, previousTurns: history });
        const row = { caseId: example.id, variant: variant.name, historyLimit, historyTurns,
          source: example.source, criteria: example.criteria, systemChars: system.length, payloadChars: payload.length,
          countTokens: null, usage: null, translation: null, status: 'offline', durationMs: null, estimatedUsd: null,
          humanVerdict: 'pending', humanNotes: '' };
        rows.push(row);
        if (mode === 'offline') continue;
        reserveRequest();
        const count = await client.models.countTokens({ model: modelId, contents: payload,
          config: { systemInstruction: system, abortSignal: AbortSignal.timeout(timeoutMs) } });
        row.countTokens = count.totalTokens ?? null;
        row.status = 'counted';
        if (mode !== 'quality') continue;
        // One comparison per history configuration; includes thinking in cap.
        const maxOutputTokens = 256;
        if (row.countTokens === null || unknownCost) throw new Error('Unknown input/cost; stop paid generation');
        const reserve = ((row.countTokens + 1024) * model.inputUsdPerM + maxOutputTokens * model.outputUsdPerM) / 1e6;
        if (estimatedSpent + reserve > maxUsd) throw new Error('Estimated generation budget reached');
        reserveRequest();
        const started = Date.now();
        row.status = 'started';
        const response = await client.models.generateContent({ model: modelId, contents: payload,
          config: { systemInstruction: system, thinkingConfig: { thinkingLevel: minimalThinking }, maxOutputTokens,
            abortSignal: AbortSignal.timeout(timeoutMs) } });
        row.durationMs = Date.now() - started;
        row.usage = response.usageMetadata ?? null;
        row.translation = response.text ?? null;
        row.finishReason = response.candidates?.[0]?.finishReason ?? null;
        row.status = 'completed';
        const u = row.usage;
        if (u?.promptTokenCount == null || u.candidatesTokenCount == null) {
          unknownCost = true;
        } else {
          const cache = Math.min(u.promptTokenCount, u.cachedContentTokenCount ?? 0);
          row.estimatedUsd = ((u.promptTokenCount - cache) * model.inputUsdPerM + cache * model.cachedInputUsdPerM +
            (u.candidatesTokenCount + (u.thoughtsTokenCount ?? 0)) * model.outputUsdPerM) / 1e6;
          estimatedSpent += row.estimatedUsd;
        }
        console.log(`${example.id} N=${historyLimit} ${variant.name}: ${row.status}`);
        await save();
      }
    }
  }
} catch (error) {
  const row = rows.at(-1);
  if (row?.status === 'started') { row.status = 'failed-or-aborted'; unknownCost = true; }
  else if (row && row.status !== 'completed') row.status = 'stopped';
  stopReason ??= typeof error?.status === 'number' ? `provider HTTP ${error.status}` : 'request cap, budget, timeout or provider failure; no retry';
  // Do not dump provider errors, which can contain request details or credentials.
  console.error(`Evaluation stopped (${error?.name ?? 'Error'}); inspect saved status. No automatic retry.`);
  process.exitCode = 1;
} finally {
  await save();
  console.log(`Saved ${rows.length} rows, ${calls} provider calls to ${output}`);
}
