import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const OPENROUTER_API = 'https://openrouter.ai/api/v1';
const DEFAULT_GENERATION_MODEL = process.env.OPENROUTER_GENERATION_MODEL || 'x-ai/grok-4.1-fast';
const DEFAULT_EXTRACT_MODEL = process.env.OPENROUTER_EXTRACT_MODEL || 'openai/gpt-oss-20b';
const API_KEY_FILE = process.env.OPENROUTER_API_KEY_FILE?.trim();

const promptPath = process.argv[2];
if (!promptPath) {
  console.error('Usage: node run-html-test.mjs <prompt.md> [output-dir]');
  process.exit(1);
}

const apiKey = await readApiKey();
const prompt = await readFile(resolve(promptPath), 'utf8');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const slug = basename(promptPath).replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
const outDir = resolve(process.argv[3] || join('runs', `${stamp}-${slug}`));
await mkdir(outDir, { recursive: true });

const modelIds = await fetchModelIds(apiKey);
const generationModel = resolveModel(modelIds, DEFAULT_GENERATION_MODEL, [
  'x-ai/grok-4.3',
  'x-ai/grok-4.20',
  'openai/gpt-oss-120b'
], 'generation');
const extractModel = resolveModel(modelIds, DEFAULT_EXTRACT_MODEL, [
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b'
], 'extraction');

console.log(`Generating with ${generationModel}`);
const raw = await chat({
  apiKey,
  model: generationModel,
  messages: [
    {
      role: 'system',
      content: [
        'You generate complete, polished, production-quality single-file HTML artifacts.',
        'Respect the user prompt exactly. Include HTML, CSS, and JavaScript in one document.',
        'Do not include explanations outside the artifact unless you absolutely cannot comply.'
      ].join(' ')
    },
    { role: 'user', content: prompt }
  ],
  temperature: 0.9,
  max_tokens: 20000
});

const rawText = raw.choices?.[0]?.message?.content || '';
await writeFile(join(outDir, 'raw-response.txt'), rawText);

console.log(`Extracting HTML with ${extractModel}`);
let html = '';
try {
  html = await extractViaModel({ apiKey, model: extractModel, rawText });
} catch (error) {
  console.warn(`Model extraction failed: ${error.message}`);
}

if (!looksLikeHtml(html)) {
  html = deterministicExtract(rawText);
}

if (!looksLikeHtml(html)) {
  await writeFile(join(outDir, 'extract-failed.txt'), html || '(empty)');
  throw new Error(`Could not extract a plausible HTML document. Raw response saved in ${outDir}`);
}

const indexPath = join(outDir, 'index.html');
await writeFile(indexPath, html);

const metadata = {
  createdAt: new Date().toISOString(),
  promptPath: resolve(promptPath),
  generationModel,
  extractModel,
  rawResponsePath: join(outDir, 'raw-response.txt'),
  htmlPath: indexPath
};
await writeFile(join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

const render = spawnSync(process.execPath, [resolve('render-smoke.mjs'), indexPath], {
  cwd: resolve('.'),
  stdio: 'inherit',
  env: process.env
});
if (render.status !== 0) process.exit(render.status ?? 1);

console.log(`HTML ready: ${indexPath}`);

async function readApiKey() {
  const candidates = [];
  if (process.env.OPENROUTER_API_KEY) candidates.push(['OPENROUTER_API_KEY', process.env.OPENROUTER_API_KEY.trim()]);
  if (API_KEY_FILE && existsSync(API_KEY_FILE)) {
    candidates.push(['OPENROUTER_API_KEY_FILE', (await readFile(API_KEY_FILE, 'utf8')).trim()]);
  }
  if (!candidates.length) throw new Error('Missing OPENROUTER_API_KEY or OPENROUTER_API_KEY_FILE');

  const failures = [];
  for (const [source, key] of candidates) {
    if (!key) continue;
    const valid = await canUseKeyForChat(key);
    if (valid.ok) {
      if (source !== 'OPENROUTER_API_KEY') {
        console.warn(`OPENROUTER_API_KEY was unavailable or unusable; using ${source}.`);
      }
      return key;
    }
    failures.push(`${source}: ${valid.status} ${valid.message}`);
  }
  throw new Error(`No usable OpenRouter API key found. ${failures.join(' | ')}`);
}

async function canUseKeyForChat(apiKey) {
  try {
    const res = await fetch(`${OPENROUTER_API}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 8
      })
    });
    if (res.ok) return { ok: true, status: res.status, message: 'ok' };
    const text = await res.text();
    return { ok: false, status: res.status, message: text.slice(0, 160) };
  } catch (error) {
    return { ok: false, status: 'network', message: error.message };
  }
}

async function fetchModelIds(apiKey) {
  const res = await fetch(`${OPENROUTER_API}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!res.ok) throw new Error(`OpenRouter model list failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return new Set((json.data || []).map((item) => item.id));
}

function resolveModel(modelIds, preferred, fallbacks, label) {
  if (modelIds.has(preferred)) return preferred;
  const fallback = fallbacks.find((id) => modelIds.has(id));
  if (fallback) {
    console.warn(`Configured ${label} model is not live on OpenRouter: ${preferred}`);
    console.warn(`Using ${fallback} instead.`);
    return fallback;
  }
  const close = [...modelIds].filter((id) => id.includes(preferred.split('/').at(-1))).slice(0, 8);
  throw new Error(`Configured ${label} model is not in live OpenRouter model list: ${preferred}${close.length ? `\nClose matches: ${close.join(', ')}` : ''}`);
}

async function chat({ apiKey, model, messages, temperature = 0.2, max_tokens }) {
  const res = await fetch(`${OPENROUTER_API}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens })
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(`OpenRouter chat failed: 401 unauthorized. Check OPENROUTER_API_KEY or OPENROUTER_API_KEY_FILE. Response: ${text}`);
    }
    throw new Error(`OpenRouter chat failed: ${res.status} ${text}`);
  }
  return JSON.parse(text);
}

async function extractViaModel({ apiKey, model, rawText }) {
  const result = await chat({
    apiKey,
    model,
    messages: [
      {
        role: 'system',
        content: [
          'Extract exactly one complete self-contained HTML document from the user message.',
          'The message may contain commentary, malformed markdown fences, or text before and after.',
          'Return only the HTML document, starting with <!doctype html> or <html and ending with </html>.',
          'Do not summarize, wrap in markdown, or add any explanation.'
        ].join(' ')
      },
      { role: 'user', content: rawText }
    ],
    temperature: 0,
    max_tokens: 20000
  });
  return cleanHtml(result.choices?.[0]?.message?.content || '');
}

function deterministicExtract(text) {
  const fenced = [...text.matchAll(/```(?:html)?\s*([\s\S]*?)```/gi)]
    .map((match) => match[1])
    .find(looksLikeHtml);
  if (fenced) return cleanHtml(fenced);

  const startCandidates = ['<!doctype html', '<html'];
  const lower = text.toLowerCase();
  const starts = startCandidates.map((needle) => lower.indexOf(needle)).filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const end = lower.lastIndexOf('</html>');
  if (start >= 0 && end >= start) return cleanHtml(text.slice(start, end + '</html>'.length));
  return cleanHtml(text);
}

function cleanHtml(text) {
  return text
    .replace(/^\s*```(?:html)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function looksLikeHtml(text) {
  const trimmed = cleanHtml(text || '').toLowerCase();
  return (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')) &&
    trimmed.includes('<head') &&
    trimmed.includes('<body') &&
    trimmed.includes('</html>');
}
