#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  daysBetween,
  extractReport,
  getReportIsoDate,
  loadJson,
  toShanghaiIsoDate,
  validateReport
} from './report-utils.mjs';

const root = process.cwd();

function parseArgs(argv) {
  const args = {
    today: process.env.VERIFY_TODAY || toShanghaiIsoDate(),
    maxAgeDays: Number(process.env.MAX_REPORT_AGE_DAYS || 1)
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--today') args.today = argv[++index];
    else if (arg === '--max-age-days') args.maxAgeDays = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const indexPath = path.join(root, 'index.html');
  const archiveDir = path.join(root, 'archive');
  const archiveIndexPath = path.join(archiveDir, 'index.json');
  const html = fs.readFileSync(indexPath, 'utf8');
  const { report } = extractReport(html);
  validateReport(report);

  const reportDate = getReportIsoDate(report);
  const age = daysBetween(reportDate, args.today);
  assert(age >= 0, `Report date ${reportDate} is after verify date ${args.today}`);
  assert(age <= args.maxAgeDays, `Report is stale: ${reportDate}, today ${args.today}, age ${age} days`);

  assert(html.includes(`<span id="report-date">${report.date}</span>`), 'Static report date placeholder is not synchronized');
  assert(html.includes(`<span id="report-week">${report.week}</span>`), 'Static report week placeholder is not synchronized');
  assert(html.includes('href="history.html"'), 'Homepage must link to history.html');

  const archiveIndex = loadJson(archiveIndexPath, []);
  assert(Array.isArray(archiveIndex) && archiveIndex.length > 0, 'archive/index.json must be a non-empty array');
  assert(archiveIndex[0].date === reportDate, `archive/index.json latest date ${archiveIndex[0].date} does not match REPORT ${reportDate}`);
  assert(archiveIndex[0].stats.news === report.stats.news, 'archive/index.json latest stats do not match REPORT.stats');

  const sortedDates = [...archiveIndex].map(item => item.date).sort((left, right) => right.localeCompare(left));
  assert(JSON.stringify(sortedDates) === JSON.stringify(archiveIndex.map(item => item.date)), 'archive/index.json must be sorted by date descending');

  const seenDates = new Set();
  for (const item of archiveIndex) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(item.date), `Invalid archive date: ${item.date}`);
    assert(!seenDates.has(item.date), `Duplicate archive date: ${item.date}`);
    seenDates.add(item.date);
    const archivePath = path.join(archiveDir, `${item.date}.html`);
    assert(fs.existsSync(archivePath), `Missing archive file: archive/${item.date}.html`);
  }

  const latestArchiveHtml = fs.readFileSync(path.join(archiveDir, `${reportDate}.html`), 'utf8');
  assert(latestArchiveHtml.includes(`const REPORT =`), 'Latest archive page must include REPORT data');
  assert(latestArchiveHtml.includes('href="../history.html"'), 'Latest archive page must link back to ../history.html');
  console.log(`[verify] ok: latest=${reportDate}, today=${args.today}, archives=${archiveIndex.length}`);
}

try {
  main();
} catch (error) {
  console.error(`[verify] ${error.message}`);
  process.exit(1);
}
