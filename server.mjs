import express from 'express';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const OPENROUTER_API = 'https://openrouter.ai/api/v1';
const DEFAULT_GENERATION_MODEL = process.env.OPENROUTER_GENERATION_MODEL || 'x-ai/grok-4.1-fast';
const DEFAULT_EXTRACT_MODEL = process.env.OPENROUTER_EXTRACT_MODEL || 'openai/gpt-oss-20b';
const API_KEY_FILE = process.env.OPENROUTER_API_KEY_FILE?.trim();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve frontend assets
app.use(express.static('public'));

// Serve runs folder static files (e.g. index.html, screenshots)
app.use('/runs', express.static('runs'));

// ------------------------------------------------------------------------
// Key Verification & Helper Utilities
// ------------------------------------------------------------------------

async function readApiKey(passedKey) {
  const candidates = [];
  if (passedKey && passedKey.trim()) {
    candidates.push(['Browser Settings Key', passedKey.trim()]);
  }
  if (process.env.OPENROUTER_API_KEY) {
    candidates.push(['Server Environment Key (OPENROUTER_API_KEY)', process.env.OPENROUTER_API_KEY.trim()]);
  }
  if (API_KEY_FILE && existsSync(API_KEY_FILE)) {
    try {
      const fileKey = (await readFile(API_KEY_FILE, 'utf8')).trim();
      if (fileKey) {
        candidates.push(['Server Key File (OPENROUTER_API_KEY_FILE)', fileKey]);
      }
    } catch (e) {
      // Ignore reading error
    }
  }

  if (!candidates.length) {
    throw new Error('Missing OpenRouter API key. Paste one into the settings panel, set OPENROUTER_API_KEY, or point OPENROUTER_API_KEY_FILE at a text file with the key.');
  }

  const failures = [];
  for (const [source, key] of candidates) {
    if (!key) continue;
    const valid = await canUseKeyForChat(key);
    if (valid.ok) {
      return { key, source };
    }
    failures.push(`${source}: ${valid.status} ${valid.message}`);
  }
  throw new Error(`No usable OpenRouter API key found. Checked:\n- ${failures.join('\n- ')}`);
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
  return (json.data || []).map((item) => ({
    id: item.id,
    name: item.name || item.id,
    context_length: item.context_length
  }));
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
      throw new Error(`OpenRouter chat failed: 401 unauthorized. Check API Key. Response: ${text}`);
    }
    throw new Error(`OpenRouter chat failed: ${res.status} ${text}`);
  }
  return JSON.parse(text);
}

// ------------------------------------------------------------------------
// HTML Extraction Logic
// ------------------------------------------------------------------------

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

// ------------------------------------------------------------------------
// API Routes
// ------------------------------------------------------------------------

// Fetch live models from OpenRouter (proxied to avoid client CORS)
app.get('/api/models', async (req, res) => {
  try {
    const passedKey = req.query.key;
    const { key, source } = await readApiKey(passedKey);
    const models = await fetchModelIds(key);
    res.json({ success: true, models, keySource: source });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Load the default starter prompt prompts/llm-landing.md
app.get('/api/prompt-default', async (req, res) => {
  try {
    const promptPath = resolve('prompts/llm-landing.md');
    const content = await readFile(promptPath, 'utf8');
    res.json({ success: true, prompt: content });
  } catch (error) {
    res.status(500).json({ success: false, error: `Could not load default prompt: ${error.message}` });
  }
});

// Scan runs/ and return all historical runs
app.get('/api/runs', async (req, res) => {
  try {
    const runsDir = resolve('runs');
    if (!existsSync(runsDir)) {
      return res.json({ success: true, runs: [] });
    }
    const entries = await readdir(runsDir, { withFileTypes: true });
    const runDirs = entries.filter((e) => e.isDirectory());
    const runs = [];

    for (const dir of runDirs) {
      const metadataPath = join(runsDir, dir.name, 'metadata.json');
      let metadata = null;
      if (existsSync(metadataPath)) {
        try {
          metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
        } catch (e) {
          // Keep metadata null
        }
      }
      runs.push({
        runId: dir.name,
        metadata
      });
    }

    // Sort by timestamp in directory name or metadata timestamp (newest first)
    runs.sort((a, b) => {
      const aTime = a.metadata?.createdAt || a.runId;
      const bTime = b.metadata?.createdAt || b.runId;
      return bTime.localeCompare(aTime);
    });

    res.json({ success: true, runs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get a specific run's contents
app.get('/api/runs/:runId', async (req, res) => {
  const { runId } = req.params;
  const runsDir = resolve('runs');
  const runPath = join(runsDir, runId);

  if (!existsSync(runPath)) {
    return res.status(404).json({ success: false, error: 'Run directory not found.' });
  }

  try {
    let metadata = null;
    let rawResponse = '';
    let html = '';
    let smokeJson = null;

    const metadataPath = join(runPath, 'metadata.json');
    if (existsSync(metadataPath)) {
      metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    }

    const rawResponsePath = join(runPath, 'raw-response.txt');
    if (existsSync(rawResponsePath)) {
      rawResponse = await readFile(rawResponsePath, 'utf8');
    }

    const htmlPath = join(runPath, 'index.html');
    if (existsSync(htmlPath)) {
      html = await readFile(htmlPath, 'utf8');
    }

    const smokePath = join(runPath, 'render-smoke.json');
    if (existsSync(smokePath)) {
      smokeJson = JSON.parse(await readFile(smokePath, 'utf8'));
    }

    res.json({
      success: true,
      runId,
      metadata,
      rawResponse,
      html,
      smokeJson,
      screenshotUrl: existsSync(join(runPath, 'render-smoke.png')) ? `/runs/${runId}/render-smoke.png` : null
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Run a complete generation, extraction, writing, and Playwright smoke-checking flow
app.post('/api/run', async (req, res) => {
  // Set headers for Server-Sent Events (SSE) progress streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (stage, message, data = null) => {
    res.write(`data: ${JSON.stringify({ stage, message, data })}\n\n`);
  };

  try {
    const { prompt, promptName, generationModel, extractModel, apiKey } = req.body;

    if (!prompt) {
      throw new Error('Prompt content is required.');
    }

    // Step 1: Validate Key
    sendEvent('validating_key', 'Verifying OpenRouter API key credentials...');
    const { key, source } = await readApiKey(apiKey);
    sendEvent('validating_key_success', `Key verified successfully using source: ${source}`);

    // Create directories
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = (promptName || 'custom').replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const outDir = join('runs', `${stamp}-${slug}`);
    await mkdir(outDir, { recursive: true });

    // Step 2: Generation
    const genModelStr = generationModel || DEFAULT_GENERATION_MODEL;
    sendEvent('generating', `Submitting prompt to OpenRouter model: ${genModelStr}...`);
    
    const raw = await chat({
      apiKey: key,
      model: genModelStr,
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
    if (!rawText) {
      throw new Error('Received empty response from generation model.');
    }

    await writeFile(join(outDir, 'raw-response.txt'), rawText);
    sendEvent('generating_success', 'Generation completed and raw response written to disk.');

    // Step 3: Extraction
    const extModelStr = extractModel || DEFAULT_EXTRACT_MODEL;
    sendEvent('extracting', `Extracting structured HTML code using ${extModelStr}...`);
    
    let html = '';
    let extractedViaModelSuccess = false;
    try {
      html = await extractViaModel({ apiKey: key, model: extModelStr, rawText });
      extractedViaModelSuccess = true;
    } catch (error) {
      // Model extraction failed, fallback deterministic
    }

    if (!looksLikeHtml(html)) {
      html = deterministicExtract(rawText);
      extractedViaModelSuccess = false;
    }

    if (!looksLikeHtml(html)) {
      await writeFile(join(outDir, 'extract-failed.txt'), html || '(empty)');
      throw new Error('Extracted output does not form a plausible, complete HTML document.');
    }

    const indexPath = join(outDir, 'index.html');
    await writeFile(indexPath, html);
    
    const metadata = {
      createdAt: new Date().toISOString(),
      promptPath: promptName ? `prompts/${promptName}` : 'Custom text input',
      generationModel: genModelStr,
      extractModel: extModelStr,
      rawResponsePath: join(outDir, 'raw-response.txt'),
      htmlPath: indexPath,
      extractionMethod: extractedViaModelSuccess ? 'model' : 'deterministic_fallback'
    };
    await writeFile(join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
    sendEvent('extracting_success', 'HTML extracted, cleaned, and written to disk.');

    // Step 4: Playwright Smoke Checking
    sendEvent('rendering', 'Executing local Playwright smoke test and taking screenshot...');
    
    const render = spawnSync('node', ['render-smoke.mjs', indexPath], {
      cwd: resolve('.'),
      env: process.env,
      encoding: 'utf8'
    });

    if (render.status !== 0) {
      const detail = [render.stderr, render.stdout].filter(Boolean).join('\n').trim();
      throw new Error(`Playwright smoke check failed.${detail ? ` ${detail}` : ''}`);
    }

    let smokeJson = null;
    if (existsSync(join(outDir, 'render-smoke.json'))) {
      try {
        smokeJson = JSON.parse(await readFile(join(outDir, 'render-smoke.json'), 'utf8'));
      } catch (e) {}
    }

    const screenshotExists = existsSync(join(outDir, 'render-smoke.png'));
    sendEvent('rendering_success', 'Playwright smoke rendering pass complete.');

    // Complete
    sendEvent('complete', 'All operations executed successfully!', {
      runId: `${stamp}-${slug}`,
      metadata,
      rawResponse: rawText,
      html,
      smokeJson,
      screenshotUrl: screenshotExists ? `/runs/${stamp}-${slug}/render-smoke.png` : null
    });
    
    res.end();

  } catch (error) {
    sendEvent('error', error.message);
    res.end();
  }
});

// Start the Server
app.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(`OpenRouter HTML Test Bench running locally on http://localhost:${PORT}`);
  console.log(`===========================================================`);
});
