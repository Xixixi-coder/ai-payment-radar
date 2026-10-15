import { createHash } from 'node:crypto';

export const WINDOW_DAYS = 7;

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function stripHtml(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
      const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/&(lt|gt|amp|quot|apos|#39);/g, entity => ({ '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'" })[entity])
    .replace(/\s+/g, ' ').trim();
}

export function parseRssItems(xml) {
  if (!/<rss\b/i.test(xml)) throw new Error('Source did not return an RSS feed');
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)].map(match => {
    const field = name => stripHtml((match[1].match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`)) || [])[1]);
    return { title: field('title').replace(/\s+-\s+[^-]+$/, '').trim(), link: field('link'), source: field('source'), pubDate: field('pubDate') };
  });
}

export function articleKey(item) {
  return item.title.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, '');
}

export function selectArticles(items, now = new Date()) {
  const cutoff = now.getTime() - WINDOW_DAYS * 86400000;
  const seenTitles = new Set();
  const seenLinks = new Set();
  const sourceCounts = new Map();
  let cryptoCount = 0;
  const candidates = items.map(item => ({ ...item, timestamp: Date.parse(item.pubDate) }))
    .filter(item => item.title && item.source && /^https?:\/\//i.test(item.link)
      && item.timestamp >= cutoff && item.timestamp <= now.getTime()
      && !/(girlfriend|boyfriend|nsfw|casino|presale|price prediction|\b\d+x\b|币价预测|预售代币|\bSEO\b|real estate)/i.test(item.title)
      && !/^(openPR\.com|Universidad de Córdoba)/i.test(item.source)
      && /(支付|payment|pay|checkout|commerce|visa|mastercard|stripe|paypal|稳定币|交易)/i.test(item.title)
      && /(\bai\b|AI支付|AI版|人工智能|智能体|agent|阿宝|mcp|大模型|机器人|自动支付)/i.test(item.title))
    .sort((left, right) => right.timestamp - left.timestamp || left.title.localeCompare(right.title))
    .filter(item => {
      const key = articleKey(item);
      const sourceCount = sourceCounts.get(item.source) || 0;
      const crypto = /crypto|stablecoin|x402|\bXRP\b|XRPL|Ripple|TRON|区块链|稳定币|币价|加密货币/i.test(item.title);
      if (!key || seenTitles.has(key) || seenLinks.has(item.link) || sourceCount >= 4 || (crypto && cryptoCount >= 4)) return false;
      seenTitles.add(key);
      seenLinks.add(item.link);
      sourceCounts.set(item.source, sourceCount + 1);
      if (crypto) cryptoCount += 1;
      return true;
    });
  const chinese = candidates.filter(item => /\p{Script=Han}/u.test(item.title)).slice(0, 6);
  const international = candidates.filter(item => !/\p{Script=Han}/u.test(item.title)).slice(0, 6);
  const chosen = [...chinese, ...international];
  for (const item of candidates) {
    if (chosen.length >= 12) break;
    if (!chosen.includes(item)) chosen.push(item);
  }
  return chosen.sort((left, right) => right.timestamp - left.timestamp || left.title.localeCompare(right.title))
    .map(item => ({ title: item.title, source: item.source, link: item.link, publishedAt: new Date(item.timestamp).toISOString() }));
}

export function articlesFingerprint(items) {
  const normalized = items.map(item => [articleKey(item), item.link, item.publishedAt, item.source]).sort((left, right) => left[0].localeCompare(right[0]));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export async function collectArticles() {
  const queries = [
    ['中文支付', '("AI支付" OR "智能体支付" OR "人工智能支付") when:7d', 'zh-CN', 'CN', 'CN:zh-Hans'],
    ['国际支付', '("agentic payments" OR "agentic commerce" OR "AI payments") when:7d', 'en-US', 'US', 'US:en'],
    ['终端与场景', '(机器人 OR 车载 OR 点餐 OR 购物) ("AI" OR "智能体") 支付 when:7d', 'zh-CN', 'CN', 'CN:zh-Hans'],
    ['支付厂商', '(Stripe OR Visa OR Mastercard OR PayPal) ("agentic payments" OR "AI payments" OR "payment protocol") when:7d', 'en-US', 'US', 'US:en']
  ];
  const results = await Promise.all(queries.map(async ([name, query, language, country, edition]) => {
    try {
      const url = new URL('https://news.google.com/rss/search');
      url.search = new URLSearchParams({ q: query, hl: language, gl: country, ceid: edition });
      const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'ai-payment-radar/2.0' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { name, items: parseRssItems(await response.text()) };
    } catch (error) {
      return { name, error: error.message, items: [] };
    }
  }));
  return { items: results.flatMap(result => result.items), successfulSources: results.filter(result => !result.error).length, sourceErrors: results.filter(result => result.error).map(result => `${result.name}: ${result.error}`) };
}

const scenePatterns = [
  ['快餐茶饮', /咖啡|瑞幸|茶饮|肯德基|麦当劳|coffee|restaurant/i],
  ['电商平台', /电商|购物|京东|淘宝|天猫|commerce|shopping|checkout|amazon|shopify/i],
  ['出行车载', /车载|汽车|座舱|出行|打车|停车|充电|vehicle|mobility/i],
  ['线下零售', /零售|超市|便利店|售货|收银|机器人|retail|robot/i],
  ['游戏娱乐', /游戏|直播|音乐|娱乐|充值|gaming|music/i],
  ['酒旅生活', /酒店|机票|旅游|外卖|点餐|预订|travel|hotel|booking/i]
];

const competitorPatterns = [
  ['支付宝', /支付宝|蚂蚁|阿宝|alipay|ant international/i],
  ['微信', /微信|腾讯|wechat|tencent/i],
  ['Stripe', /stripe|privy/i],
  ['银联', /银联|unionpay/i],
  ['Visa', /\bvisa\b/i],
  ['Mastercard', /mastercard|万事达/i],
  ['PayPal', /paypal/i]
];

export function buildSections(previous, articles) {
  const observations = pattern => articles.filter(item => pattern.test(item.title));
  const scenes = (previous.scenes || []).map(group => {
    const pattern = scenePatterns.find(([name]) => group.name.includes(name))?.[1];
    return { ...group, baselineNotice: '历史场景底稿（未重新核验）；以下来源线索不代表已落地。', observations: pattern ? observations(pattern) : [], items: group.items.map(item => ({ ...item, desc: item.desc.replace(/本期无新动态[。]?/g, '').trim() })) };
  });
  const competitors = competitorPatterns.map(([name, pattern]) => {
    const previousItem = (previous.competitors || []).find(item => item.name.includes(name));
    return { name, icon: previousItem?.icon || '💳', desc: '仅列出本次窗口内标题提及该主体的来源线索；合作角色及具体能力需阅读原文核验。', observations: observations(pattern) };
  });
  const opportunities = scenes.filter(group => group.observations.length).map(group => ({
    level: 'mid', scene: `${group.name} · 待核验线索`,
    reason: `本次窗口内有 ${group.observations.length} 条来源标题涉及该场景，尚不能据此认定商业落地。`,
    action: '阅读来源，确认服务入口、授权方式及交易闭环后再评估优先级。', value: '待核验'
  }));
  return { scenes, competitors, opportunities, suggestions: [
    `<strong>【素材核验】</strong>本次整理 ${articles.length} 条近 ${WINDOW_DAYS} 天内来源线索。标题摘要不是完整研究结论，请沿来源链接核验原文。`,
    '<strong>【场景跟踪】</strong>历史底稿单独标识；只有匹配到新来源的场景才展示窗口内动态，没有新证据不改写为新结论。',
    '<strong>【接入评估】</strong>优先核验真实开放接口、商户接入、用户授权及履约退款条件，再决定是否推进合作。'
  ] };
}
