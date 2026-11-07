// HumanizeEdu AI — zero-dependency Node.js server (Node 22+). No login, no database.
// Run locally:  npm start   →  http://localhost:8080
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { analyze } = require('./lib/analyzer');
const { humanize, TONES, activeEngine } = require('./lib/ai');

const PORT = process.env.PORT || 8080;
const PROD = process.env.NODE_ENV === 'production';
const PUBLIC = path.join(__dirname, 'public');
const MAX_BODY = 100 * 1024;
const MAX_TEXT = 8000;
const LEVELS = ['High School', 'Undergraduate', 'Postgraduate'];
const STYLES = ['APA', 'MLA', 'Chicago', 'IEEE'];
// Free public tool → limit each visitor so nobody can burn through your Groq quota.
const BUILD_DATE = new Date().toISOString().slice(0, 10);
const RATE_MAX = Number(process.env.RATE_LIMIT_PER_HOUR || 30);

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.json': 'application/json' };

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  ...(PROD ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
};

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...SECURITY_HEADERS, ...(isObj ? { 'Content-Type': 'application/json' } : {}), ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
const fail = (res, status, error) => send(res, status, { error });

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/application\/json/.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('JSON body required'), { status: 415 }));
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}

const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch { return null; } };
const GUIDES = ['avoid-false-ai-detection', 'apa-citation-guide', 'paraphrase-without-plagiarism'];

const sameOrigin = (req) => {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
};
const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, reset: now + 3600e3 };
  if (now > rec.reset) { rec.n = 0; rec.reset = now + 3600e3; }
  rec.n++; hits.set(ip, rec);
  return rec.n > RATE_MAX;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now > v.reset) hits.delete(k); }, 600e3).unref();

async function handleHumanize(req, res) {
  if (!sameOrigin(req)) return fail(res, 403, 'Cross-origin request blocked');
  if (rateLimited(clientIp(req))) return fail(res, 429, `You've reached the limit of ${RATE_MAX} checks per hour. Please try again later.`);
  const b = await readJson(req);
  const text = typeof b.text === 'string' ? b.text.replace(/\r\n/g, '\n').trim() : '';
  if (text.length < 40) return fail(res, 400, 'Paste at least a few sentences (40+ characters).');
  if (text.length > MAX_TEXT) return fail(res, 400, `Text is too long. Keep it under ${MAX_TEXT.toLocaleString()} characters.`);
  const tone = TONES[b.tone] ? b.tone : 'Undergraduate Essay';
  const citation = STYLES.includes(b.citation) ? b.citation : 'APA';
  const level = LEVELS.includes(b.level) ? b.level : 'Undergraduate';

  const before = analyze(text, citation);
  const h = await humanize(text, tone, level);
  const after = analyze(h.text, citation);
  send(res, 200, {
    humanized: h.text,
    engine: h.engine,
    changes: h.changes,
    before,
    after: { ai: after.ai, plagiarism: after.plagiarism, readability: after.readability, tone: after.tone, buzzwords: after.buzzwords },
  });
}

const PAGES = { '/': 'index.html', '/privacy': 'privacy.html', '/guides': 'guides/index.html', ...Object.fromEntries(GUIDES.map((g) => [`/guides/${g}`, `guides/${g}.html`])) };

function serveStatic(req, res, pathname) {
  const rel = PAGES[pathname] || pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return fail(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, fs.readFileSync(path.join(PUBLIC, '404.html')), { 'Content-Type': MIME['.html'] });
    const ext = path.extname(file);
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  try {
    if (pathname === '/healthz') return send(res, 200, { ok: true });
    const site = process.env.SITE_URL || `${PROD ? 'https' : 'http'}://${req.headers.host}`;
    if (pathname === '/robots.txt') return send(res, 200, `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${site}/sitemap.xml\n`, { 'Content-Type': MIME['.txt'] });
    if (pathname === '/sitemap.xml') {
      const urls = [['/', '1.0', 'weekly'], ['/guides', '0.7', 'monthly'], ...GUIDES.map((g) => [`/guides/${g}`, '0.8', 'monthly']), ['/privacy', '0.3', 'yearly']].map(([p, pr, cf]) => `  <url><loc>${site}${p}</loc><lastmod>${BUILD_DATE}</lastmod><changefreq>${cf}</changefreq><priority>${pr}</priority></url>`).join('\n');
      return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, { 'Content-Type': MIME['.xml'] });
    }
    if (pathname === '/api/config' && req.method === 'GET') return send(res, 200, { donateUrl: safeUrl(process.env.DONATE_URL), engine: activeEngine(), tones: Object.keys(TONES), styles: STYLES, levels: LEVELS, maxText: MAX_TEXT });
    if (pathname === '/api/humanize') {
      if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
      return await handleHumanize(req, res);
    }
    if (pathname.startsWith('/api/')) return fail(res, 404, 'Not found');
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method not allowed');
    serveStatic(req, res, pathname);
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error(err);
    fail(res, 500, 'Something went wrong. Please try again.');
  }
});

server.listen(PORT, () => console.log(`HumanizeEdu AI running on http://localhost:${PORT}  (AI engine: ${activeEngine() || 'offline rules'})`));
module.exports = server;
