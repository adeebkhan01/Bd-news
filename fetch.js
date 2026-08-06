const https   = require('https');
const http    = require('http');
const url     = require('url');
const fs      = require('fs');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const REGIONS = {
  bd: {
    label: 'Bangladesh',
    dataFile: 'data-bd.json',
    translate: true,
    summaryPrompt: 'You are a concise news briefing editor covering Bangladesh.',
    sources: [
      { id: 'dailystar', name: 'The Daily Star', color: '#1a7a4a', url: 'https://www.thedailystar.net/business/rss.xml' },
      { id: 'dailystar', name: 'The Daily Star', color: '#1a7a4a', url: 'https://www.thedailystar.net/frontpage/rss.xml' },
      { id: 'dailystar', name: 'The Daily Star', color: '#1a7a4a', url: 'https://www.thedailystar.net/bangladesh/rss.xml' },
      { id: 'bdnews24',         name: 'bdnews24',          color: '#e05c1a', url: 'https://bdnews24.com/?widgetName=rssfeed&widgetId=1150&getXmlFeed=true' },
      { id: 'prothomalo',       name: 'Prothom Alo',       color: '#c0392b', url: 'https://en.prothomalo.com/feed/' },
      { id: 'tbsnews',          name: 'TBS News',          color: '#2980b9', url: 'https://www.tbsnews.net/rss' },
      { id: 'financialexpress', name: 'Financial Express', color: '#8e44ad', url: 'https://thefinancialexpress.com.bd/feed/' },
      { id: 'dailysun',         name: 'Daily Sun',         color: '#16a085', url: 'https://www.daily-sun.com/rss' },
    ]
  },
  au: {
    label: 'Australia',
    dataFile: 'data-au.json',
    translate: false,
    topicFilter: false,
    summaryPrompt: 'You are a concise news briefing editor covering Australia.',
    sources: [
      { id: 'abcnews',        name: 'ABC News',              color: '#E64626', url: 'https://www.abc.net.au/news/feed/51892/rss.xml' },
      { id: 'abcnews',        name: 'ABC News',              color: '#E64626', url: 'https://www.abc.net.au/news/feed/1534/rss.xml' },
      { id: 'guardianau',     name: 'The Guardian AU',       color: '#052962', url: 'https://www.theguardian.com/australia-news/australian-politics/rss' },
      { id: 'guardianau',     name: 'The Guardian AU',       color: '#052962', url: 'https://www.theguardian.com/business/rss' },
      { id: 'guardianau',     name: 'The Guardian AU',       color: '#052962', url: 'https://www.theguardian.com/science/rss' },
      { id: 'guardianau',     name: 'The Guardian AU',       color: '#052962', url: 'https://www.theguardian.com/environment/rss' },
      { id: 'smh',            name: 'Sydney Morning Herald', color: '#0A5CA8', url: 'https://www.smh.com.au/rss/business.xml' },
      { id: 'smh',            name: 'Sydney Morning Herald', color: '#0A5CA8', url: 'https://www.smh.com.au/rss/national.xml' },
      { id: 'smh',            name: 'Sydney Morning Herald', color: '#0A5CA8', url: 'https://www.smh.com.au/rss/politics.xml' },
      { id: 'smh',            name: 'Sydney Morning Herald', color: '#0A5CA8', url: 'https://www.smh.com.au/rss/environment.xml' },
      { id: 'smh',            name: 'Sydney Morning Herald', color: '#0A5CA8', url: 'https://www.smh.com.au/rss/technology.xml' },
      { id: 'sbsnews',        name: 'SBS News',              color: '#0D1F3C', url: 'https://www.sbs.com.au/news/topic/politics/feed' },
      { id: 'sbsnews',        name: 'SBS News',              color: '#0D1F3C', url: 'https://www.sbs.com.au/news/topic/environment/feed' },
      { id: 'conversationau', name: 'The Conversation AU',   color: '#D8352A', url: 'https://theconversation.com/au/business/articles.atom' },
      { id: 'conversationau', name: 'The Conversation AU',   color: '#D8352A', url: 'https://theconversation.com/au/politics/articles.atom' },
      { id: 'conversationau', name: 'The Conversation AU',   color: '#D8352A', url: 'https://theconversation.com/au/technology/articles.atom' },
      { id: 'conversationau', name: 'The Conversation AU',   color: '#D8352A', url: 'https://theconversation.com/au/environment/articles.atom' },
    ]
  },
  global: {
    label: 'Global',
    dataFile: 'data-global.json',
    translate: false,
    topicFilter: true,
    summaryPrompt: 'You are a concise news briefing editor covering global affairs.',
    sources: [
      { id: 'bbcnews',   name: 'BBC News',    color: '#BB1919', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
      { id: 'bbcnews',   name: 'BBC News',    color: '#BB1919', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
      { id: 'bbcnews',   name: 'BBC News',    color: '#BB1919', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml' },
      { id: 'aljazeera', name: 'Al Jazeera',  color: '#D2A02E', url: 'https://www.aljazeera.com/xml/rss/economy.xml' },
      { id: 'aljazeera', name: 'Al Jazeera',  color: '#D2A02E', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
      { id: 'apnews',    name: 'AP News',     color: '#E41D13', url: 'https://apnews.com/world-news.rss' },
      { id: 'apnews',    name: 'AP News',     color: '#E41D13', url: 'https://apnews.com/business.rss' },
      { id: 'apnews',    name: 'AP News',     color: '#E41D13', url: 'https://apnews.com/science.rss' },
      { id: 'dwnews',    name: 'DW News',     color: '#002B55', url: 'https://rss.dw.com/rdf/rss-en-bus' },
      { id: 'dwnews',    name: 'DW News',     color: '#002B55', url: 'https://rss.dw.com/rdf/rss-en-eu' },
      { id: 'dwnews',    name: 'DW News',     color: '#002B55', url: 'https://rss.dw.com/xml/rss_en_science' },
      { id: 'dwnews',    name: 'DW News',     color: '#002B55', url: 'https://rss.dw.com/xml/rss_en_enviro' },
    ]
  }
};

var regionArg = 'bd';
process.argv.forEach(function(arg, i) {
  if (arg === '--region' && process.argv[i+1]) regionArg = process.argv[i+1];
});
if (!REGIONS[regionArg]) { console.error('Unknown region:', regionArg); process.exit(1); }
var REGION = REGIONS[regionArg];
var SOURCES = REGION.sources;

var UNIQUE_SOURCES = [];
var seenIds = {};
SOURCES.forEach(function(s) {
  if (!seenIds[s.id]) { seenIds[s.id] = true; UNIQUE_SOURCES.push({ id: s.id, name: s.name, color: s.color }); }
});

var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

var TOPIC_KEYWORDS = /\b(econom|business|financ|fiscal|GDP|inflation|recession|trade|tariff|market|stock|shares|invest|bank|central bank|interest rate|budget|tax|revenue|deficit|surplus|export|import|manufactur|industr|commodit|crude|oil price|mining|agricultur|startup|IPO|merger|acquisit|regulat|subsid|debt|bond|currenc|forex|bankrupt|layoff|jobs|unemploy|wage|profit|earning|airline|tech giant|politic|elect|parliament|congress|senat|president|prime minister|governor|diplomac|sanction|legislat|bill|law|polic|reform|coalition|opposit|referendum|geopolit|summit|treaty|NATO|UN |EU |ASEAN|WHO|IMF|World Bank|WTO|G7|G20|war |ceasefire|conflict|military|weapon|nuclear|missile|invasion|occupied|siege|airstrike|scienc|research|study|discover|climate|environment|carbon|emission|renewable|energy|space|NASA|AI |artificial intelligen|quantum|biotech|pharma|vaccin|genome|CRISPR|neurosci|physicist|astrono|fossil|species|biodiversit|sustainab|pandem|epidemic)\b/i;

function matchesTopic(article) {
  var text = (article.title || '') + ' ' + (article.desc || '');
  return TOPIC_KEYWORDS.test(text);
}

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

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');   // last, so &amp;lt; unwraps one layer per pass
}

// Feeds escape their markup to varying depths: some send raw HTML, some send
// it entity-encoded, some do both. Decoding before stripping (and repeating)
// is what keeps <p>, <br> and href URLs out of the copy — decoding after a
// single strip, as this used to, turns &lt;p&gt; back into a live tag.
function stripTags(html) {
  var s = String(html || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  for (var i = 0; i < 3; i++) {
    var next = decodeEntities(s).replace(/<[^>]*>/g, ' ')
      .replace(/<[^>]*$/, ' ');   // descriptions get truncated mid-tag
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, ' ').trim();
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
        if (res.statusCode !== 200) {
          return reject(new Error('Claude API error (' + res.statusCode + '): ' + data.slice(0, 300)));
        }
        try {
          var json = JSON.parse(data);
          if (json.type === 'error') {
            return reject(new Error('Claude API: ' + (json.error && json.error.message || data.slice(0, 300))));
          }
          if (!json.content || !json.content[0] || !json.content[0].text) {
            return reject(new Error('Claude API returned empty content'));
          }
          resolve(json.content[0].text);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('Claude API timeout')); });
    req.write(body);
    req.end();
  });
}

async function generatePageSummary(articles) {
  if (!ANTHROPIC_API_KEY) return null;
  console.log('Generating page summary for', REGION.label, '...');
  var titles = articles.slice(0,40).map(function(a,i){ return (i+1)+'. '+a.title; }).join('\n');
  try {
    return await claudeComplete(
      REGION.summaryPrompt + ' Write in plain prose, no bullet points, no markdown.',
      'Here are the top headlines from ' + REGION.label + ' news sources today:\n\n'+titles+'\n\nWrite a 3-4 sentence briefing summarising the key themes and most significant stories. Be direct and informative.'
    );
  } catch(e) { console.error('Page summary failed:', e.message); return null; }
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
        a.titleBn = false;
        a.descBn  = false;
      }
    }));
    if (i+BATCH < articles.length) await new Promise(function(r){ setTimeout(r,500); });
  }
}

async function main() {
  console.log('Running fetch for region:', REGION.label, '(' + regionArg + ')');
  if (!ANTHROPIC_API_KEY) console.warn('Warning: ANTHROPIC_API_KEY not set — AI summary and Bangla translations will be skipped');

  var dataFile = REGION.dataFile;

  // ── Load existing data ──
  var existingArticles = [];
  var existingByLink = {};
  var loadFile = fs.existsSync(dataFile) ? dataFile
    : (regionArg === 'bd' && fs.existsSync('data.json')) ? 'data.json' : null;
  if (loadFile) {
    try {
      var existing = JSON.parse(fs.readFileSync(loadFile,'utf8'));
      if (loadFile !== dataFile) console.log('Migrated existing articles from', loadFile);
      existingArticles = (existing.articles || []).filter(function(a) { return isRecent(a.pubDate); });
      existingArticles.forEach(function(a) {
        if (REGION.translate) {
          if (a.titleBn === null) a.titleBn = false;
          if (a.descBn === null)  a.descBn  = false;
        }
        existingByLink[a.link] = true;
      });
      console.log('Loaded', existingArticles.length, 'existing articles (after 30-day prune)');
    } catch(e) { console.warn('Could not read existing ' + loadFile + ':', e.message); }
  }

  // ── Fetch fresh articles from feeds ──
  var freshArticles = [], seenLinks = Object.assign({}, existingByLink);
  for (var i=0; i<SOURCES.length; i++) {
    var source=SOURCES[i];
    try {
      console.log('Fetching:', source.name, '-', source.url);
      var xml=await fetchUrl(source.url);
      var parsed=parseFeed(xml,source)
        .filter(function(a){ return isRecent(a.pubDate); })
        .filter(function(a){
          if(seenLinks[a.link]) return false;
          seenLinks[a.link]=true;
          return true;
        });
      var articles = REGION.topicFilter ? parsed.filter(matchesTopic) : parsed;
      var filtered = parsed.length - articles.length;
      console.log('  Got', articles.length, 'new articles' + (filtered ? ' (' + filtered + ' off-topic filtered)' : ''));
      freshArticles=freshArticles.concat(articles);
    } catch(e) { console.error('  Failed:', e.message); }
  }

  await enrichImages(freshArticles);

  if (REGION.translate) {
    var needsTranslation = existingArticles.filter(function(a) { return a.titleBn === undefined; });
    var failedTranslation = existingArticles.filter(function(a) { return a.titleBn === false; });
    console.log(freshArticles.length, 'new articles,', needsTranslation.length, 'existing need translation,', failedTranslation.length, 'previously failed (skipped)');
    var toTranslate = freshArticles.concat(needsTranslation);
    await translateArticles(toTranslate);
  } else {
    console.log(freshArticles.length, 'new articles (translation disabled for', REGION.label, ')');
  }

  // ── Merge: new articles + existing ──
  var allArticles = freshArticles.concat(existingArticles);
  allArticles.sort(function(a,b){ return (parseDate(b.pubDate)||0)-(parseDate(a.pubDate)||0); });

  // ── Generate page summary from latest headlines (skip if no new articles) ──
  var pageSummary = null;
  if (freshArticles.length > 0) {
    pageSummary = await generatePageSummary(allArticles);
  } else {
    console.log('No new articles — reusing existing summary');
    try { pageSummary = JSON.parse(fs.readFileSync(dataFile,'utf8')).summary || null; } catch(e) {}
  }

  var output = {
    fetchedAt: new Date().toISOString(),
    summary:   pageSummary,
    sources:   UNIQUE_SOURCES,
    articles:  allArticles
  };

  fs.writeFileSync(dataFile, JSON.stringify(output, null, 2));
  console.log('Done.', dataFile, 'now has', allArticles.length, 'articles (', freshArticles.length, 'new,', existingArticles.length, 'retained)');

  if (regionArg === 'bd') {
    fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
    console.log('Also wrote data.json for backward compatibility');
  }
}

main().catch(function(e){ console.error(e); process.exit(1); });
