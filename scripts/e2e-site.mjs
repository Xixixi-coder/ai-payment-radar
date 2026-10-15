#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { daysBetween, extractReport, getReportIsoDate, toShanghaiIsoDate, validateReport } from './report-utils.mjs';

const root = process.cwd();

function parseArgs(argv) {
  const args = {
    today: process.env.E2E_TODAY || toShanghaiIsoDate(),
    maxAgeDays: Number(process.env.MAX_REPORT_AGE_DAYS || 0)
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--today') args.today = argv[++index];
    else if (arg === '--max-age-days') args.maxAgeDays = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.today)) {
    throw new Error(`--today must be YYYY-MM-DD, got ${args.today}`);
  }
  if (!Number.isFinite(args.maxAgeDays) || args.maxAgeDays < 0) {
    throw new Error(`--max-age-days must be a non-negative number, got ${args.maxAgeDays}`);
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
    return await chromium.launch({ headless: true, ...(process.env.E2E_EXECUTABLE_PATH ? { executablePath: process.env.E2E_EXECUTABLE_PATH } : {}) });
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
  execFileSync(process.execPath, [path.join(root, 'scripts/report-utils.test.mjs')], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(root, 'scripts/update-daily-report.test.mjs')], { cwd: root, stdio: 'inherit' });
  const { chromium } = await import('playwright');
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const { report } = extractReport(html);
  validateReport(report);
  const reportDate = getReportIsoDate(report);
  const state = JSON.parse(await fs.readFile(path.join(root, 'archive/last-updated.json'), 'utf8'));
  const age = daysBetween(report.schemaVersion === 2 ? state.checkedDate : reportDate, args.today);
  assert(age >= 0, `Report date ${reportDate} should not be after ${args.today}`);
  assert(age <= args.maxAgeDays, `Report is stale: ${reportDate}, today ${args.today}, age ${age} days`);

  const server = process.env.E2E_BASE_URL ? null : await startServer();
  const baseUrl = (process.env.E2E_BASE_URL || `http://127.0.0.1:${server.address().port}`).replace(/\/$/, '');
  const browser = await launchBrowser(chromium);
  try {
    if (!browser) {
      await runHttpSmoke(baseUrl, report, reportDate);
      return;
    }
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#report-date');
    const homepageDate = await page.locator('#report-date').textContent();
    assert(homepageDate === report.date, `Homepage date mismatch: ${homepageDate} !== ${report.date}`);
    assert(await page.locator('.news-card').count() === report.news.length, 'Homepage must render the actual news count');
    assert(await page.locator('.news-title a').count() === report.news.length, 'Each news item must link to its source');
    assert(!(await page.locator('#news-scroll').textContent()).includes('近24小时'), 'News must not use a fake freshness label');
    assert(await page.locator('#update-status').getAttribute('data-status') === state.status, 'Homepage must load the latest check status');
    for (const item of report.news) {
      assert((await page.locator('#news-scroll').textContent()).includes(item.time), `Missing actual publication date ${item.time}`);
    }
    assert(await page.locator('.card').count() >= 6, 'Homepage should render scene cards');
    await page.locator('.card-head').first().click();
    assert(await page.locator('.card').first().getAttribute('class').then(value => value.includes('expanded')), 'Scene card must expand');
    assert((await page.locator('.card').first().textContent()).includes('历史'), 'Historical scene content must be labelled');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile page must not overflow');
    if (process.env.E2E_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.E2E_SCREENSHOT_DIR, 'radar-mobile.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.E2E_SCREENSHOT_DIR, 'radar-desktop.png'), fullPage: true });

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
    assert(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
    console.log(`[e2e] ok: ${baseUrl}, latest=${reportDate}`);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(`[e2e] ${error.stack || error.message}`);
  process.exit(1);
});
