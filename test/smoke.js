// End-to-end smoke test: npm test
process.env.PORT = '0';
process.env.RATE_LIMIT_PER_HOUR = '5';
delete process.env.GEMINI_API_KEY;
delete process.env.GROQ_API_KEY;
const server = require('../server');
const assert = require('node:assert');

server.on('listening', async () => {
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, p, body, headers = {}) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
  };
  try {
    assert.equal((await call('GET', '/')).status, 200);
    assert.equal((await call('GET', '/privacy')).status, 200);
    assert.equal((await call('GET', '/login')).status, 404, 'no login page');
    assert.ok((await call('GET', '/api/config')).body.tones.length === 4);
    assert.equal((await call('POST', '/api/humanize', { text: 'too short' })).status, 400);

    const text = 'In today\'s fast-paced world, technology plays a crucial role in education. Furthermore, it is a testament to human creativity. Moreover, research shows that 70% of students use AI tools. As one author put it, "teachers matter more than any device in the room" and that matters.';
    const a = await call('POST', '/api/humanize', { text, tone: 'Undergraduate Essay', citation: 'APA' });
    assert.equal(a.status, 200);
    const { before, after } = a.body;
    assert.ok(before.ai.score > after.ai.score, 'AI % drops');
    assert.ok(before.plagiarism.score >= after.plagiarism.score, 'plagiarism risk does not rise');
    assert.ok(before.plagiarism.score > 0 && before.plagiarism.flagged.length > 0, 'risk flagged');
    assert.ok(a.body.humanized.includes('"teachers matter more than any device in the room"'), 'quote preserved');

    assert.equal((await call('POST', '/api/humanize', { text }, { origin: 'https://evil.com' })).status, 403, 'cross-origin blocked');
    for (let i = 0; i < 5; i++) await call('POST', '/api/humanize', { text });
    assert.equal((await call('POST', '/api/humanize', { text })).status, 429, 'rate limit');
    assert.ok((await call('GET', '/sitemap.xml')).body.includes('<urlset'));
    for (const g of ['/guides', '/guides/avoid-false-ai-detection', '/guides/apa-citation-guide', '/guides/paraphrase-without-plagiarism'])
      assert.equal((await call('GET', g)).status, 200, g);
    assert.ok((await call('GET', '/sitemap.xml')).body.includes('/guides/apa-citation-guide'), 'guides in sitemap');
    assert.equal((await call('GET', '/api/config')).body.donateUrl, null, 'donate hidden by default');
    for (const pg of ['/about', '/contact', '/privacy', '/terms']) {
      const r = await call('GET', pg);
      assert.equal(r.status, 200, pg);
      assert.ok(!r.body.includes('{{'), `no leftover placeholders on ${pg}`);
    }
    assert.ok((await call('GET', '/')).body.includes('<link rel="canonical" href="https://humanizeedu.onrender.com/">'), 'canonical filled in');
    assert.equal((await call('GET', '/ads.txt')).status, 404, 'no ads.txt until AdSense is set');
    assert.ok(!(await call('GET', '/')).body.includes('adsbygoogle'), 'no ad script by default');

    console.log('✅ All smoke tests passed');
    console.log(`AI: ${before.ai.score}% → ${after.ai.score}%   Plagiarism risk: ${before.plagiarism.score}% → ${after.plagiarism.score}%`);
    console.log('Rewrite: ' + a.body.humanized);
  } catch (e) { console.error('❌', e); process.exitCode = 1; }
  server.close(); process.exit();
});
