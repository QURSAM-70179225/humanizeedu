const $ = (id) => document.getElementById(id);

const SAMPLE = `In today's fast-paced world, artificial intelligence plays a crucial role in education. Furthermore, AI tools can seamlessly delve into large amounts of data and provide personalized learning experiences for students. Moreover, studies show that 65% of students now use AI tools every week.

Artificial intelligence is defined as the simulation of human intelligence by machines. As one expert put it, "technology is only as good as the teacher who uses it in the classroom." In conclusion, AI is a testament to the transformative power of technology and serves as a beacon for the future of learning.`;

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const c of children) n.append(c);
  return n;
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2800);
}

function fillSelect(sel, items, selected) {
  sel.replaceChildren(...items.map((v) => el('option', { value: v, textContent: v, selected: v === selected })));
}

function setGauge(id, score, level) {
  const g = $(id);
  g.className = `gauge ${level}`;
  g.style.setProperty('--p', score);
  g.replaceChildren(el('b', {}, `${score}%`, el('small', { textContent: level.toUpperCase() })));
}

function list(target, items, empty, make) {
  $(target).replaceChildren(...(items.length ? items.map(make) : [el('li', { className: 'empty', textContent: empty })]));
}

// ---------- config ----------
fetch('/api/config').then((r) => r.json()).then((c) => {
  fillSelect($('tone'), c.tones, 'Undergraduate Essay');
  fillSelect($('level'), c.levels, 'Undergraduate');
  fillSelect($('citation'), c.styles, 'APA');
  $('engine-label').textContent = c.engine ? `Rewriting powered by ${c.engine.split(' ')[0]}.` : '';
}).catch(() => {});

// ---------- render ----------
function render(text, out) {
  const b = out.before, a = out.after;

  setGauge('g-ai-before', b.ai.score, b.ai.level);
  setGauge('g-ai-after', a.ai.score, a.ai.level);
  setGauge('g-pl-before', b.plagiarism.score, b.plagiarism.level);
  setGauge('g-pl-after', a.plagiarism.score, a.plagiarism.level);
  const aiDrop = b.ai.score - a.ai.score;
  $('ai-note').textContent = aiDrop > 0 ? `${aiDrop} points less AI-like after humanizing.` : 'Your text already read naturally.';
  $('pl-note').textContent = a.plagiarism.score >= 15
    ? 'Some risk remains, usually quotes or facts that need a citation. See the fixes below.'
    : b.plagiarism.score > a.plagiarism.score ? 'Generic, borrowed-sounding phrasing was reduced.' : 'Low risk. Keep your reference list complete.';

  $('out-original').textContent = text;
  $('out-human').textContent = out.humanized;
  $('out-engine').textContent = `Engine: ${out.engine}`;

  $('s-grade').textContent = b.readability.grade;
  $('s-ease').textContent = `Reading ease ${b.readability.ease}/100 · ${b.readability.words} words`;
  $('s-burst').textContent = b.ai.signals.burstiness;
  $('s-tone').textContent = b.tone.label;
  $('s-formal').textContent = `Formality ${b.tone.formality}/100`;
  const buzzCount = b.buzzwords.reduce((s, x) => s + x.count, 0);
  $('s-buzz').textContent = buzzCount;
  $('s-buzz-d').textContent = `${a.buzzwords.reduce((s, x) => s + x.count, 0)} left after humanizing`;

  $('buzz').replaceChildren(...(b.buzzwords.length
    ? b.buzzwords.map((w) => el('span', { className: 'chip' }, el('s', { textContent: w.word }), ` → ${w.suggestion}${w.count > 1 ? ` ×${w.count}` : ''}`))
    : [el('span', { className: 'empty', textContent: 'None found. Nice!' })]));

  list('plag', b.plagiarism.flagged, 'Nothing here looks borrowed.', (f) => el('li', {}, el('b', { textContent: f.reason }), el('q', { textContent: f.text })));
  list('risks', b.risks, 'No uncited quotes, definitions or statistics found. Still double-check your reference list.',
    (r) => el('li', { className: 'risk' }, el('b', { textContent: r.type }), el('q', { textContent: r.text }), r.advice));

  $('improve').replaceChildren(...(out.changes.length ? out.changes : ['Text already read naturally, so only light changes were needed.']).map((c) => el('li', { textContent: c })));
  const rows = [
    ['AI-generated', `${b.ai.score}%`, `${a.ai.score}%`],
    ['Plagiarism risk', `${b.plagiarism.score}%`, `${a.plagiarism.score}%`],
    ['Reading grade level', b.readability.grade, a.readability.grade],
    ['Reading ease (0–100)', b.readability.ease, a.readability.ease],
    ['Sentence variety', b.ai.signals.burstiness, a.ai.signals.burstiness],
    ['Tone', b.tone.label, a.tone.label],
    ['AI buzzwords', buzzCount, a.buzzwords.reduce((s, x) => s + x.count, 0)],
  ];
  $('metrics').replaceChildren(...rows.map((r) => el('tr', {}, ...r.map((c) => el('td', { textContent: String(c) })))));

  $('results').classList.add('show');
}

// ---------- events ----------
$('text').addEventListener('input', () => {
  const t = $('text').value;
  $('counter').textContent = `${(t.match(/\S+/g) || []).length} words · ${t.length.toLocaleString()} / 8,000 characters`;
});

$('sample-btn').addEventListener('click', () => {
  $('text').value = SAMPLE;
  $('text').dispatchEvent(new Event('input'));
});

$('check-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('text').value.trim();
  if (text.length < 40) return toast('Paste at least a few sentences first.');
  const btn = $('run-btn');
  btn.disabled = true;
  btn.replaceChildren(el('span', { className: 'spinner' }), 'Humanizing…');
  try {
    const res = await fetch('/api/humanize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, tone: $('tone').value, level: $('level').value, citation: $('citation').value }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Something went wrong. Please try again.');
    render(text, out);
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Humanize now';
  }
});

$('copy-btn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('out-human').textContent); toast('Copied to clipboard'); }
  catch { toast('Select the text and copy it manually'); }
});

$('reuse-btn').addEventListener('click', () => {
  $('text').value = $('out-human').textContent;
  $('text').dispatchEvent(new Event('input'));
  $('tool').scrollIntoView({ behavior: 'smooth' });
  $('text').focus();
});
