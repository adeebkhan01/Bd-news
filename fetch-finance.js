#!/usr/bin/env node
/**
 * Australian Economy Dashboard — Data Fetcher
 *
 * Fetches Australian economic data from free public APIs:
 * - Yahoo Finance (ASX 200, AUD/USD, commodities)
 * - RBA / ABS data via static known values updated periodically
 * - Australian financial news via RSS
 *
 * Run: node fetch-finance.js
 * Output: finance-data.json
 */

const https = require('https');
const http = require('http');
const fs = require('fs');

// ── Helpers ──────────────────────────────────────────────

function fetch(url, opts) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AUFinanceDashboard/1.0)' },
      timeout: 15000,
      ...opts
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location, opts).then(resolve, reject);
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${url}`);
  return JSON.parse(res.body);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Yahoo Finance helpers ────────────────────────────────

async function getYahooQuote(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`;
    const data = await fetchJSON(url);
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];

    const history = timestamps.map((t, i) => ({
      date: new Date(t * 1000).toISOString().split('T')[0],
      close: closes[i] != null ? Math.round(closes[i] * 100) / 100 : null
    })).filter(p => p.close != null);

    const current = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose;
    const change = current - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    return {
      value: Math.round(current * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePercent: Math.round(changePct * 100) / 100,
      previousClose: Math.round(prevClose * 100) / 100,
      asOf: new Date().toISOString().split('T')[0],
      history
    };
  } catch (e) {
    console.error(`  Yahoo error for ${symbol}:`, e.message);
    return null;
  }
}

// ── RSS Feed Parser (reused pattern from fetch.js) ───────

function parseRSSItems(xml) {
  const items = [];
  // RSS 2.0
  const rssItems = xml.split('<item>').slice(1);
  for (const raw of rssItems) {
    const tag = (name) => {
      const m = raw.match(new RegExp(`<${name}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>|<${name}[^>]*>([\\s\\S]*?)</${name}>`));
      return m ? (m[1] || m[2] || '').trim() : '';
    };
    const title = tag('title');
    const link = tag('link') || tag('guid');
    const desc = tag('description').replace(/<[^>]+>/g, '').slice(0, 300);
    const pubDate = tag('pubDate') || tag('dc:date') || tag('published');
    if (title) items.push({ title, link, snippet: desc, pubDate });
  }
  // Atom
  if (!items.length) {
    const entries = xml.split('<entry>').slice(1);
    for (const raw of entries) {
      const tag = (name) => {
        const m = raw.match(new RegExp(`<${name}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>|<${name}[^>]*>([\\s\\S]*?)</${name}>`));
        return m ? (m[1] || m[2] || '').trim() : '';
      };
      const title = tag('title');
      const linkM = raw.match(/<link[^>]+href=["']([^"']+)["']/);
      const link = linkM ? linkM[1] : tag('link');
      const desc = (tag('summary') || tag('content')).replace(/<[^>]+>/g, '').slice(0, 300);
      const pubDate = tag('published') || tag('updated');
      if (title) items.push({ title, link, snippet: desc, pubDate });
    }
  }
  return items;
}

async function fetchRSSFeed(url, sourceName) {
  try {
    const res = await fetch(url);
    if (res.status !== 200) return [];
    const items = parseRSSItems(res.body);
    return items.slice(0, 10).map(item => ({
      ...item,
      source: sourceName
    }));
  } catch (e) {
    console.error(`  RSS error (${sourceName}):`, e.message);
    return [];
  }
}

// ── Main data assembly ───────────────────────────────────

async function main() {
  console.log('Fetching Australian economy data...\n');
  const data = { fetchedAt: new Date().toISOString() };

  // 1. ASX 200
  console.log('1. ASX 200 (^AXJO)...');
  data.asx200 = await getYahooQuote('^AXJO');

  await sleep(500);

  // 2. AUD/USD
  console.log('2. AUD/USD (AUDUSD=X)...');
  data.audusd = await getYahooQuote('AUDUSD=X');

  await sleep(500);

  // 3. Commodities
  console.log('3. Commodities...');
  const commoditySymbols = [
    { symbol: 'GC=F', name: 'Gold', icon: '🥇', iconBg: '#fef9ee' },
    { symbol: 'SI=F', name: 'Silver', icon: '🥈', iconBg: '#f8f9fa' },
    { symbol: 'CL=F', name: 'Crude Oil (WTI)', icon: '🛢️', iconBg: '#f3f0f9' },
    { symbol: 'HG=F', name: 'Copper', icon: '🔶', iconBg: '#fef0e6' },
    { symbol: 'BHP.AX', name: 'BHP Group', icon: '⛏️', iconBg: '#e6f2ec' },
    { symbol: 'RIO.AX', name: 'Rio Tinto', icon: '🏗️', iconBg: '#eff6ff' }
  ];

  data.commodities = [];
  for (const c of commoditySymbols) {
    const q = await getYahooQuote(c.symbol);
    if (q) {
      data.commodities.push({
        name: c.name,
        icon: c.icon,
        iconBg: c.iconBg,
        price: q.value,
        change: q.change,
        changePercent: q.changePercent
      });
    }
    await sleep(300);
  }

  // 4. RBA Cash Rate & Economic Indicators (well-known values, updated by script)
  // These are sourced from RBA and ABS public data
  console.log('4. Economic indicators...');
  data.rbaRate = {
    value: 4.10,
    change: 0,
    asOf: '2025-02-18',
    note: 'RBA Official Cash Rate Target'
  };

  data.cpi = {
    value: 2.4,
    change: -0.5,
    period: 'Q4 2024',
    note: 'ABS Consumer Price Index, annual change'
  };

  data.gdp = {
    value: 1.5,
    change: 0.3,
    period: 'Q3 2024',
    note: 'ABS GDP annual growth'
  };

  data.unemployment = {
    value: 4.1,
    change: 0.1,
    period: 'Jan 2025',
    note: 'ABS Labour Force'
  };

  data.housing = {
    medianPrice: 1182000,
    changePercent: 4.7,
    city: 'Sydney (Median House)',
    note: 'CoreLogic Home Value Index'
  };

  data.consumerConfidence = {
    value: 92.2,
    change: 1.0,
    period: 'Feb 2025',
    note: 'Westpac-Melbourne Institute Consumer Sentiment'
  };

  // 5. Indicators table
  data.indicators = [
    { name: 'GDP Growth (Annual)', value: '1.5%', previous: '1.2%', change: 0.3, unit: '%', period: 'Q3 2024', category: 'growth' },
    { name: 'GDP Growth (Quarterly)', value: '0.3%', previous: '0.2%', change: 0.1, unit: '%', period: 'Q3 2024', category: 'growth' },
    { name: 'CPI Inflation (Annual)', value: '2.4%', previous: '2.9%', change: -0.5, unit: '%', period: 'Q4 2024', category: 'prices' },
    { name: 'Trimmed Mean CPI', value: '3.2%', previous: '3.5%', change: -0.3, unit: '%', period: 'Q4 2024', category: 'prices' },
    { name: 'RBA Cash Rate', value: '4.10%', previous: '4.35%', change: -0.25, unit: '%', period: 'Feb 2025', category: 'prices' },
    { name: 'Unemployment Rate', value: '4.1%', previous: '4.0%', change: 0.1, unit: '%', period: 'Jan 2025', category: 'labour' },
    { name: 'Participation Rate', value: '67.2%', previous: '67.1%', change: 0.1, unit: '%', period: 'Jan 2025', category: 'labour' },
    { name: 'Wage Price Index (Annual)', value: '3.5%', previous: '4.1%', change: -0.6, unit: '%', period: 'Q3 2024', category: 'labour' },
    { name: 'Trade Balance', value: 'A$5.9B', previous: 'A$4.6B', change: 1.3, unit: 'B', period: 'Dec 2024', category: 'trade' },
    { name: 'Retail Sales (Monthly)', value: '0.1%', previous: '0.5%', change: -0.4, unit: '%', period: 'Dec 2024', category: 'growth' },
    { name: 'Building Approvals', value: '-0.3%', previous: '5.0%', change: -5.3, unit: '%', period: 'Dec 2024', category: 'growth' },
    { name: 'Consumer Sentiment', value: '92.2', previous: '91.2', change: 1.0, unit: '', period: 'Feb 2025', category: 'growth' },
    { name: 'Business Confidence (NAB)', value: '4', previous: '2', change: 2, unit: '', period: 'Jan 2025', category: 'growth' },
    { name: 'PMI Manufacturing', value: '50.2', previous: '49.4', change: 0.8, unit: '', period: 'Feb 2025', category: 'growth' }
  ];

  // 6. Financial news
  console.log('5. Financial news...');
  const newsFeeds = [
    { url: 'https://www.afr.com/rss/markets', name: 'AFR' },
    { url: 'https://www.abc.net.au/news/feed/2942460/rss.xml', name: 'ABC News' },
    { url: 'https://www.smh.com.au/rss/business.xml', name: 'SMH Business' },
    { url: 'https://www.news.com.au/content-feeds/latest-news-finance/', name: 'News.com.au' }
  ];

  let allNews = [];
  for (const feed of newsFeeds) {
    const items = await fetchRSSFeed(feed.url, feed.name);
    allNews = allNews.concat(items);
    await sleep(300);
  }

  // Sort by date, deduplicate, take top 12
  allNews.sort((a, b) => {
    const da = Date.parse(a.pubDate) || 0;
    const db = Date.parse(b.pubDate) || 0;
    return db - da;
  });

  const seen = new Set();
  data.news = allNews.filter(n => {
    const key = n.title.toLowerCase().slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);

  // 7. Write output
  const outPath = __dirname + '/finance-data.json';
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`\nDone! Written to ${outPath}`);
  console.log(`  ASX 200: ${data.asx200?.value || 'N/A'}`);
  console.log(`  AUD/USD: ${data.audusd?.value || 'N/A'}`);
  console.log(`  Commodities: ${data.commodities.length}`);
  console.log(`  News articles: ${data.news.length}`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
