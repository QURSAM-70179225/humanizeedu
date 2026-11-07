// HumanizeEdu AI — zero-dependency Node.js server (Node 22+). No login, no database.
// Run locally:  npm start   →  http://localhost:8080
//
// Optional settings (set them as Environment Variables on Render):
//   GROQ_API_KEY              AI rewriting
//   SITE_URL                  your main address, e.g. https://humanizeedu.com (default: the onrender.com address)
//   CONTACT_EMAIL             email shown on the Contact / Privacy pages
//   DONATE_URL                Buy Me a Coffee / Ko-fi link (shows ☕ Support buttons)
//   ADSENSE_CLIENT            your AdSense ID, e.g. ca-pub-1234567890123456 (turns on ads + /ads.txt)
//   GOOGLE_SITE_VERIFICATION  the content="…" value from Search Console's HTML-tag method
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
const BUILD_DATE = new Date().toISOString().slice(0, 10);
// Free public tool → limit each visitor so nobody can burn through your Groq quota.
const RATE_MAX = Number(process.env.RATE_LIMIT_PER_HOUR || 30);

const DEFAULT_SITE = 'https://humanizeedu.onrender.com';
const SITE_URL = (process.env.SITE_URL || DEFAULT_SITE).replace(/\/+$/, '');
const SITE_HOST = (() => { try { return new URL(SITE_URL).host; } catch { return ''; } })();
const ADSENSE = /^ca-pub-\d{10,20}$/.test(process.env.ADSENSE_CLIENT || '') ? process.env.ADSENSE_CLIENT : null;
const GSV = /^[\w-]{10,100}$/.test(process.env.GOOGLE_SITE_VERIFICATION || '') ? process.env.GOOGLE_SITE_VERIFICATION : null;
const CONTACT_EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(process.env.CONTACT_EMAIL || '') ? process.env.CONTACT_EMAIL : null;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.json': 'application/json' };

// Strict security policy; loosened only as far as Google AdSense needs when ads are switched on.
const CSP = ADSENSE
  ? "default-src 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; font-src https: data:; img-src 'self' data: https:; frame-src https:; connect-src 'self' https:; frame-ancestors 'none'"
  : "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'";

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': CSP,
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

// ---------- pages ----------
const PAGES = {
  '/': 'index.html', '/privacy': 'privacy.html', '/about': 'about.html', '/contact': 'contact.html', '/terms': 'terms.html',
  '/guides': 'guides/index.html', ...Object.fromEntries(GUIDES.map((g) => [`/guides/${g}`, `guides/${g}.html`])),
};
const SITEMAP = [['/', '1.0', 'weekly'], ['/guides', '0.7', 'monthly'], ...GUIDES.map((g) => [`/guides/${g}`, '0.8', 'monthly']),
  ['/about', '0.5', 'yearly'], ['/contact', '0.4', 'yearly'], ['/privacy', '0.3', 'yearly'], ['/terms', '0.3', 'yearly']];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Extra <head> tags added to every page, driven by the settings above.
const HEAD_EXTRA = [
  GSV && `<meta name="google-site-verification" content="${esc(GSV)}">`,
  ADSENSE && `<meta name="google-adsense-account" content="${ADSENSE}">`,
  ADSENSE && `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE}" crossorigin="anonymous"></script>`,
].filter(Boolean).join('\n  ');

const contactHtml = CONTACT_EMAIL
  ? `<a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a>`
  : 'the email address listed on our <a href="/contact">Contact page</a>';

const htmlCache = new Map();
function renderHtml(file) {
  if (!htmlCache.has(file) || !PROD) {
    let html = fs.readFileSync(file, 'utf8')
      .replaceAll('{{SITE_URL}}', SITE_URL)
      .replaceAll('{{CONTACT}}', contactHtml)
      .replaceAll('{{CONTACT_EMAIL}}', CONTACT_EMAIL ? esc(CONTACT_EMAIL) : 'Coming soon');
    if (HEAD_EXTRA) html = html.replace('</head>', `  ${HEAD_EXTRA}\n</head>`);
    htmlCache.set(file, html);
  }
  return htmlCache.get(file);
}

function serveStatic(req, res, pathname) {
  const rel = PAGES[pathname] || pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return fail(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, renderHtml(path.join(PUBLIC, '404.html')), { 'Content-Type': MIME['.html'] });
    const ext = path.extname(file);
    if (ext === '.html') return send(res, 200, renderHtml(file), { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- main handler ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const { pathname } = url;
  try {
    if (pathname === '/healthz') return send(res, 200, { ok: true });

    // Once you use your own domain, send visitors (and Google) from *.onrender.com to it — one address = better SEO.
    const host = (req.headers.host || '').toLowerCase();
    if (PROD && SITE_HOST && host !== SITE_HOST && host.endsWith('.onrender.com') && (req.method === 'GET' || req.method === 'HEAD') && !pathname.startsWith('/api/')) {
      return send(res, 301, '', { Location: SITE_URL + pathname + url.search });
    }

    if (pathname === '/robots.txt') return send(res, 200, `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${SITE_URL}/sitemap.xml\n`, { 'Content-Type': MIME['.txt'] });
    if (pathname === '/ads.txt') {
      if (!ADSENSE) return send(res, 404, 'Not found', { 'Content-Type': MIME['.txt'] });
      return send(res, 200, `google.com, ${ADSENSE.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`, { 'Content-Type': MIME['.txt'] });
    }
    if (pathname === '/sitemap.xml') {
      const urls = SITEMAP.map(([p, pr, cf]) => `  <url><loc>${SITE_URL}${p}</loc><lastmod>${BUILD_DATE}</lastmod><changefreq>${cf}</changefreq><priority>${pr}</priority></url>`).join('\n');
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

server.listen(PORT, () => console.log(`HumanizeEdu AI running on http://localhost:${PORT}  (AI engine: ${activeEngine() || 'offline rules'}; ads: ${ADSENSE ? 'on' : 'off'})`));
module.exports = server;
