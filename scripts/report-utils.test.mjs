#!/usr/bin/env node
import assert from 'node:assert/strict';
import { formatChineseDate, getReportIsoDate } from './report-utils.mjs';

for (const timezone of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles']) {
  process.env.TZ = timezone;
  assert.equal(formatChineseDate('2026-08-13'), '2026年8月13日 周四');
  assert.equal(formatChineseDate('2026-08-14'), '2026年8月14日 周五');
}

assert.equal(getReportIsoDate({ date: '2026年8月14日 周五' }), '2026-08-14');
console.log('[unit] report-utils ok');
