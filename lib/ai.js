// AI rewriting. Provider order: Groq (GROQ_API_KEY) → Gemini (GEMINI_API_KEY) → offline rule engine.
// Groq key: https://console.groq.com/keys   Gemini key: https://aistudio.google.com/apikey
const { ruleHumanize } = require('./analyzer');

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const TONES = {
  'High School Academic': 'a clear, well-organised high-school essay voice: plain vocabulary, confident but not showy',
  'Undergraduate Essay': 'a thoughtful undergraduate essay voice: precise academic vocabulary without jargon or padding',
  'Reflective Journal': 'a first-person reflective journal voice: honest, specific, allowed to use "I" and contractions',
  'Casual Study Group': 'a relaxed study-group explanation: conversational, contractions welcome, still accurate',
};

function buildPrompt(text, tone, level) {
  return `You are HumanizeEdu, an ethical writing coach for students. Revise the student's draft so it reads like a real ${level} student wrote it, in ${TONES[tone] || TONES['Undergraduate Essay']}.

Rules:
- Keep the student's argument, thesis, facts, numbers and meaning exactly the same. Do not add new facts, sources, examples or statistics.
- Keep every direct quote and every citation (e.g. (Smith, 2021), [1]) word-for-word and in place.
- Vary sentence length: mix short, direct sentences with longer ones.
- Remove stock AI vocabulary and filler: delve, testament, tapestry, crucial, pivotal, furthermore, moreover, beacon, realm, landscape, "in today's fast-paced world", "it is important to note", "in conclusion".
- Keep roughly the same length and the same paragraph breaks.
- Output ONLY the revised text. No preface, no notes, no markdown.

Student draft:
<<<
${text}
>>>`;
}

async function callGroq(prompt) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: GROQ_MODEL, temperature: 0.9, top_p: 0.95, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim();
}

async function callGemini(prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9, topP: 0.95 } }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim();
}

// Clean the model's answer, then run the offline pass to catch leftover buzzwords.
function finish(out, engine, tone) {
  const cleaned = out
    .replace(/^(here('|’)s|here is)[^\n]*:\s*\n+/i, '')
    .replace(/^<<<\s*|\s*>>>$/g, '')
    .trim();
  const polish = ruleHumanize(cleaned, tone);
  return { text: polish.text, engine, changes: ['Rewrote sentence structure and rhythm with AI, keeping meaning and citations', ...polish.changes] };
}

const activeEngine = () =>
  process.env.GROQ_API_KEY ? `Groq (${GROQ_MODEL})` : process.env.GEMINI_API_KEY ? `Gemini (${GEMINI_MODEL})` : null;

async function humanize(text, tone, level) {
  const prompt = buildPrompt(text, tone, level);
  const providers = [
    ['GROQ_API_KEY', callGroq, `Groq (${GROQ_MODEL})`],
    ['GEMINI_API_KEY', callGemini, `Gemini (${GEMINI_MODEL})`],
  ];
  for (const [envKey, call, name] of providers) {
    if (!process.env[envKey]) continue;
    try {
      const out = await call(prompt);
      if (out) return finish(out, name, tone);
      throw new Error('Empty response');
    } catch (err) {
      console.warn(`[ai] ${name} failed, trying next engine:`, err.message);
    }
  }
  const r = ruleHumanize(text, tone);
  return { text: r.text, engine: 'Offline rule engine', changes: r.changes };
}

module.exports = { humanize, TONES, activeEngine };
