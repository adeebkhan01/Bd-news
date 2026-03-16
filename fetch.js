const https   = require('https');
const http    = require('http');
const url     = require('url');
const fs      = require('fs');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SOURCES = [
  { id: 'dailystar', name: 'The Daily Star', color: '#1a7a4a', url: 'https://www.thedailystar.net/business/rss.xml' },
  { id: 'dailystar', name: 'The Daily Star', color: '#1a7a4a', url: 'https://www.thedailystar.net/frontpage/rss.xml' },
  { id: 'dailystar', name: 'The Daily Star', color: '#1a7a4a', url: 'https://www.thedailystar.net/bangladesh/rss.xml' },
  { id: 'bdnews24',         name: 'bdnews24',          color: '#e05c1a', url: 'https://bdnews24.com/?widgetName=rssfeed&widgetId=1150&getXmlFeed=true' },
  { id: 'prothomalo',       name: 'Prothom Alo',       color: '#c0392b', url: 'https://en.prothomalo.com/feed/' },
  { id: 'tbsnews',          name: 'TBS News',          color: '#2980b9', url: 'https://www.tbsnews.net/rss' },
  { id: 'financialexpress', name: 'Financial Express', color: '#8e44ad', url: 'https://thefinancialexpress.com.bd/feed/' },
  { id: 'dailysun',         name: 'Daily Sun',         color: '#16a085', url: 'https://www.daily-sun.com/rss' },
];

var UNIQUE_SOURCES = [];
var seenIds = {};
SOURCES.forEach(function(s) {
  if (!seenIds[s.id]) { seenIds[s.id] = true; UNIQUE_SOURCES.push({ id: s.id, name: s.name, color: s.color }); }
});

var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function parseDate(str) {
  if (!str) return null;
  str = str.trim();
  var t = Date.parse(str);
  if (!isNaN(t)) return t;
  str = str.replace(/\s*\([^)]+\)\s*$/, '');
  t = Date.parse(str);
  if (!isNaN(t)) return t;
  str = str.replace(/\bGMT\b/, '+0000').replace(/\bUTC\b/, '+0000')
           .replace(/\bBST\b/, '+0600').replace(/\bIST\b/, '+0530');
  t = Date.parse(str);
  if (!isNaN(t)) return t;
  return null;
}

function isRecent(pubDate) {
  var t = parseDate(pubDate);
  if (!t) return true;
  return (Date.now() - t) < THIRTY_DAYS_MS;
}

function resolveLocation(loc, from) {
  if (loc.startsWith('http://') || loc.startsWith('https://')) return loc;
  var p = url.parse(from);
  if (loc.startsWith('//')) return p.protocol + loc;
  return p.protocol + '//' + p.host + (loc.startsWith('/') ? '' : '/') + loc;
}

function fetchUrl(reqUrl, redirects) {
  redirects = redirects || 0;
  return new Promise(function(resolve, reject) {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    var lib = reqUrl.startsWith('https') ? https : http;
    var req = lib.get(reqUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml,*/*',
      },
      timeout: 15000
    }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchUrl(resolveLocation(res.headers.location, reqUrl), redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      var data = ''; res.setEncoding('utf8');
      res.on('data', function(c) { data += c; });
      res.on('end', function() { resolve(data); });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('Timeout')); });
  });
}

function fetchHead(reqUrl, redirects) {
  redirects = redirects || 0;
  return new Promise(function(resolve) {
    if (redirects > 3) return resolve('');
    var lib = reqUrl.startsWith('https') ? https : http;
    var req = lib.get(reqUrl, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0' }, timeout: 10000 }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy();
        return fetchHead(resolveLocation(res.headers.location, reqUrl), redirects + 1).then(resolve);
      }
      var data = ''; res.setEncoding('utf8');
      res.on('data', function(c) { data += c; if (data.length > 8000) res.destroy(); });
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
  return (html || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,'')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
}

function extractImg(block) {
  var ps = [/url="([^"]+\.(?:jpg|jpeg|png|webp|gif))/i, /<media:thumbnail[^>]+url="([^"]+)"/i, /<img[^>]+src="([^"]+)"/i];
  for (var i=0;i<ps.length;i++){var m=block.match(ps[i]);if(m)return m[1];}
  return null;
}

function getTag(block, tag) {
  var m = block.match(new RegExp('<'+tag+'[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</'+tag+'>', 'i'))
       || block.match(new RegExp('<'+tag+'[^>]*>([\\s\\S]*?)</'+tag+'>', 'i'));
  return m ? m[1].trim() : '';
}

function parseRSS(xml, source) {
  var items=[], re=/<item[^>]*>([\s\S]*?)<\/item>/gi, m;
  while((m=re.exec(xml))!==null && items.length<30) {
    var b=m[1], title=stripTags(getTag(b,'title'));
    if(!title) continue;
    items.push({ title, link: getTag(b,'link')||getTag(b,'guid')||'', desc: stripTags(getTag(b,'description')).slice(0,200), pubDate: getTag(b,'pubDate')||getTag(b,'dc:date')||'', img: extractImg(b), sourceId: source.id, sourceName: source.name, sourceColor: source.color });
  }
  return items;
}

function parseAtom(xml, source) {
  var items=[], re=/<entry[^>]*>([\s\S]*?)<\/entry>/gi, m;
  while((m=re.exec(xml))!==null && items.length<30) {
    var b=m[1], title=stripTags(getTag(b,'title'));
    if(!title) continue;
    var lm=b.match(/<link[^>]+href="([^"]+)"/i)||b.match(/<link[^>]*>([^<]+)<\/link>/i);
    items.push({ title, link: lm?lm[1].trim():'', desc: stripTags(getTag(b,'summary')||getTag(b,'content')).slice(0,200), pubDate: getTag(b,'published')||getTag(b,'updated')||'', img: extractImg(b), sourceId: source.id, sourceName: source.name, sourceColor: source.color });
  }
  return items;
}

function parseFeed(xml, source) {
  var a = parseRSS(xml, source);
  return a.length ? a : parseAtom(xml, source);
}

async function enrichImages(articles) {
  var missing = articles.filter(function(a) { return !a.img && a.link && a.link.startsWith('http'); });
  console.log('Fetching og:image for', missing.length, 'articles...');
  var BATCH = 5;
  for (var i=0; i<missing.length; i+=BATCH) {
    await Promise.all(missing.slice(i,i+BATCH).map(async function(a) {
      try { var html=await fetchHead(a.link); var img=extractOgImage(html); if(img) a.img=img; } catch(e) {}
    }));
  }
}

function claudeComplete(systemPrompt, userPrompt) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
    var req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 30000
    }, function(res) {
      var data = ''; res.setEncoding('utf8');
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { var json=JSON.parse(data); resolve(json.content&&json.content[0]?json.content[0].text:''); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('Claude API timeout')); });
    req.write(body);
    req.end();
  });
}

// Translate articles to Bangla
async function translateArticles(articles) {
  if (!ANTHROPIC_API_KEY || !articles.length) return;
  console.log('Translating', articles.length, 'articles to Bangla...');
  var BATCH = 5;
  for (var i=0; i<articles.length; i+=BATCH) {
    await Promise.all(articles.slice(i,i+BATCH).map(async function(a) {
      try {
        var result = await claudeComplete(
          'You are a Bengali (Bangla) translator. Translate the given English news text to Bengali. Respond ONLY with valid JSON, no markdown, no explanation.',
          'Title: '+a.title+'\nDescription: '+(a.desc||'')+'\n\n'
          + 'Return a JSON object with exactly these fields:\n'
          + '{"titleBn": "Bengali translation of the title", '
          + '"descBn": "Bengali translation of the description (or empty string if no description)"}'
        );
        var clean = result.replace(/^```[a-z]*\n?/i,'').replace(/```$/,'').trim();
        var start = clean.indexOf('{');
        var end   = clean.lastIndexOf('}');
        if (start === -1 || end === -1) throw new Error('No JSON object found in response');
        var parsed = JSON.parse(clean.slice(start, end + 1));
        a.titleBn = parsed.titleBn || null;
        a.descBn  = parsed.descBn  || '';
      } catch(e) {
        console.error('  Translation failed for "' + a.title.slice(0,40) + '":', e.message);
        a.titleBn = null;
        a.descBn  = null;
      }
    }));
    if (i+BATCH < articles.length) await new Promise(function(r){ setTimeout(r,500); });
  }
}

async function main() {
  if (!ANTHROPIC_API_KEY) console.warn('Warning: ANTHROPIC_API_KEY not set — Bangla translations will be skipped');

  // ── Load existing data.json ──
  var existingArticles = [];
  var existingByLink = {};
  if (fs.existsSync('data.json')) {
    try {
      var existing = JSON.parse(fs.readFileSync('data.json','utf8'));
      existingArticles = (existing.articles || []).filter(function(a) { return isRecent(a.pubDate); });
      existingArticles.forEach(function(a) { existingByLink[a.link] = true; });
      console.log('Loaded', existingArticles.length, 'existing articles (after 30-day prune)');
    } catch(e) { console.warn('Could not read existing data.json:', e.message); }
  }

  // ── Fetch fresh articles from feeds ──
  var freshArticles = [], seenLinks = Object.assign({}, existingByLink);
  for (var i=0; i<SOURCES.length; i++) {
    var source=SOURCES[i];
    try {
      console.log('Fetching:', source.name, '-', source.url);
      var xml=await fetchUrl(source.url);
      var articles=parseFeed(xml,source)
        .filter(function(a){ return isRecent(a.pubDate); })
        .filter(function(a){
          if(seenLinks[a.link]) return false;
          seenLinks[a.link]=true;
          return true;
        });
      console.log('  Got', articles.length, 'new articles');
      freshArticles=freshArticles.concat(articles);
    } catch(e) { console.error('  Failed:', e.message); }
  }

  // ── Translate articles missing Bangla text ──
  var needsTranslation = existingArticles.filter(function(a) { return a.titleBn === null || a.titleBn === undefined; });
  console.log(freshArticles.length, 'new articles,', needsTranslation.length, 'existing articles need translation');

  var toTranslate = freshArticles.concat(needsTranslation);
  await enrichImages(freshArticles);
  await translateArticles(toTranslate);

  // ── Merge: new articles + existing ──
  var allArticles = freshArticles.concat(existingArticles);
  allArticles.sort(function(a,b){ return (parseDate(b.pubDate)||0)-(parseDate(a.pubDate)||0); });

  var output = {
    fetchedAt: new Date().toISOString(),
    sources:   UNIQUE_SOURCES,
    articles:  allArticles
  };

  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
  console.log('Done. data.json now has', allArticles.length, 'articles (', freshArticles.length, 'new,', existingArticles.length, 'retained)');
}

main().catch(function(e){ console.error(e); process.exit(1); });
