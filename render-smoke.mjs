import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { stat, writeFile } from 'node:fs/promises';

const htmlPath = resolve(process.argv[2] || '');
if (!process.argv[2]) {
  console.error('Usage: node render-smoke.mjs <index.html>');
  process.exit(1);
}

await stat(htmlPath);

const browser = await chromium.launch({ headless: true });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const consoleMessages = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleMessages.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(dirname(htmlPath), 'render-smoke.png'), fullPage: true });
  const metrics = await page.evaluate(() => {
    const bodyText = document.body?.innerText?.trim() || '';
    const elements = document.body?.querySelectorAll('*').length || 0;
    const rect = document.body?.getBoundingClientRect();
    return {
      title: document.title,
      bodyTextLength: bodyText.length,
      elements,
      width: Math.round(rect?.width || 0),
      height: Math.round(rect?.height || 0)
    };
  });
  await writeFile(join(dirname(htmlPath), 'render-smoke.json'), JSON.stringify({
    checkedAt: new Date().toISOString(),
    htmlPath,
    metrics,
    consoleErrors: consoleMessages.slice(0, 20),
    pageErrors: pageErrors.slice(0, 20)
  }, null, 2));
  if (metrics.bodyTextLength < 200 || metrics.elements < 20) {
    throw new Error(`Rendered page looks too sparse: ${JSON.stringify(metrics)}`);
  }
  if (pageErrors.length) {
    throw new Error(`Page error while rendering: ${pageErrors[0]}`);
  }
  console.log(`Render smoke passed: ${join(dirname(htmlPath), 'render-smoke.png')}`);
} finally {
  await page?.close().catch(() => {});
  await browser.close().catch(() => {});
}
