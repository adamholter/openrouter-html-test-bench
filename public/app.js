// ==========================================================================
// OpenRouter HTML Test Bench - Frontend Controller
// ==========================================================================

// Global state variables
let liveModelsList = [];
let currentRunId = null;
let activeTabId = 'tab-preview';

// DOM Elements Cache
const elements = {
  apiKey: document.getElementById('input-api-key'),
  keySource: document.getElementById('key-source-text'),
  btnToggleKey: document.getElementById('btn-toggle-key'),
  
  searchGenModel: document.getElementById('search-gen-model'),
  selectGenModel: document.getElementById('select-gen-model'),
  searchExtModel: document.getElementById('search-ext-model'),
  selectExtModel: document.getElementById('select-ext-model'),
  
  pillGenModel: document.getElementById('pill-gen-model'),
  pillExtModel: document.getElementById('pill-ext-model'),
  
  serverStatusDot: document.getElementById('server-status-dot'),
  serverStatusText: document.getElementById('server-status-text'),
  
  runsList: document.getElementById('runs-list'),
  
  promptBadge: document.getElementById('prompt-file-badge'),
  promptTextarea: document.getElementById('prompt-textarea'),
  editorGutter: document.getElementById('editor-gutter'),
  testNameSlug: document.getElementById('input-test-name'),
  btnRunTest: document.getElementById('btn-run-test'),
  
  progressContainer: document.getElementById('progress-container'),
  
  previewIframe: document.getElementById('preview-iframe'),
  actionOpenTab: document.getElementById('action-open-tab'),
  previewWrapper: document.getElementById('preview-wrapper'),
  
  smokeValTitle: document.getElementById('smoke-val-title'),
  smokeValDimensions: document.getElementById('smoke-val-dimensions'),
  smokeValElements: document.getElementById('smoke-val-elements'),
  smokeValTextLength: document.getElementById('smoke-val-text-length'),
  smokeValConsoleErrs: document.getElementById('smoke-val-console-errs'),
  smokeValPageErrs: document.getElementById('smoke-val-page-errs'),
  smokeConsoleContainer: document.getElementById('smoke-console-container'),
  smokeConsoleText: document.getElementById('smoke-console-text'),
  screenshotView: document.getElementById('screenshot-view'),
  
  htmlSizeLabel: document.getElementById('html-size-label'),
  htmlCodePre: document.getElementById('html-code-pre'),
  
  rawSizeLabel: document.getElementById('raw-size-label'),
  rawResponsePre: document.getElementById('raw-response-pre'),
  
  errorToast: document.getElementById('error-toast'),
  toastTitle: document.getElementById('toast-title'),
  toastDesc: document.getElementById('toast-desc')
};

// ------------------------------------------------------------------------
// App Initialization
// ------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', async () => {
  // 1. Initial Line Numbers Gutters setup
  updateLineNumbers();
  
  // 2. Load API key from local storage
  const savedKey = localStorage.getItem('openrouter_api_key');
  if (savedKey) {
    elements.apiKey.value = savedKey;
  }
  
  // 3. Detect and ping local backend server
  await checkServerHealth();
  
  // 4. Fetch models (this will also update key source info)
  await fetchModels();
  
  // 5. Load the default starter prompt
  await loadDefaultPrompt();
  
  // 6. Populate historical runs
  await loadHistoryList();
});

async function checkServerHealth() {
  try {
    const res = await fetch('/api/prompt-default');
    if (res.ok) {
      elements.serverStatusDot.className = 'pulse-dot online';
      elements.serverStatusText.textContent = 'Server Online';
    } else {
      throw new Error();
    }
  } catch (e) {
    elements.serverStatusDot.className = 'pulse-dot offline';
    elements.serverStatusText.textContent = 'Server Offline';
    showError('Connection Refused', 'Could not establish connection with the local backend server. Please run "npm start" in your terminal first.');
  }
}

// ------------------------------------------------------------------------
// Settings & Model Handling
// ------------------------------------------------------------------------

async function fetchModels() {
  const passedKey = elements.apiKey.value.trim();
  const url = passedKey ? `/api/models?key=${encodeURIComponent(passedKey)}` : '/api/models';
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.success) {
      liveModelsList = data.models || [];
      elements.keySource.textContent = `Active Key: ${data.keySource}`;
      elements.keySource.className = 'key-source-info success';
      
      // Populate select elements
      populateModelDropdowns();
      
      // Resolve initial selection from local storage or defaults
      resolveInitialModels();
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    elements.keySource.textContent = 'No key found or credentials invalid.';
    elements.keySource.className = 'key-source-info error';
    
    // Clear select elements
    elements.selectGenModel.innerHTML = '<option disabled>Please verify API key...</option>';
    elements.selectExtModel.innerHTML = '<option disabled>Please verify API key...</option>';
    
    elements.pillGenModel.textContent = 'None';
    elements.pillExtModel.textContent = 'None';
  }
}

function populateModelDropdowns() {
  const genDropdown = elements.selectGenModel;
  const extDropdown = elements.selectExtModel;
  
  genDropdown.innerHTML = '';
  extDropdown.innerHTML = '';
  
  if (!liveModelsList.length) {
    genDropdown.innerHTML = '<option disabled>No models available</option>';
    extDropdown.innerHTML = '<option disabled>No models available</option>';
    return;
  }
  
  // Sort models alphabetically
  const sorted = [...liveModelsList].sort((a, b) => a.id.localeCompare(b.id));
  
  sorted.forEach(model => {
    const optionGen = document.createElement('option');
    optionGen.value = model.id;
    optionGen.textContent = `${model.name} (${model.id})`;
    genDropdown.appendChild(optionGen);
    
    const optionExt = document.createElement('option');
    optionExt.value = model.id;
    optionExt.textContent = `${model.name} (${model.id})`;
    extDropdown.appendChild(optionExt);
  });
}

function resolveInitialModels() {
  const savedGen = localStorage.getItem('preferred_gen_model');
  const savedExt = localStorage.getItem('preferred_ext_model');
  
  let targetGen = savedGen;
  let targetExt = savedExt;
  
  const modelIds = liveModelsList.map(m => m.id);
  
  // 1. Resolve Generation Model Default
  if (!targetGen || !modelIds.includes(targetGen)) {
    targetGen = [
      'x-ai/grok-4.3',
      'x-ai/grok-4.20',
      'openai/gpt-oss-120b',
      'openai/gpt-oss-120b:free'
    ].find(id => modelIds.includes(id)) || modelIds.find(id => id.includes('grok-4')) || modelIds[0];
  }
  
  // 2. Resolve Extraction Model Default
  if (!targetExt || !modelIds.includes(targetExt)) {
    targetExt = [
      'openai/gpt-oss-20b',
      'openai/gpt-oss-20b:free',
      'openai/gpt-oss-120b'
    ].find(id => modelIds.includes(id)) || modelIds[0];
  }
  
  // Select options in dropdowns if they exist
  elements.selectGenModel.value = targetGen;
  elements.selectExtModel.value = targetExt;
  
  // Sync display badges
  elements.pillGenModel.textContent = targetGen.split('/').at(-1);
  elements.pillExtModel.textContent = targetExt.split('/').at(-1);
}

function filterModels(type) {
  const input = type === 'gen' ? elements.searchGenModel : elements.searchExtModel;
  const select = type === 'gen' ? elements.selectGenModel : elements.selectExtModel;
  const query = input.value.toLowerCase().trim();
  
  const options = select.options;
  for (let i = 0; i < options.length; i++) {
    const text = options[i].text.toLowerCase();
    const val = options[i].value.toLowerCase();
    if (text.includes(query) || val.includes(query)) {
      options[i].style.display = 'block';
    } else {
      options[i].style.display = 'none';
    }
  }
}

function syncModelPicker(type) {
  const select = type === 'gen' ? elements.selectGenModel : elements.selectExtModel;
  const pill = type === 'gen' ? elements.pillGenModel : elements.pillExtModel;
  
  if (select.value) {
    pill.textContent = select.value.split('/').at(-1);
  }
}

async function saveSettings() {
  const key = elements.apiKey.value.trim();
  const genModel = elements.selectGenModel.value;
  const extModel = elements.selectExtModel.value;
  
  if (key) {
    localStorage.setItem('openrouter_api_key', key);
  } else {
    localStorage.removeItem('openrouter_api_key');
  }
  
  if (genModel) localStorage.setItem('preferred_gen_model', genModel);
  if (extModel) localStorage.setItem('preferred_ext_model', extModel);
  
  // Trigger models update
  await fetchModels();
  
  // Trigger toast success
  showError('Configuration Saved', 'API settings and preferred models synced successfully.', true);
}

function toggleKeyMask() {
  const input = elements.apiKey;
  const btn = elements.btnToggleKey;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁';
  }
}

function togglePanel(id) {
  const panel = document.getElementById(id);
  panel.classList.toggle('collapsed');
}

// ------------------------------------------------------------------------
// Prompt Editing & Gutters
// ------------------------------------------------------------------------

function updateLineNumbers() {
  const text = elements.promptTextarea.value;
  const lines = text.split('\n');
  const count = Math.max(1, lines.length);
  
  let gutterHTML = '';
  for (let i = 1; i <= count; i++) {
    gutterHTML += `${i}\n`;
  }
  elements.editorGutter.textContent = gutterHTML;
}

function syncGutterScroll() {
  elements.editorGutter.scrollTop = elements.promptTextarea.scrollTop;
}

function clearPrompt() {
  elements.promptTextarea.value = '';
  elements.promptBadge.textContent = 'custom';
  elements.testNameSlug.value = 'custom-run';
  updateLineNumbers();
}

async function loadDefaultPrompt() {
  try {
    const res = await fetch('/api/prompt-default');
    const data = await res.json();
    if (data.success) {
      elements.promptTextarea.value = data.prompt;
      elements.promptBadge.textContent = 'llm-landing.md';
      elements.testNameSlug.value = 'llm-landing';
      updateLineNumbers();
    }
  } catch (error) {
    showError('Default Prompt Error', 'Failed to retrieve standard system prompt file.');
  }
}

// ------------------------------------------------------------------------
// Progressive Stream Evaluator Run
// ------------------------------------------------------------------------

async function executeRun() {
  const prompt = elements.promptTextarea.value.trim();
  const promptName = elements.testNameSlug.value.trim() || 'custom-test';
  const generationModel = elements.selectGenModel.value;
  const extractionModel = elements.selectExtModel.value;
  const apiKey = elements.apiKey.value.trim();
  
  if (!prompt) {
    showError('Prompt Empty', 'Please supply a prompt description in the editor before generating.');
    return;
  }
  
  // 1. Reset progress tracker states
  elements.progressContainer.classList.remove('hidden');
  resetTrackerSteps();
  
  // Disable interface
  elements.btnRunTest.disabled = true;
  elements.btnRunTest.innerHTML = '<span class="pulse-dot loading"></span> Executing Test Bench...';
  
  try {
    // 2. Fetch the stream response
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        promptName,
        generationModel,
        extractionModel,
        apiKey
      })
    });
    
    if (!response.body) {
      throw new Error('Readable stream not supported or returned null response.');
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      // Parse individual SSE lines
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || ''; // Keep partial line in buffer
      
      for (const line of lines) {
        if (line.trim().startsWith('data: ')) {
          try {
            const rawJson = line.replace(/^data:\s*/, '');
            const parsed = JSON.parse(rawJson);
            handleProgressEvent(parsed);
          } catch (e) {
            // Ignore parse exceptions for half-rendered chunks
          }
        }
      }
    }
    
  } catch (error) {
    showError('Execution Failure', error.message);
    elements.btnRunTest.disabled = false;
    elements.btnRunTest.innerHTML = '<span class="btn-symbol">⚡</span> Run Artifact Generation';
  }
}

function resetTrackerSteps() {
  const steps = ['validating_key', 'generating', 'extracting', 'rendering'];
  steps.forEach(id => {
    const el = document.getElementById(`step-${id}`);
    el.className = 'tracker-step pending';
    el.querySelector('.step-icon').textContent = '○';
  });
}

function handleProgressEvent(event) {
  const { stage, message, data } = event;
  
  // Map progressive events to DOM logs
  switch (stage) {
    case 'validating_key':
      setActiveStep('validating_key', '▶');
      break;
    case 'validating_key_success':
      setSuccessStep('validating_key', '✓');
      break;
      
    case 'generating':
      setSuccessStep('validating_key', '✓');
      setActiveStep('generating', '▶');
      break;
    case 'generating_success':
      setSuccessStep('generating', '✓');
      break;
      
    case 'extracting':
      setSuccessStep('generating', '✓');
      setActiveStep('extracting', '▶');
      break;
    case 'extracting_success':
      setSuccessStep('extracting', '✓');
      break;
      
    case 'rendering':
      setSuccessStep('extracting', '✓');
      setActiveStep('rendering', '▶');
      break;
    case 'rendering_success':
      setSuccessStep('rendering', '✓');
      break;
      
    case 'complete':
      setSuccessStep('rendering', '✓');
      // Render results
      displayRunResults(data);
      // Refresh runs history
      loadHistoryList();
      
      // Cleanup button
      elements.btnRunTest.disabled = false;
      elements.btnRunTest.innerHTML = '<span class="btn-symbol">⚡</span> Run Artifact Generation';
      
      // Auto transition to preview tab
      switchTab('tab-preview');
      break;
      
    case 'error':
      setFailedActiveStep(message);
      break;
  }
}

function setActiveStep(id, symbol) {
  const el = document.getElementById(`step-${id}`);
  el.className = 'tracker-step active';
  el.querySelector('.step-icon').textContent = symbol;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setSuccessStep(id, symbol) {
  const el = document.getElementById(`step-${id}`);
  el.className = 'tracker-step success';
  el.querySelector('.step-icon').textContent = symbol;
}

function setFailedActiveStep(msg) {
  const activeEl = document.querySelector('.tracker-step.active');
  if (activeEl) {
    activeEl.className = 'tracker-step failed';
    activeEl.querySelector('.step-icon').textContent = '✗';
  }
  
  showError('Pipeline Failed', msg);
  
  elements.btnRunTest.disabled = false;
  elements.btnRunTest.innerHTML = '<span class="btn-symbol">⚡</span> Run Artifact Generation';
}

// ------------------------------------------------------------------------
// Output Panel Render Details
// ------------------------------------------------------------------------

function displayRunResults(data) {
  currentRunId = data.runId;
  
  // 1. Live Preview Panel Setup
  elements.previewIframe.className = 'loaded';
  elements.previewIframe.src = `/runs/${data.runId}/index.html`;
  elements.actionOpenTab.href = `/runs/${data.runId}/index.html`;
  
  // 2. HTML panel
  const linesCountHtml = data.html ? data.html.split('\n').length : 0;
  elements.htmlSizeLabel.textContent = `${linesCountHtml} lines | ${(data.html.length / 1024).toFixed(1)} KB`;
  elements.htmlCodePre.textContent = data.html;
  
  // 3. Raw response panel
  const linesCountRaw = data.rawResponse ? data.rawResponse.split('\n').length : 0;
  elements.rawSizeLabel.textContent = `${linesCountRaw} lines | ${(data.rawResponse.length / 1024).toFixed(1)} KB`;
  elements.rawResponsePre.textContent = data.rawResponse;
  
  // 4. Playwright smoke check panel
  if (data.smokeJson && data.smokeJson.metrics) {
    const m = data.smokeJson.metrics;
    elements.smokeValTitle.textContent = m.title || '(No Title)';
    elements.smokeValDimensions.textContent = `${m.width}px × ${m.height}px`;
    elements.smokeValElements.textContent = m.elements;
    elements.smokeValTextLength.textContent = m.bodyTextLength;
    elements.smokeValConsoleErrs.textContent = data.smokeJson.consoleErrors ? data.smokeJson.consoleErrors.length : 0;
    elements.smokeValPageErrs.textContent = data.smokeJson.pageErrors ? data.smokeJson.pageErrors.length : 0;
    
    // Console warnings box
    if (data.smokeJson.consoleErrors && data.smokeJson.consoleErrors.length) {
      elements.smokeConsoleContainer.classList.remove('hidden');
      elements.smokeConsoleText.textContent = data.smokeJson.consoleErrors.join('\n');
    } else if (data.smokeJson.pageErrors && data.smokeJson.pageErrors.length) {
      elements.smokeConsoleContainer.classList.remove('hidden');
      elements.smokeConsoleText.textContent = `Page Loading Errors:\n` + data.smokeJson.pageErrors.join('\n');
    } else {
      elements.smokeConsoleContainer.classList.add('hidden');
    }
  } else {
    // Blank values
    elements.smokeValTitle.textContent = '-';
    elements.smokeValDimensions.textContent = '-';
    elements.smokeValElements.textContent = '-';
    elements.smokeValTextLength.textContent = '-';
    elements.smokeValConsoleErrs.textContent = '0';
    elements.smokeValPageErrs.textContent = '0';
    elements.smokeConsoleContainer.classList.add('hidden');
  }
  
  // Playwright screenshot view
  if (data.screenshotUrl) {
    elements.screenshotView.innerHTML = `<img src="${data.screenshotUrl}?t=${Date.now()}" alt="Playwright Page Render Capture" class="screenshot-img" onclick="window.open('${data.screenshotUrl}', '_blank')">`;
  } else {
    elements.screenshotView.innerHTML = '<div class="empty-screenshot-placeholder">No screenshot taken yet. Run a test.</div>';
  }
  
  // Highlight sidebar item if visible
  highlightActiveRunItem(data.runId);
}

// ------------------------------------------------------------------------
// Historical Runs & Sidebar History
// ------------------------------------------------------------------------

async function loadHistoryList() {
  try {
    const res = await fetch('/api/runs');
    const data = await res.json();
    
    if (data.success && data.runs) {
      renderHistoryList(data.runs);
    }
  } catch (error) {
    elements.runsList.innerHTML = '<div class="empty-state">Failed to load run history from backend.</div>';
  }
}

function renderHistoryList(runs) {
  const container = elements.runsList;
  container.innerHTML = '';
  
  if (!runs.length) {
    container.innerHTML = '<div class="empty-state">No past runs found. Your evaluations will appear here.</div>';
    return;
  }
  
  runs.forEach(run => {
    const item = document.createElement('div');
    item.className = 'run-item';
    item.id = `run-item-${run.runId}`;
    if (currentRunId === run.runId) {
      item.classList.add('active');
    }
    
    item.onclick = () => loadRunDetails(run.runId);
    
    // Parse time
    let stampStr = '';
    let promptSlug = run.runId;
    let modelName = 'Unknown Model';
    let extractMethod = '';
    
    if (run.metadata) {
      const date = new Date(run.metadata.createdAt);
      stampStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      promptSlug = run.metadata.promptPath.split('/').at(-1).replace(/\.md$/i, '');
      modelName = run.metadata.generationModel.split('/').at(-1);
      extractMethod = run.metadata.extractionMethod === 'model' ? 'AI' : 'FALLBACK';
    } else {
      // Guess from folder name (e.g. 2026-05-25T11-59-54-892Z-llm-landing)
      const parts = run.runId.split('-');
      if (parts.length >= 3) {
        promptSlug = parts.slice(3).join('-');
        stampStr = parts.slice(0, 3).join('-').slice(0, 16).replace('T', ' ');
      }
    }
    
    item.innerHTML = `
      <div class="run-item-header">
        <span class="run-item-slug" title="${promptSlug}">${promptSlug}</span>
        <span class="run-item-time">${stampStr}</span>
      </div>
      <div class="run-item-model" title="${run.metadata?.generationModel || ''}">
        ${modelName}
        ${extractMethod ? `<span class="run-item-method">${extractMethod}</span>` : ''}
      </div>
    `;
    
    container.appendChild(item);
  });
}

async function loadRunDetails(runId) {
  try {
    const res = await fetch(`/api/runs/${runId}`);
    const data = await res.json();
    
    if (data.success) {
      displayRunResults(data);
      
      // Load this historical run's original prompt inside the editor!
      if (data.metadata) {
        elements.promptBadge.textContent = data.metadata.promptPath.split('/').at(-1);
        elements.testNameSlug.value = data.metadata.promptPath.split('/').at(-1).replace(/\.md$/i, '');
      }
      
      if (data.rawResponse) {
        // If we saved a raw prompt in metadata or raw-response.txt, let's keep it. But wait, rawResponse is the model response, not the prompt. The original prompts are file-based (like llm-landing.md).
      }
    }
  } catch (error) {
    showError('Load Error', `Failed to retrieve run details for ${runId}.`);
  }
}

function highlightActiveRunItem(runId) {
  // Remove active from all runs
  document.querySelectorAll('.run-item').forEach(item => {
    item.classList.remove('active');
  });
  
  // Add to active
  const activeEl = document.getElementById(`run-item-${runId}`);
  if (activeEl) {
    activeEl.classList.add('active');
  }
}

// ------------------------------------------------------------------------
// Tabs & Interface Controls
// ------------------------------------------------------------------------

function switchTab(tabId) {
  activeTabId = tabId;
  
  // Triggers
  document.querySelectorAll('.tab-trigger').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Find matching trigger based on onclick string or we can bind events.
  // Standard simple loop:
  const triggers = document.querySelectorAll('.tab-trigger');
  triggers.forEach(tr => {
    if (tr.getAttribute('onclick').includes(tabId)) {
      tr.classList.add('active');
    }
  });
  
  // Content panels
  document.querySelectorAll('.tab-content').forEach(pnl => {
    pnl.classList.remove('active');
  });
  document.getElementById(tabId).classList.add('active');
}

function setIframeWidth(width) {
  const iframe = elements.previewIframe;
  
  // Remove active from size buttons
  document.querySelectorAll('.view-size-controls button').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Set matching active button
  const buttons = document.querySelectorAll('.view-size-controls button');
  buttons.forEach(btn => {
    if (btn.getAttribute('onclick').includes(width)) {
      btn.classList.add('active');
    }
  });
  
  if (width === '100%') {
    iframe.style.width = 'calc(100% - 24px)';
    iframe.style.height = 'calc(100% - 24px)';
    iframe.style.borderRadius = '4px';
  } else {
    iframe.style.width = width;
    iframe.style.height = '100%';
    iframe.style.borderRadius = '0';
  }
}

function copyToClipboard(elementId) {
  const text = document.getElementById(elementId).textContent;
  navigator.clipboard.writeText(text).then(() => {
    showError('Copied', 'Content copied successfully to clipboard.', true);
  }).catch(() => {
    showError('Clipboard Blocked', 'Could not access system clipboard.');
  });
}

// ------------------------------------------------------------------------
// Toast Alerts Controller
// ------------------------------------------------------------------------

function showError(title, msg, isSuccess = false) {
  elements.toastTitle.textContent = title;
  elements.toastDesc.textContent = msg;
  elements.errorToast.classList.remove('hidden');
  
  if (isSuccess) {
    elements.errorToast.style.borderLeftColor = 'var(--color-success)';
    elements.errorToast.querySelector('.toast-warning-symbol').textContent = '✓';
  } else {
    elements.errorToast.style.borderLeftColor = 'var(--color-error)';
    elements.errorToast.querySelector('.toast-warning-symbol').textContent = '⚠️';
  }
  
  // Auto-dismiss after 6 seconds
  setTimeout(() => {
    hideError();
  }, 6000);
}

function hideError() {
  elements.errorToast.classList.add('hidden');
}
