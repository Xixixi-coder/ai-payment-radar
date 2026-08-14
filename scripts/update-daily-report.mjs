#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  extractReport,
  formatChineseDate,
  getIsoWeek,
  loadJson,
  makeArchiveHtml,
  replaceReport,
  summarizeTitle,
  syncStaticPlaceholders,
  toShanghaiIsoDate,
  validateReport,
  writeJson
} from './report-utils.mjs';

const root = process.cwd();
const indexPath = path.join(root, 'index.html');
const archiveDir = path.join(root, 'archive');
const archiveIndexPath = path.join(archiveDir, 'index.json');

function parseArgs(argv) {
  const args = {
    date: process.env.REPORT_DATE || toShanghaiIsoDate(),
    force: false,
    reportJson: process.env.REPORT_JSON_PATH || '',
    allowFallback: process.env.ALLOW_RSS_FALLBACK === '1'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--date') args.date = argv[++index];
    else if (arg === '--report-json') args.reportJson = argv[++index];
    else if (arg === '--force') args.force = true;
    else if (arg === '--allow-fallback') args.allowFallback = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error(`--date must be YYYY-MM-DD, got ${args.date}`);
  }
  return args;
}

function decodeXml(value = '') {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'");
}

function stripHtml(value = '') {
  return decodeXml(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'ai-payment-radar-daily-updater/1.0' }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseRssItems(xml, queryName) {
  const items = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = match[1];
    const title = stripHtml((body.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
    const link = stripHtml((body.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
    const source = stripHtml((body.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]) || queryName;
    const pubDate = stripHtml((body.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]);
    const cleanTitle = title.replace(/\s+-\s+[^-]+$/, '').trim();
    if (cleanTitle) items.push({ title: cleanTitle, source, link, pubDate, queryName });
  }
  return items;
}

async function collectRssItems() {
  const queries = [
    ['AI支付/智能体支付', 'AI支付 智能体支付 支付宝 阿宝 银联 京东'],
    ['Agentic Payments', 'agentic payments AI payment Visa Mastercard Stripe PayPal'],
    ['场景入口', 'WAIC 2026 支付宝 AI开放平台 碰一下 Agent 支付'],
    ['车载/线下支付', '银联 智谱 座舱 支付 Agent 车载 AI支付']
  ];
  const allItems = [];
  for (const [name, query] of queries) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
    try {
      const xml = await fetchText(url);
      allItems.push(...parseRssItems(xml, name));
    } catch (error) {
      console.warn(`[rss] ${name} failed: ${error.message}`);
    }
  }
  const seen = new Set();
  return allItems.filter(item => {
    const relevant = /(支付|payment|payments|pay|checkout|commerce|visa|mastercard|stripe|paypal|银联|支付宝|微信支付|银行卡|稳定币)/i.test(item.title)
      && /(ai|智能体|agent|agentic|阿宝|mcp|大模型|机器人)/i.test(item.title);
    if (!relevant) return false;
    const key = item.title.toLowerCase().replace(/\W+/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildReportFromRss(isoDate, previousReport, rssItems, allowFallback) {
  const selected = rssItems.slice(0, 8);
  if (selected.length < 3 && !allowFallback) {
    throw new Error(`Only ${selected.length} RSS items collected; refusing to generate a weak daily report`);
  }

  const safeItems = selected.length >= 3 ? selected : [
    { title: '公开新闻源不足，日报进入更新链路自检模式', source: '自动化链路', queryName: '链路自检' },
    { title: '请补充当日AI支付、智能体支付与竞品动态素材', source: '自动化链路', queryName: '素材待补' },
    { title: '历史页面与归档索引仍会被校验，避免静默断更', source: '自动化链路', queryName: '健康检查' }
  ];

  const dateText = formatChineseDate(isoDate);
  const topTitles = safeItems.slice(0, 3).map(item => item.title);
  const title = topTitles.join('+').slice(0, 56);
  const news = safeItems.slice(0, 8).map(item => ({
    title: item.title,
    summary: `公开新闻源捕捉到「${item.title}」。请重点核验其是否涉及智能体授权、商户接入、风控责任链或线下/车载支付触点。`,
    source: item.source || item.queryName || 'Google News RSS',
    time: '近24小时'
  }));

  const reusedScenes = structuredClone(previousReport.scenes || []);
  const sceneCount = reusedScenes.reduce((count, group) => count + (group.items || []).length, 0) || previousReport.stats?.scenes || 12;
  const competitors = structuredClone(previousReport.competitors || []).map((item, index) => {
    if (index > 2) return item;
    const headline = safeItems[index]?.title;
    return headline ? { ...item, desc: `${item.desc}；本期继续跟踪：${headline}` } : item;
  });

  return {
    title,
    date: dateText,
    week: getIsoWeek(isoDate),
    stats: { high: 3, scenes: sceneCount, news: news.length, compete: competitors.length || previousReport.stats?.compete || 5 },
    summary: {
      text: `今日自动扫描公开新闻源，AI支付与智能体支付仍围绕<strong>授权、风控、商户接入与场景入口</strong>展开。重点线索包括：<span class='highlight'>${topTitles[0]}</span>；${topTitles[1] || '海外Agentic Payments持续推进'}；${topTitles[2] || '线下与车载支付触点继续演进'}。京东AI付应把素材复核、A2P2协议样板和场景落地节奏合并推进。`,
      tags: [
        { text: '公开RSS自动扫描', type: 'red' },
        { text: '授权与风控责任链', type: 'amber' },
        { text: '商户/场景接入', type: 'blue' },
        { text: 'A2P2样板复核', type: 'green' }
      ]
    },
    news,
    opportunities: [
      {
        level: 'high',
        scene: 'AI专属卡/授权账户入口',
        reason: `围绕「${topTitles.find(title => /微信支付|专属卡|支付巨头/.test(title)) || topTitles[0]}」，支付巨头正在把AI支付能力前置到用户账户与授权入口。`,
        action: '在京东支付内设计“AI付授权卡”：用户可设置限额、品类、商户白名单与权益包，优先绑定白条、小金库和银行卡。',
        value: '账户级'
      },
      {
        level: 'high',
        scene: 'A2P2电商订单托管支付',
        reason: 'Agentic Payments竞争正在从“会聊天”转向“可授权、可追溯、可结算”的交易基础设施。',
        action: '优先做家电/3C/商超补货三类托管下单样板，覆盖预算授权、比价、下单、支付、售后追踪全链路。',
        value: '战略级'
      },
      {
        level: 'high',
        scene: '线下/车载即时消费入口',
        reason: `围绕「${topTitles.find(title => /车载|座舱|碰一下|线下/.test(title)) || '线下/车载AI支付'}」，线下设备、车载座舱与本地生活是AI助手从推荐走向代办并支付的高频入口。`,
        action: '联合京东到家、七鲜、京东养车/加油做PoC，把“到店/车内唤起AI助手→推荐→确认→支付”跑通。',
        value: '千万级/日'
      }
    ],
    scenes: reusedScenes,
    competitors,
    suggestions: [
      '<strong>【账户入口】</strong>把AI付做成用户可理解、可控的授权账户，而不是后台策略：限额、品类、商户白名单必须前台可见。',
      `<strong>【订单托管】</strong>围绕「${topTitles[0]}」拆一个电商代办交易样板，优先证明AI能安全完成“推荐到支付”。`,
      '<strong>【场景闭环】</strong>线下/车载PoC不要只做唤起演示，必须跑通履约、退款、风控和客服兜底。'
    ]
  };
}

function normalizeManualReport(isoDate, report) {
  const normalized = structuredClone(report);
  normalized.date = normalized.date || formatChineseDate(isoDate);
  normalized.week = normalized.week || getIsoWeek(isoDate);
  normalized.stats = normalized.stats || {};
  normalized.stats.news = normalized.stats.news || normalized.news?.length || 0;
  normalized.stats.compete = normalized.stats.compete || normalized.competitors?.length || 0;
  normalized.stats.scenes = normalized.stats.scenes || normalized.scenes?.reduce((sum, group) => sum + (group.items || []).length, 0) || 0;
  normalized.stats.high = normalized.stats.high || normalized.opportunities?.filter(item => item.level === 'high').length || 0;
  return normalized;
}

function updateArchiveIndex(isoDate, report) {
  const items = loadJson(archiveIndexPath, []);
  const nextItem = {
    date: isoDate,
    title: summarizeTitle(report),
    stats: report.stats
  };
  const merged = [nextItem, ...items.filter(item => item.date !== isoDate)]
    .sort((left, right) => right.date.localeCompare(left.date));
  writeJson(archiveIndexPath, merged);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const html = fs.readFileSync(indexPath, 'utf8');
  const { report: previousReport } = extractReport(html);
  const archivePath = path.join(archiveDir, `${args.date}.html`);
  const archiveIndex = loadJson(archiveIndexPath, []);

  if (!args.force && archiveIndex[0]?.date === args.date && fs.existsSync(archivePath)) {
    fs.writeFileSync(indexPath, syncStaticPlaceholders(html, previousReport));
    console.log(`[daily] ${args.date} already exists; no new report generated`);
    return;
  }

  let report;
  if (process.env.REPORT_JSON) {
    report = normalizeManualReport(args.date, JSON.parse(process.env.REPORT_JSON));
  } else if (args.reportJson) {
    report = normalizeManualReport(args.date, JSON.parse(fs.readFileSync(args.reportJson, 'utf8')));
  } else {
    const rssItems = await collectRssItems();
    report = buildReportFromRss(args.date, previousReport, rssItems, args.allowFallback);
  }

  validateReport(report);
  const nextHtml = replaceReport(html, report);
  fs.writeFileSync(indexPath, nextHtml);
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(archivePath, makeArchiveHtml(nextHtml));
  updateArchiveIndex(args.date, report);
  writeJson(path.join(archiveDir, 'last-updated.json'), {
    date: args.date,
    generatedAt: new Date().toISOString(),
    source: process.env.REPORT_JSON || args.reportJson ? 'manual-report-json' : 'google-news-rss'
  });
  console.log(`[daily] generated ${args.date}: ${summarizeTitle(report)}`);
}

main().catch(error => {
  console.error(`[daily] ${error.stack || error.message}`);
  process.exit(1);
});
