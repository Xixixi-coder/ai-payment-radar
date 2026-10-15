#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { articleKey, articlesFingerprint, buildSections, collectArticles, escapeHtml, selectArticles, WINDOW_DAYS } from './feed-report.mjs';
import { extractReport, formatChineseDate, getIsoWeek, getReportIsoDate, loadJson, makeArchiveHtml, replaceReport, summarizeTitle, toShanghaiIsoDate, validateReport, writeJson } from './report-utils.mjs';

const root = process.cwd();
const indexPath = path.join(root, 'index.html');
const archiveDir = path.join(root, 'archive');
const statePath = path.join(archiveDir, 'last-updated.json');
const archiveIndexPath = path.join(archiveDir, 'index.json');

function parseArgs(argv) {
  const args = { date: process.env.REPORT_DATE || toShanghaiIsoDate(), reportJson: process.env.REPORT_JSON_PATH || '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--date') args.date = argv[++index];
    else if (argv[index] === '--report-json') args.reportJson = argv[++index];
    else if (argv[index] !== '--force') throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || args.date !== toShanghaiIsoDate()) {
    throw new Error('Report date must be today in Asia/Shanghai; do not backdate or future-date live feeds');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const html = fs.readFileSync(indexPath, 'utf8');
  const previous = extractReport(html).report;
  const previousState = loadJson(statePath, {});
  const now = new Date();
  const checkedAt = now.toISOString();
  fs.mkdirSync(archiveDir, { recursive: true });
  const baseState = { ...previousState, schemaVersion: 2, checkedDate: args.date, lastCheckedAt: checkedAt, sourceErrors: [], error: null };
  const writeState = fields => writeJson(statePath, { ...baseState, ...fields });
  let report;
  let sourceErrors = [];
  let successfulSources = 0;
  let addedCount = 0;
  let fingerprint;
  try {
    const manual = process.env.REPORT_JSON || (args.reportJson ? fs.readFileSync(args.reportJson, 'utf8') : '');
    if (manual) {
      report = JSON.parse(manual);
      report.schemaVersion = 2;
      report.date = formatChineseDate(args.date);
      report.week = getIsoWeek(args.date);
      report.contentUpdatedAt = checkedAt;
      report.windowDays = WINDOW_DAYS;
      report.source = 'manual-report-json';
      report.fingerprint = articlesFingerprint(report.news || []);
      report.baselineNotice = '人工提供的研究报告；来源发布日期与内容更新时间分别展示。';
      fingerprint = report.fingerprint;
      addedCount = report.news?.length || 0;
      const comparable = value => JSON.stringify({ ...value, date: null, week: null, contentUpdatedAt: null });
      if (comparable(report) === comparable(previous)) {
        writeState({ date: getReportIsoDate(previous), source: previous.source, status: 'unchanged', contentUpdatedAt: previous.contentUpdatedAt, fingerprint: previous.fingerprint, newItems: 0, successfulSources: 0 });
        console.log('[daily] manual report unchanged; content date retained');
        return;
      }
    } else {
      const collected = await collectArticles();
      sourceErrors = collected.sourceErrors;
      successfulSources = collected.successfulSources;
      if (!successfulSources) throw new Error('All RSS sources failed; previous report retained');
      const articles = selectArticles(collected.items, now);
      fingerprint = articlesFingerprint(articles);
      if (previous.schemaVersion === 2 && (!articles.length || fingerprint === previous.fingerprint)) {
        writeState({ date: getReportIsoDate(previous), source: previous.source, status: articles.length ? 'unchanged' : 'no-new-items', contentUpdatedAt: previous.contentUpdatedAt, fingerprint: previous.fingerprint, newItems: 0, sourceErrors, successfulSources });
        console.log(`[daily] ${articles.length ? 'unchanged' : 'no new items'}; content date retained: ${getReportIsoDate(previous)}`);
        return;
      }
      const seenKeys = new Set(previousState.seenArticleKeys || []);
      for (const item of previous.news || []) seenKeys.add(articleKey(item));
      addedCount = articles.filter(item => !seenKeys.has(articleKey(item))).length;
      const sections = buildSections(previous, articles);
      report = {
        schemaVersion: 2, source: 'google-news-rss', fingerprint, contentUpdatedAt: checkedAt, windowDays: WINDOW_DAYS,
        date: formatChineseDate(args.date), week: getIsoWeek(args.date),
        title: articles.length ? articles.slice(0, 2).map(item => item.title).join(' + ').slice(0, 90) : '更新机制已校正，当前窗口暂无有效新线索',
        baselineNotice: '场景库是历史底稿，不代表今日进展；自动摘要仅整理来源标题，需进一步核验。',
        stats: { high: 0, scenes: sections.scenes.reduce((count, group) => count + group.items.length, 0), news: articles.length, compete: sections.competitors.length },
        summary: {
          text: articles.length ? `按来源实际发布日期筛选近 ${WINDOW_DAYS} 天的 ${articles.length} 条线索，本次首次收录 ${addedCount} 条。最新线索：${escapeHtml(articles[0].title)}。以下为自动归类，不是已核实的商业结论。` : '本次未发现符合时间和来源要求的新线索。已移除旧版错误的“近24小时”标签，保留历史场景供持续跟踪。',
          tags: [{ text: '真实发布日期', type: 'green' }, { text: '来源可追溯', type: 'blue' }, { text: '自动整理·待核验', type: 'amber' }]
        },
        news: articles.map(item => ({ ...item, summary: '来源标题线索；请阅读原文核验具体能力、开放范围和发布时间。', time: toShanghaiIsoDate(new Date(item.publishedAt)) })),
        ...sections
      };
    }
    validateReport(report);
  } catch (error) {
    writeState({ status: 'error', error: error.message, sourceErrors, successfulSources, newItems: 0 });
    throw error;
  }

  const nextHtml = replaceReport(html, report);
  fs.writeFileSync(indexPath, nextHtml);
  fs.writeFileSync(path.join(archiveDir, `${args.date}.html`), makeArchiveHtml(nextHtml));
  const archiveIndex = loadJson(archiveIndexPath, []);
  writeJson(archiveIndexPath, [{ date: args.date, title: summarizeTitle(report), stats: report.stats }, ...archiveIndex.filter(item => item.date !== args.date)].sort((left, right) => right.date.localeCompare(left.date)));
  writeState({ date: args.date, generatedAt: checkedAt, contentUpdatedAt: checkedAt, source: report.source, status: report.news.length ? 'updated' : 'no-new-items', fingerprint, newItems: addedCount, sourceErrors, successfulSources, error: null, seenArticleKeys: [...new Set([...(previousState.seenArticleKeys || []), ...report.news.map(articleKey)])].slice(-1000) });
  console.log(`[daily] content updated ${args.date}: ${report.news.length} sourced items, ${addedCount} new; ${sourceErrors.length} source errors`);
}

main().catch(error => {
  console.error(`[daily] ${error.stack || error.message}`);
  process.exit(1);
});
