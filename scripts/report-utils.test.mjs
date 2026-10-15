#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { articlesFingerprint, selectArticles } from './feed-report.mjs';
import { extractReport, formatChineseDate, getReportIsoDate, validateReport } from './report-utils.mjs';

for (const timezone of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles']) {
  process.env.TZ = timezone;
  assert.equal(formatChineseDate('2026-08-13'), '2026年8月13日 周四');
  assert.equal(formatChineseDate('2026-08-14'), '2026年8月14日 周五');
}

assert.equal(getReportIsoDate({ date: '2026年8月14日 周五' }), '2026-08-14');
console.log('[unit] report-utils ok');

const now = new Date('2026-10-15T04:00:00Z');
const entries = Array.from({ length: 15 }, (_, index) => ({ title: `Agentic payments platform ${index}`, source: `Source ${index}`, link: `https://example.com/${index}`, pubDate: 'Thu, 15 Oct 2026 01:00:00 GMT' }));
entries.push({ title: '支付宝手机 AI 支付方案', source: '中文来源', link: 'https://example.com/chinese', pubDate: 'Wed, 14 Oct 2026 01:00:00 GMT' });
const selected = selectArticles(entries, now);
assert.equal(selected.length, 12);
assert.ok(selected.some(item => item.title.includes('支付宝')), 'International volume must not crowd out Chinese news');
assert.equal(articlesFingerprint(selected), articlesFingerprint([...selected].reverse()), 'Order alone is not a content update');
const current = extractReport(fs.readFileSync('index.html', 'utf8')).report;
if (current.schemaVersion === 2 && current.news.length) {
  const corrupt = structuredClone(current);
  corrupt.news[0].publishedAt = '2026-06-16T07:00:00Z';
  corrupt.fingerprint = articlesFingerprint(corrupt.news);
  assert.throws(() => validateReport(corrupt), /outside the report window/);
}
console.log('[unit] language balance, stable fingerprints and stale-report rejection ok');
