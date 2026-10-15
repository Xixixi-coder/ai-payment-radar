import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { extractReport } from './report-utils.mjs';

const repository = process.cwd();
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-update-test-'));
const rss = entries => `<rss><channel>${entries.map(entry => `<item><title><![CDATA[${entry.title}]]></title><link>https://example.com/${entry.id}</link><source>测试来源</source><pubDate>${entry.date}</pubDate></item>`).join('')}</channel></rss>`;
const entries = [
  { id: 'old', title: '支付宝 AI 支付旧动态', date: 'Tue, 16 Jun 2026 07:00:00 GMT' },
  { id: 'new-alipay', title: '支付宝发布 AI 支付手机接口', date: 'Wed, 14 Oct 2026 10:00:00 GMT' },
  { id: 'new-wechat', title: '微信推出 AI 支付授权服务', date: 'Wed, 14 Oct 2026 09:00:00 GMT' },
  { id: 'invalid', title: 'AI 支付无效日期', date: 'invalid' },
  { id: 'future', title: 'AI 支付未来新闻', date: 'Wed, 14 Oct 2027 09:00:00 GMT' },
  { id: 'spam', title: 'AI Girlfriend Pay With Paypal First Month Discount', date: 'Wed, 14 Oct 2026 11:00:00 GMT' },
  { id: 'promotion', title: 'XRP Price Prediction AI Payments Presale 300x', date: 'Wed, 14 Oct 2026 11:00:00 GMT' },
  { id: 'unsafe', title: 'Stripe AI payments <img src=x onerror=alert(1)> </script>', date: 'Wed, 14 Oct 2026 08:00:00 GMT' }
];

function update(date, items, fail = false, partial = false) {
  const frozenNow = `${date}T04:00:00Z`;
  const preload = `const NativeDate = Date; globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [${JSON.stringify(frozenNow)}])); } static now() { return new NativeDate(${JSON.stringify(frozenNow)}).getTime(); } }; globalThis.fetch = async url => { if (${fail} || (${partial} && String(url).includes('hl=en-US'))) throw new Error('fixture outage'); return new Response(${JSON.stringify(rss(items))}); };`;
  const environment = { ...process.env };
  for (const key of ['REPORT_JSON', 'REPORT_JSON_PATH', 'ALLOW_RSS_FALLBACK', 'NODE_OPTIONS']) delete environment[key];
  return spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, path.join(repository, 'scripts/update-daily-report.mjs'), '--date', date], { cwd: sandbox, env: environment, encoding: 'utf8' });
}

function report() {
  return extractReport(fs.readFileSync(path.join(sandbox, 'index.html'), 'utf8')).report;
}

function state() {
  return JSON.parse(fs.readFileSync(path.join(sandbox, 'archive/last-updated.json'), 'utf8'));
}

try {
  fs.copyFileSync(path.join(repository, 'index.html'), path.join(sandbox, 'index.html'));
  let result = update('2026-10-15', entries);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(report().schemaVersion, 2, 'Reports must include content-freshness metadata');
  assert.equal(report().news.length, 3, 'Keep distinct Chinese headlines; reject stale/invalid/future records');
  assert.ok(report().news.every(item => item.publishedAt && item.link && item.time !== '近24小时'));
  assert.ok(report().competitors.every(item => !item.desc.includes('本期继续跟踪')));
  const alipay = report().competitors.find(item => item.name.includes('支付宝'));
  assert.ok(alipay.observations.every(item => item.title.includes('支付宝')), 'Match competitors by entity, not array position');
  assert.ok(report().scenes.every(group => group.baselineNotice.includes('历史')));
  assert.equal(state().status, 'updated');
  const firstHtml = fs.readFileSync(path.join(sandbox, 'index.html'), 'utf8');
  assert.ok(!firstHtml.includes('AI payments <img'), 'Escape untrusted RSS text');
  const firstContentUpdate = state().contentUpdatedAt;
  const firstDescriptions = report().competitors.map(item => item.desc);

  result = update('2026-10-16', entries);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(state().status, 'unchanged');
  assert.equal(state().contentUpdatedAt, firstContentUpdate);
  assert.equal(state().checkedDate, '2026-10-16');
  assert.equal(fs.readFileSync(path.join(sandbox, 'index.html'), 'utf8'), firstHtml, 'Checking alone must not rewrite the report');
  assert.equal(JSON.stringify(report().competitors.map(item => item.desc)), JSON.stringify(firstDescriptions));
  assert.ok(!fs.existsSync(path.join(sandbox, 'archive/2026-10-16.html')), 'No fake daily archive when content is unchanged');
  const verifyClock = 'const NativeDate = Date; globalThis.Date = class extends NativeDate { static now() { return new NativeDate("2026-10-16T04:00:00Z").getTime(); } };';
  const verify = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(verifyClock)}`, path.join(repository, 'scripts/verify-site.mjs'), '--today', '2026-10-16', '--max-age-days', '0'], { cwd: sandbox, encoding: 'utf8' });
  assert.equal(verify.status, 0, verify.stderr);

  result = update('2026-10-16', entries, true);
  assert.notEqual(result.status, 0, 'All sources failing must fail the job');
  assert.equal(state().status, 'error');
  assert.equal(state().contentUpdatedAt, firstContentUpdate);
  assert.equal(fs.readFileSync(path.join(sandbox, 'index.html'), 'utf8'), firstHtml);

  const added = [...entries, { id: 'new-unionpay', title: '银联车载智能体支付开放接口', date: 'Thu, 15 Oct 2026 11:00:00 GMT' }];
  result = update('2026-10-16', added, false, true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(state().status, 'updated');
  assert.ok(state().sourceErrors.length > 0, 'Partial source failure must remain visible');
  assert.equal(report().news.length, 4);
  assert.ok(report().scenes.find(group => group.name.includes('出行')).observations.some(item => item.link.endsWith('new-unionpay')));
  assert.equal(report().competitors.find(item => item.name.includes('银联')).observations.length, 1);
  assert.notEqual(state().contentUpdatedAt, firstContentUpdate);

  const beforeEmpty = fs.readFileSync(path.join(sandbox, 'index.html'), 'utf8');
  result = update('2026-10-17', []);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(state().status, 'no-new-items');
  assert.equal(fs.readFileSync(path.join(sandbox, 'index.html'), 'utf8'), beforeEmpty);
  console.log('[unit] updater: freshness, Unicode dedup, entity matching, idempotency, source failures, new content and empty feeds passed');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
