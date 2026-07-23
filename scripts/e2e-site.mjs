#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractReport, getReportIsoDate, toShanghaiIsoDate } from './report-utils.mjs';

const root = process.cwd();

function parseArgs(argv) {
  const args = { today: process.env.E2E_TODAY || toShanghaiIsoDate() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--today') args.today = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  return 'application/octet-stream';
}

async function startServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const cleanPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const resolved = path.resolve(root, `.${cleanPath}`);
      if (!resolved.startsWith(root)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }
      const body = await fs.readFile(resolved);
      response.writeHead(200, { 'content-type': contentType(resolved), 'cache-control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function launchBrowser(chromium) {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    if (process.env.E2E_REQUIRE_BROWSER === '1') throw error;
    console.warn(`[e2e] browser launch unavailable, falling back to HTTP smoke: ${error.message.split('\n')[0]}`);
    return null;
  }
}

async function runHttpSmoke(baseUrl, report, reportDate) {
  const homepage = await fetch(baseUrl).then(response => response.text());
  assert(homepage.includes(report.date), 'HTTP homepage should contain latest report date');
  assert(homepage.includes('href="history.html"'), 'HTTP homepage should link to history.html');

  const history = await fetch(`${baseUrl}/history.html`).then(response => response.text());
  assert(history.includes('archive/index.json'), 'HTTP history page should load archive/index.json');

  const archiveIndex = await fetch(`${baseUrl}/archive/index.json`).then(response => response.json());
  assert(archiveIndex[0]?.date === reportDate, `HTTP archive index latest should be ${reportDate}`);

  const archive = await fetch(`${baseUrl}/archive/${reportDate}.html`).then(response => response.text());
  assert(archive.includes(report.date), 'HTTP latest archive should contain latest report date');
  assert(archive.includes('href="../history.html"'), 'HTTP latest archive should link back to history');
  console.log(`[e2e] http-smoke ok: ${baseUrl}, latest=${reportDate}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = await import('playwright');
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const { report } = extractReport(html);
  const reportDate = getReportIsoDate(report);
  assert(reportDate <= args.today, `Report date ${reportDate} should not be after ${args.today}`);

  const server = await startServer();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await launchBrowser(chromium);
  try {
    if (!browser) {
      await runHttpSmoke(baseUrl, report, reportDate);
      return;
    }
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#report-date');
    const homepageDate = await page.locator('#report-date').textContent();
    assert(homepageDate === report.date, `Homepage date mismatch: ${homepageDate} !== ${report.date}`);
    assert(await page.locator('.news-card').count() >= 3, 'Homepage should render at least 3 news cards');
    assert(await page.locator('.card').count() >= 6, 'Homepage should render scene cards');

    await page.getByRole('link', { name: /查看历史日报/ }).click();
    await page.waitForURL(/history\.html$/);
    await page.waitForSelector('.day-card');
    const firstDate = await page.locator('.day-date').first().textContent();
    assert(firstDate.includes(reportDate), `History latest card should contain ${reportDate}, got ${firstDate}`);

    await page.locator('.day-card').first().click();
    await page.waitForURL(new RegExp(`/archive/${reportDate}\\.html$`));
    await page.waitForSelector('#report-date');
    const archiveDate = await page.locator('#report-date').textContent();
    assert(archiveDate === report.date, `Archive date mismatch: ${archiveDate} !== ${report.date}`);
    assert(await page.getByRole('link', { name: /查看历史日报/ }).count() === 1, 'Archive page should link back to history');
    console.log(`[e2e] ok: ${baseUrl}, latest=${reportDate}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(`[e2e] ${error.stack || error.message}`);
  process.exit(1);
});
