const https = require('https');
const http = require('http');
const fs = require('fs');

const SOURCES = [
  { id: 'ds-frontpage',     name: 'The Daily Star',    color: '#1a7a4a', url: 'https://www.thedailystar.net/frontpage/rss.xml' },
  { id: 'ds-bangladesh',    name: 'DS: Bangladesh',    color: '#1a7a4a', url: 'https://www.thedailystar.net/bangladesh/rss.xml' },
  { id: 'ds-world',         name: 'DS: World',         color: '#1a7a4a', url: 'https://www.thedailystar.net/world/rss.xml' },
  { id: 'ds-business',      name: 'DS: Business',      color: '#1a7a4a', url: 'https://www.thedailystar.net/business/rss.xml' },
  { id: 'ds-sports',        name: 'DS: Sports',        color: '#1a7a4a', url: 'https://www.thedailystar.net/sports/rss.xml' },
  { id: 'ds-entertainment', name: 'DS: Entertainment', color: '#1a7a4a', url: 'https://www.thedailystar.net/entertainment/rss.xml' },
  { id: 'ds-lifestyle',     name: 'DS: Lifestyle',     color: '#1a7a4a', url: 'https://www.thedailystar.net/lifestyle/rss.xml' },
  { id: 'ds-opinion',       name: 'DS: Opinion',       color: '#1a7a4a', url: 'https://www.thedailystar.net/opinion/rss.xml' },
  { id: 'bdnews24',         name: 'bdnews24',          color: '#e05c1a', url: 'https://bdnews24.com/?widgetName=rssfeed&widgetId=1150&getXmlFeed=true' },
  { id: 'prothomalo',       name: 'Prothom Alo',       color: '#c0392b', url: 'https://en.prothomalo.com/feed/' },
  { id: 'dhakatribune',     name: 'Dhaka Tribune',     color: '#2980b9', url: 'https://www.dhakatribune.com/feed/' },
  { id: 'financialexpress', name: 'Financial Express', color: '#8e44ad', url: 'https://thefinancialexpress.com.bd/rss' },
  { id: 'independentbd',    name: 'The Independent',   color: '#16a085', url: 'https://theindependentbd.com/rss' },
  { id: 'bangladeshtoday',  name: 'Bangladesh Today',  color: '#d35400', url: 'https://thebangladeshtoday.com/rss' },
];

function fetchUrl(url, redirects) {
  redirects = redirects || 0;
  return new Promise(function(resolve, reject) {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    var lib = url.startsWith('https') ? https : http;
    var req = lib.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSSBot/1.0)' },
      timeout: 15000
    }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      var data = '';
      res.setEncoding('utf8');
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() { resolve(data); });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('Timeout')); });
  });
}

function stripHtml(html) {
  return (html || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

function extractImg(block) {
  var patterns = [
    /<enclosure[^>]+url="([^"]+)"[^>]+type="image/i,
    /<enclosure[^>]+type="image[^"]*"[^>]+url="([^"]+)"/i,
    /<media:content[^>]+url="([^"]+)"/i,
    /<media:thumbnail[^>]+url="([^"]+)"/i,
    /<img[^>]+src="([^"]+)"/i
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = block.match(patterns[i]);
    if (m && m[1].match(/\.(jpg|jpeg|png|webp|gif)/i)) return m[1];
  }
  return null;
}

function getCdata(block, tag) {
  var m = block.match(new RegExp('<' + tag + '[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/' + tag + '>', 'i'))
       || block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return m ? m[1].trim() : '';
}

function parseRSS(xml, source) {
  var items = [];
  var itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  var match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 15) {
    var block = match[1];
    var title = stripHtml(getCdata(block, 'title'));
    if (!title) continue;
    var link = getCdata(block, 'link') || getCdata(block, 'guid') || '';
    var desc = stripHtml(getCdata(block, 'description')).slice(0, 200);
    var pubDate = getCdata(block, 'pubDate') || getCdata(block, 'dc:date') || '';
    var img = extractImg(block);
    items.push({
      title: title, link: link, desc: desc, pubDate: pubDate, img: img,
      sourceId: source.id, sourceName: source.name, sourceColor: source.color
    });
  }
  return items;
}

async function main() {
  var results = [];
  for (var i = 0; i < SOURCES.length; i++) {
    var source = SOURCES[i];
    try {
      console.log('Fetching:', source.name, '—', source.url);
      var xml = await fetchUrl(source.url);
      var articles = parseRSS(xml, source);
      console.log('  Got', articles.length, 'articles');
      results = results.concat(articles);
    } catch(e) {
      console.error('  Failed:', e.message);
    }
  }
  results.sort(function(a, b) { return new Date(b.pubDate) - new Date(a.pubDate); });
  var output = {
    fetchedAt: new Date().toISOString(),
    sources: SOURCES.map(function(s) { return { id: s.id, name: s.name, color: s.color }; }),
    articles: results
  };
  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
  console.log('Saved', results.length, 'total articles to data.json');
}

main().catch(function(e) { console.error(e); process.exit(1); });
