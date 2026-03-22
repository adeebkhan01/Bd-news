#!/usr/bin/env node
/**
 * Australian Economy Dashboard — Data Fetcher
 *
 * Fetches Australian economic data from free public APIs:
 * - Yahoo Finance (ASX 200, AUD/USD, commodities, sector stocks)
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

// Lightweight: just get price + changePercent for a stock
async function getStockQuote(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
    const data = await fetchJSON(url);
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    const current = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose;
    const changePct = prevClose ? ((current - prevClose) / prevClose) * 100 : 0;
    return {
      price: Math.round(current * 100) / 100,
      changePercent: Math.round(changePct * 100) / 100
    };
  } catch (e) {
    console.error(`  Stock quote error for ${symbol}:`, e.message);
    return null;
  }
}

// ── RSS Feed Parser ──────────────────────────────────────

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

// ── Sector definitions (ASX sector → top stocks) ─────────

const SECTOR_STOCKS = {
  'Financials':              ['CBA.AX', 'WBC.AX', 'ANZ.AX', 'NAB.AX'],
  'Materials':               ['BHP.AX', 'RIO.AX', 'FMG.AX', 'MIN.AX'],
  'Health Care':             ['CSL.AX', 'COH.AX', 'RMD.AX', 'SHL.AX'],
  'Consumer Discretionary':  ['WES.AX', 'HVN.AX', 'JBH.AX', 'ALL.AX'],
  'Industrials':             ['TCL.AX', 'BXB.AX', 'SYD.AX', 'QAN.AX'],
  'Real Estate':             ['GMG.AX', 'SGP.AX', 'GPT.AX', 'MGR.AX'],
  'Consumer Staples':        ['WOW.AX', 'COL.AX', 'TWE.AX', 'A2M.AX'],
  'Energy':                  ['WDS.AX', 'STO.AX', 'ORG.AX', 'WHC.AX'],
  'Information Technology':  ['XRO.AX', 'WTC.AX', 'CPU.AX', 'APX.AX'],
  'Communication Services':  ['TLS.AX', 'REA.AX', 'CAR.AX', 'NWS.AX'],
  'Utilities':               ['AGL.AX', 'APA.AX', 'ORG.AX', 'MEZ.AX']
};

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

  // 4. Sector stocks
  console.log('4. ASX Sectors (11 sectors, ~44 stocks)...');
  data.sectors = [];
  for (const [sectorName, symbols] of Object.entries(SECTOR_STOCKS)) {
    const stocks = [];
    for (const sym of symbols) {
      const q = await getStockQuote(sym);
      const ticker = sym.replace('.AX', '');
      if (q) {
        stocks.push({ name: ticker, price: q.price, changePercent: q.changePercent });
      } else {
        stocks.push({ name: ticker, price: 0, changePercent: 0 });
      }
      await sleep(200);
    }
    const avgChange = stocks.length
      ? Math.round((stocks.reduce((s, st) => s + st.changePercent, 0) / stocks.length) * 100) / 100
      : 0;
    data.sectors.push({ name: sectorName, changePercent: avgChange, stocks });
    console.log(`   ${sectorName}: ${avgChange > 0 ? '+' : ''}${avgChange}%`);
  }

  // 5. RBA Cash Rate & Economic Indicators (well-known values, updated by script)
  console.log('5. Economic indicators...');
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
    note: 'CoreLogic Home Value Index',
    cities: [
      { city: 'Sydney', median: 1182000, changePercent: 4.7, rentalYield: 2.8, auctionClearance: 68, priceToIncome: 13.2, daysOnMarket: 28 },
      { city: 'Melbourne', median: 935000, changePercent: 1.2, rentalYield: 3.1, auctionClearance: 62, priceToIncome: 10.5, daysOnMarket: 33 },
      { city: 'Brisbane', median: 872000, changePercent: 11.8, rentalYield: 3.6, auctionClearance: 55, priceToIncome: 8.9, daysOnMarket: 22 },
      { city: 'Perth', median: 785000, changePercent: 18.4, rentalYield: 4.2, auctionClearance: 48, priceToIncome: 7.1, daysOnMarket: 18 },
      { city: 'Adelaide', median: 762000, changePercent: 14.3, rentalYield: 3.8, auctionClearance: 72, priceToIncome: 8.2, daysOnMarket: 24 },
      { city: 'Hobart', median: 668000, changePercent: -0.8, rentalYield: 4.0, auctionClearance: 45, priceToIncome: 9.1, daysOnMarket: 38 },
      { city: 'Canberra', median: 955000, changePercent: 1.5, rentalYield: 3.4, auctionClearance: 58, priceToIncome: 7.8, daysOnMarket: 31 },
      { city: 'Darwin', median: 530000, changePercent: 2.1, rentalYield: 5.8, auctionClearance: 38, priceToIncome: 5.4, daysOnMarket: 42 }
    ]
  };

  data.consumerConfidence = {
    value: 92.2,
    change: 1.0,
    period: 'Feb 2025',
    note: 'Westpac-Melbourne Institute Consumer Sentiment'
  };

  // 6. RBA Rate Decision History
  data.rbaHistory = [
    { date: 'Feb 2025', rate: 4.10, change: -0.25, note: 'First cut since Nov 2020 — CPI back within 2–3% target band' },
    { date: 'Dec 2024', rate: 4.35, change: 0, note: 'Held steady; board noted disinflation progressing' },
    { date: 'Nov 2024', rate: 4.35, change: 0, note: 'Held; trimmed mean CPI still above target' },
    { date: 'Sep 2024', rate: 4.35, change: 0, note: 'Held; watching services inflation persistence' },
    { date: 'Aug 2024', rate: 4.35, change: 0, note: 'Held; acknowledged slowing growth' },
    { date: 'Jun 2024', rate: 4.35, change: 0, note: 'Held; inflation sticky but rate hike ruled out' },
    { date: 'May 2024', rate: 4.35, change: 0, note: 'Held; CPI surprised to upside in Q1' },
    { date: 'Mar 2024', rate: 4.35, change: 0, note: 'Held; easing bias introduced' },
    { date: 'Feb 2024', rate: 4.35, change: 0, note: 'Held; inflation declining but not fast enough' },
    { date: 'Nov 2023', rate: 4.35, change: 0.25, note: 'Final hike of cycle; CPI re-accelerated in Q3' }
  ];

  // 7. Indicators table
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

  // 8. Financial news
  console.log('6. Financial news...');
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

  // 9. Write output
  const outPath = __dirname + '/finance-data.json';
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`\nDone! Written to ${outPath}`);
  console.log(`  ASX 200: ${data.asx200?.value || 'N/A'}`);
  console.log(`  AUD/USD: ${data.audusd?.value || 'N/A'}`);
  console.log(`  Commodities: ${data.commodities.length}`);
  console.log(`  Sectors: ${data.sectors.length}`);
  console.log(`  News articles: ${data.news.length}`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
