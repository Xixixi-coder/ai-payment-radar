import fs from 'node:fs';
import vm from 'node:vm';

export function toShanghaiIsoDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function formatChineseDate(isoDate) {
  const date = new Date(`${isoDate}T00:00:00+08:00`);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 周${weekdays[date.getDay()]}`;
}

export function getIsoWeek(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

export function extractReport(html) {
  const marker = 'const REPORT = ';
  const renderMarker = '\n\n\n// ============================================================\n// RENDER';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('Cannot find REPORT declaration in index.html');
  const end = html.indexOf(renderMarker, start);
  if (end === -1) throw new Error('Cannot find RENDER marker after REPORT declaration');

  const declaration = html.slice(start, end).trim();
  const report = vm.runInNewContext(`${declaration}\nREPORT;`, Object.create(null), {
    timeout: 1000,
    displayErrors: true
  });
  return { report, start, end, renderMarker };
}

export function replaceReport(html, report) {
  const { start, end, renderMarker } = extractReport(html);
  const serialized = JSON.stringify(report, null, 2);
  const replaced = `${html.slice(0, start)}const REPORT = ${serialized};${html.slice(end)}`;
  return syncStaticPlaceholders(replaced, report).replace(renderMarker, renderMarker);
}

export function syncStaticPlaceholders(html, report) {
  return html
    .replace(/<span id="report-date">[^<]*<\/span>/, `<span id="report-date">${report.date}</span>`)
    .replace(/<span id="report-week">[^<]*<\/span>/, `<span id="report-week">${report.week}</span>`)
    .replace(/<div class="stat-num red" id="stat-high">[^<]*<\/div>/, `<div class="stat-num red" id="stat-high">${report.stats.high}</div>`)
    .replace(/<div class="stat-num" id="stat-scenes">[^<]*<\/div>/, `<div class="stat-num" id="stat-scenes">${report.stats.scenes}</div>`)
    .replace(/<div class="stat-num green" id="stat-news">[^<]*<\/div>/, `<div class="stat-num green" id="stat-news">${report.stats.news}</div>`)
    .replace(/<div class="stat-num blue" id="stat-compete">[^<]*<\/div>/, `<div class="stat-num blue" id="stat-compete">${report.stats.compete}</div>`);
}

export function makeArchiveHtml(html) {
  return html
    .replaceAll('href="history.html"', 'href="../history.html"')
    .replaceAll('href="index.html"', 'href="../index.html"')
    .replaceAll("fetch('archive/index.json?", "fetch('../archive/index.json?");
}

export function loadJson(path, fallback) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

export function writeJson(path, value) {
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function getReportIsoDate(report) {
  const match = String(report.date || '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match) throw new Error(`Cannot parse report date: ${report.date}`);
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function summarizeTitle(report) {
  if (report.title) return report.title;
  return (report.news || [])
    .slice(0, 3)
    .map(item => item.title)
    .join('+')
    .replace(/[，。；：:]/g, '')
    .slice(0, 44) || 'AI支付场景雷达日报';
}

export function validateReport(report) {
  const requiredArrays = ['news', 'opportunities', 'scenes', 'competitors', 'suggestions'];
  if (!report || typeof report !== 'object') throw new Error('REPORT must be an object');
  if (!report.date || !report.week || !report.stats || !report.summary) throw new Error('REPORT missing date/week/stats/summary');
  for (const key of requiredArrays) {
    if (!Array.isArray(report[key]) || report[key].length === 0) {
      throw new Error(`REPORT.${key} must be a non-empty array`);
    }
  }
  for (const key of ['high', 'scenes', 'news', 'compete']) {
    if (!Number.isFinite(report.stats[key])) throw new Error(`REPORT.stats.${key} must be a number`);
  }
}

export function daysBetween(fromIsoDate, toIsoDate) {
  const from = new Date(`${fromIsoDate}T00:00:00+08:00`);
  const to = new Date(`${toIsoDate}T00:00:00+08:00`);
  return Math.floor((to - from) / 86400000);
}
