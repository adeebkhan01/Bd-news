const https = require('https');
const http  = require('http');
const url   = require('url');
const fs    = require('fs');

const SOURCES = [
  { id: 'dailystar', name: 'The Daily Star', color: '#1a7a4a', url: 'https://www.thedailystar.net/business/rss.xml' },
  { id: 'dailystar', name: 'The Daily Star', color: '#1a7a4a', url: 'https://www.thedailystar.net/frontpage/rss.xml' },
  { id: 'dailystar', name: 'The Daily Star', color: '#1a7a4a', url: 'https://www.thedailystar.net/bangladesh/rss.xml' },
  { id: 'bdnews24',         name: 'bdnews24',          color: '#e05c1a', url: 'https://bdnews24.com/?widgetName=rssfeed&widgetId=1150&getXmlFeed=true' },
  { id: 'prothomalo',       name: 'Prothom Alo',       color: '#c0392b', url: 'https://en.prothomalo.com/feed/' },
  { id: 'newagebd',         name: 'New Age',           color: '#2980b9', url: 'https://www.newagebd.net/rss' },
  { id: 'financialexpress', name: 'Financial Express', color: '#8e44ad', url: 'https://thefinancialexpress.com.bd/feed/' },
  { id: 'independentbd',    name: 'The Independent',   color: '#16a085', url: 'https://theindependentbd.com/feed/' },
  { id: 'bangladeshtoday',  name: 'Bangladesh Today',  color: '#d35400', url: 'https://www.thebangladeshtoday.com/feed/' },
];

var UNIQUE_SOURCES = [];
var seenIds = {};
SOURCES.forEach(function(s) {
  if (!seenIds[s.id]) {
    seenIds[s.id] = true;
    UNIQUE_SOURCES.push({ id: s.id, name: s.name, color: s.color });
  }
});

var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function isRecent(pubDate) {
  if (!pubDate) return false;
  var t = Date.parse(pubDate);
  if (!t) return false;
  return (Date.now() - t) < THIRTY_DAYS_MS;
}

function resolveLocation(location, fromUrl) {
  if (location.startsWith('http://') || location.startsWith('https://')) return location;
  var parsed = url.parse(fromUrl);
  if (location.startsWith('//')) return parsed.protocol + location;
  return parsed.protocol + '//' + parsed.host + (location.startsWith('/') ? '' : '/') + location;
}

function fetchUrl(requestUrl, redirects) {
  redirects = redirects || 0;
  return new Promise(function(resolve, reject) {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    var lib = requestUrl.startsWith('https') ? https : http;
    var req = lib.get(requestUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml,*/*',
      },
      timeout: 15000
    }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        var next = resolveLocation(res.headers.location, requestUrl);
        res.resume();
        return fetchUrl(next, redirects + 1).then(resolve).catch(reject);
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

// Fetch only the first 8kb of a page — enough to find the og:image in <head>
function fetchHead(requestUrl) {
  return new Promise(function(resolve) {
    var lib = requestUrl.startsWith('https') ? https : http;
    var req = lib.get(requestUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 10000
    }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy();
        return fetchHead(resolveLocation(res.headers.location, requestUrl)).then(resolve);
      }
      var data = '';
      res.setEncoding('utf8');
      res.on('data', function(chunk) {
        data += chunk;
        // Stop reading once we have enough to find og:image
        if (data.length > 8000) res.destroy();
      });
      res.on('end',  function() { resolve(data); });
      res.on('close',function() { resolve(data); });
      res.on('error',function() { resolve(data); });
    });
    req.on('error',   function() { resolve(''); });
    req.on('timeout', function() { req.destroy(); resolve(''); });
  });
}

function extractOgImage(html) {
  var m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
       || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m ? m[1] : null;
}

function stripTags(html) {
  return (html || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractImg(block) {
  var patterns = [
    /url="([^"]+\.(?:jpg|jpeg|png|webp|gif))/i,
    /<media:thumbnail[^>]+url="([^"]+)"/i,
    /<img[^>]+src="([^"]+)"/i,
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = block.match(patterns[i]);
    if (m) return m[1];
  }
  return null;
}

function getTag(block, tag) {
  var m = block.match(new RegExp('<' + tag + '[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/' + tag + '>', 'i'))
       || block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return m ? m[1].trim() : '';
}

function parseRSS(xml, source) {
  var items = [];
  var re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  var m;
  while ((m = re.exec(xml)) !== null && items.length < 30) {
    var b = m[1];
    var title = stripTags(getTag(b, 'title'));
    if (!title) continue;
    items.push({
      title:       title,
      link:        getTag(b, 'link') || getTag(b, 'guid') || '',
      desc:        stripTags(getTag(b, 'description')).slice(0, 200),
      pubDate:     getTag(b, 'pubDate') || getTag(b, 'dc:date') || '',
      img:         extractImg(b),
      sourceId:    source.id,
      sourceName:  source.name,
      sourceColor: source.color,
    });
  }
  return items;
}

function parseAtom(xml, source) {
  var items = [];
  var re = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  var m;
  while ((m = re.exec(xml)) !== null && items.length < 30) {
    var b = m[1];
    var title = stripTags(getTag(b, 'title'));
    if (!title) continue;
    var linkMatch = b.match(/<link[^>]+href="([^"]+)"/i) || b.match(/<link[^>]*>([^<]+)<\/link>/i);
    items.push({
      title:       title,
      link:        linkMatch ? linkMatch[1].trim() : '',
      desc:        stripTags(getTag(b, 'summary') || getTag(b, 'content')).slice(0, 200),
      pubDate:     getTag(b, 'published') || getTag(b, 'updated') || '',
      img:         extractImg(b),
      sourceId:    source.id,
      sourceName:  source.name,
      sourceColor: source.color,
    });
  }
  return items;
}

function parseFeed(xml, source) {
  var articles = parseRSS(xml, source);
  if (!articles.length) articles = parseAtom(xml, source);
  return articles;
}

// Fetch og:image for articles missing one, in batches to avoid hammering servers
async function enrichImages(articles) {
  var missing = articles.filter(function(a) { return !a.img && a.link && a.link.startsWith('http'); });
  console.log('Fetching og:image for', missing.length, 'articles missing images...');

  var BATCH = 5; // fetch 5 at a time
  for (var i = 0; i < missing.length; i += BATCH) {
    var batch = missing.slice(i, i + BATCH);
    await Promise.all(batch.map(async function(a) {
      try {
        var html = await fetchHead(a.link);
        var img  = extractOgImage(html);
        if (img) a.img = img;
      } catch(e) {
        // silently skip — image just won't show
      }
    }));
  }
}

async function main() {
  var results = [];
  var seen = {};

  for (var i = 0; i < SOURCES.length; i++) {
    var source = SOURCES[i];
    try {
      console.log('Fetching:', source.name, '-', source.url);
      var xml = await fetchUrl(source.url);
      var articles = parseFeed(xml, source)
        .filter(function(a) { return isRecent(a.pubDate); })
        .filter(function(a) {
          if (seen[a.link]) return false;
          seen[a.link] = true;
          return true;
        });
      console.log('  Got', articles.length, 'recent articles');
      results = results.concat(articles);
    } catch(e) {
      console.error('  Failed:', e.message);
    }
  }

  // Scrape og:image for articles missing one
  await enrichImages(results);

  results.sort(function(a, b) { return new Date(b.pubDate) - new Date(a.pubDate); });

  var output = {
    fetchedAt: new Date().toISOString(),
    sources:   UNIQUE_SOURCES,
    articles:  results
  };

  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
  console.log('Done. Saved', results.length, 'articles to data.json');
}

main().catch(function(e) { console.error(e); process.exit(1); });
