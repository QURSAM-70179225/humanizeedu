// HumanizeEdu diagnostic engine — runs locally, no API needed.
// NOTE: the "AI likelihood" is a heuristic estimate of how a detector *might* react.
// It is not Turnitin/GPTZero/Copyleaks and must never be presented as their result.

const BUZZWORDS = {
  delve: 'dig', delves: 'digs', delving: 'digging',
  testament: 'proof', tapestry: 'mix', beacon: 'model',
  crucial: 'important', pivotal: 'key', paramount: 'most important',
  furthermore: 'also', moreover: 'also', additionally: 'also',
  utilize: 'use', utilizes: 'uses', utilizing: 'using', utilization: 'use',
  leverage: 'use', leverages: 'uses', leveraging: 'using',
  seamless: 'smooth', seamlessly: 'smoothly', robust: 'strong',
  multifaceted: 'complex', intricate: 'detailed', intricacies: 'details',
  realm: 'area', landscape: 'field', underscore: 'show', underscores: 'shows',
  showcase: 'show', showcases: 'shows', foster: 'build', fosters: 'builds',
  navigate: 'handle', navigating: 'handling', embark: 'start', embarks: 'starts',
  unwavering: 'steady', vibrant: 'lively', meticulous: 'careful', meticulously: 'carefully',
  commendable: 'impressive', noteworthy: 'notable', groundbreaking: 'new',
  transformative: 'major', holistic: 'overall', synergy: 'teamwork',
  plethora: 'many', myriad: 'many', endeavor: 'effort', endeavors: 'efforts',
  elevate: 'improve', elevates: 'improves', harness: 'use', unlock: 'open up',
  'ever-evolving': 'changing', 'ever-changing': 'changing', 'game-changer': 'big change',
};

const FILLER_PHRASES = [
  [/\b(is|are|was|were|stands as) a testament to\b/gi, (m) => (/^(are|were)/i.test(m) ? 'show' : 'shows')],
  [/\bthe (transformative|groundbreaking) power of\b/gi, 'the real impact of'],
  [/\bin today'?s (fast-paced|modern|digital|ever-changing) (world|society|era|age)\b,?\s*/gi, ''],
  [/\bit is (important|crucial|essential|worth) (to note|noting) that\s*/gi, ''],
  [/\bit should be noted that\s*/gi, ''],
  [/\bplays? a (crucial|pivotal|vital|key|significant) role in\b/gi, (m) => (/plays/i.test(m) ? 'matters a lot for' : 'matter a lot for')],
  [/\bin conclusion,?\s*/gi, 'Overall, '],
  [/\bin summary,?\s*/gi, 'To sum up, '],
  [/\bat the end of the day,?\s*/gi, ''],
  [/\ba wide (range|array|variety) of\b/gi, 'many'],
  [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bserves as a\b/gi, 'is a'],
  [/\bnot only (.{3,60}?) but also\b/gi, '$1 and also'],
  [/\bwhen it comes to\b/gi, 'for'],
  [/\bstands as\b/gi, 'is'],
];

const GENERIC_PATTERNS = [
  /in today'?s (fast-paced|modern|digital|ever-changing) (world|society|era|age)/i,
  /plays? a (crucial|pivotal|vital|key|significant) role/i,
  /it is (important|crucial|essential) to (note|remember|understand)/i,
  /(has|have) (revolutionized|transformed) the way/i,
  /a double-edged sword/i,
  /(since the dawn of|throughout history|from the beginning of time)/i,
  /(the possibilities are endless|only time will tell)/i,
  /(shaping|shape) the future/i,
  /in the (realm|landscape) of/i,
  /(rich|vibrant) tapestry/i,
];

const CONTRACTIONS = [
  [/\bdo not\b/g, "don't"], [/\bdoes not\b/g, "doesn't"], [/\bis not\b/g, "isn't"], [/\bare not\b/g, "aren't"],
  [/\bcannot\b/g, "can't"], [/\bwill not\b/g, "won't"], [/\bit is\b/g, "it's"], [/\bthat is\b/g, "that's"],
  [/\bthey are\b/g, "they're"], [/\bwe are\b/g, "we're"], [/\bthere is\b/g, "there's"], [/\bI am\b/g, "I'm"],
];

const CITATION_RE = /\(([A-Z][A-Za-z'\-]+( et al\.)?(,| and| &)[^)]*\d{4}[a-z]?|[A-Z][A-Za-z'\-]+ \d+)\)|\[\d+(,\s*\d+)*\]/;

// ---------- helpers ----------
const splitSentences = (t) => (t.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || []).map((s) => s.trim()).filter(Boolean);
const words = (t) => t.match(/[A-Za-z][A-Za-z'\-]*/g) || [];
function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const m = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function readability(text) {
  const s = splitSentences(text), w = words(text);
  if (!s.length || !w.length) return { grade: 0, ease: 0, avgSentence: 0, sentences: 0, words: 0 };
  const syl = w.reduce((a, x) => a + syllables(x), 0);
  const wps = w.length / s.length, spw = syl / w.length;
  return {
    grade: round(Math.max(0, 0.39 * wps + 11.8 * spw - 15.59)),
    ease: round(Math.min(100, Math.max(0, 206.835 - 1.015 * wps - 84.6 * spw))),
    avgSentence: round(wps),
    sentences: s.length,
    words: w.length,
  };
}

function burstiness(text) {
  const lens = splitSentences(text).map((s) => words(s).length).filter((n) => n > 0);
  if (lens.length < 2) return 0;
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
  return round(sd / mean, 2); // coefficient of variation; human prose is usually > 0.45
}

function findBuzzwords(text) {
  const found = {};
  for (const w of words(text)) {
    const k = w.toLowerCase();
    if (BUZZWORDS[k]) found[k] = (found[k] || 0) + 1;
  }
  return Object.entries(found).map(([word, count]) => ({ word, count, suggestion: BUZZWORDS[word] })).sort((a, b) => b.count - a.count);
}

function tone(text) {
  const w = words(text), n = Math.max(1, w.length);
  const firstPerson = w.filter((x) => /^(i|me|my|mine|we|our|us)$/i.test(x)).length / n;
  const contractions = (text.match(/\b\w+'(t|s|re|ve|ll|d|m)\b/gi) || []).length / n;
  const longWords = w.filter((x) => x.length >= 9).length / n;
  const formality = Math.round(Math.min(100, Math.max(0, 35 + longWords * 160 - contractions * 600 - firstPerson * 200)));
  let label = 'Neutral academic';
  if (formality >= 75) label = 'Very formal / robotic';
  else if (formality >= 60) label = 'Formal academic';
  else if (formality < 35) label = 'Casual / conversational';
  if (firstPerson > 0.03 && formality < 60) label = 'Personal / reflective';
  return { formality, label, firstPerson: round(firstPerson * 100), contractions: round(contractions * 100) };
}

// ---------- diagnostic report ----------
function analyze(text, citationStyle = 'APA') {
  const sentences = splitSentences(text);
  const read = readability(text);
  const burst = burstiness(text);
  const buzz = findBuzzwords(text);
  const t = tone(text);
  const totalWords = Math.max(1, read.words);

  // Heuristic AI-likelihood score (0–100)
  const buzzDensity = buzz.reduce((a, b) => a + b.count, 0) / totalWords * 100;
  const transitionStarts = sentences.filter((s) => /^(furthermore|moreover|additionally|in addition|consequently|overall|ultimately|in conclusion|notably|importantly)\b/i.test(s)).length;
  const transitionRate = sentences.length ? transitionStarts / sentences.length : 0;
  const generic = [];
  for (const s of sentences) for (const p of GENERIC_PATTERNS) if (p.test(s)) { generic.push(s); break; }

  let score = 0;
  score += Math.min(35, buzzDensity * 12);
  score += burst < 0.25 ? 25 : burst < 0.4 ? 15 : burst < 0.5 ? 6 : 0;
  score += Math.min(15, transitionRate * 60);
  score += Math.min(15, generic.length * 5);
  score += t.contractions === 0 && t.firstPerson === 0 && totalWords > 80 ? 5 : 0;
  score += read.avgSentence > 22 && burst < 0.4 ? 5 : 0;
  score = Math.round(Math.min(100, score));
  const level = score >= 60 ? 'High' : score >= 30 ? 'Medium' : 'Low';

  // Copyright / source risks
  const risks = [];
  const quotes = text.match(/["“][^"”]{12,}["”]/g) || [];
  for (const qt of quotes) {
    const idx = text.indexOf(qt);
    const after = text.slice(idx + qt.length, idx + qt.length + 60);
    if (!CITATION_RE.test(after)) risks.push({ type: 'Uncited quote', text: qt.slice(0, 120), advice: `Add an in-text citation right after this quote (${citationExample(citationStyle, true)}).` });
    if (qt.split(/\s+/).length > 40) risks.push({ type: 'Long quote', text: qt.slice(0, 120) + '…', advice: 'Quotes over 40 words need block-quote formatting in APA, or should be paraphrased.' });
  }
  for (const s of sentences) {
    if (CITATION_RE.test(s)) continue;
    if (/\b(is defined as|refers to|according to|research (shows|suggests|indicates)|studies (show|suggest|have shown)|experts (say|agree))\b/i.test(s))
      risks.push({ type: 'Claim/definition without source', text: s.slice(0, 160), advice: `Cite where this comes from: ${citationExample(citationStyle)}.` });
    else if (/\d+(\.\d+)?\s?%|\b\d{1,3}(,\d{3})+\b|\b(million|billion)\b/i.test(s))
      risks.push({ type: 'Statistic without source', text: s.slice(0, 160), advice: `Numbers need a source: ${citationExample(citationStyle)}.` });
  }

  // Plagiarism-RISK estimate (not a database match): share of words sitting in sentences that
  // look borrowed — uncited quotes, uncited definitions/statistics/claims, and stock phrasing.
  let riskWords = 0;
  const flagged = [];
  for (const s of sentences) {
    const n = words(s).length;
    const cited = CITATION_RE.test(s);
    let weight = 0, reason = '';
    if (/["“][^"”]{12,}["”]/.test(s)) { weight = cited ? 0.15 : 1; reason = cited ? 'Quoted (cited)' : 'Quoted without citation'; }
    else if (!cited && /\b(is defined as|refers to|according to|research (shows|suggests|indicates)|studies (show|suggest|have shown)|experts (say|agree))\b/i.test(s)) { weight = 0.7; reason = 'Definition or claim without source'; }
    else if (!cited && /\d+(\.\d+)?\s?%|\b\d{1,3}(,\d{3})+\b|\b(million|billion)\b/i.test(s)) { weight = 0.6; reason = 'Statistic without source'; }
    else if (GENERIC_PATTERNS.some((p) => p.test(s))) { weight = 0.45; reason = 'Common stock phrasing'; }
    if (weight) { riskWords += n * weight; flagged.push({ text: s.slice(0, 160), reason }); }
  }
  const plagScore = Math.round(Math.min(100, (riskWords / totalWords) * 100));
  const plagiarism = { score: plagScore, level: plagScore >= 35 ? 'High' : plagScore >= 15 ? 'Medium' : 'Low', flagged: flagged.slice(0, 8) };

  const originality = generic.slice(0, 6).map((s) => ({ text: s.slice(0, 160), advice: 'Generic phrasing. Replace it with your own example, data point, or opinion from your course material.' }));

  return {
    ai: { score, level, signals: { buzzwordDensity: round(buzzDensity, 2), burstiness: burst, transitionRate: round(transitionRate * 100), genericPhrases: generic.length } },
    plagiarism,
    buzzwords: buzz,
    originality,
    risks: risks.slice(0, 10),
    tone: t,
    readability: read,
  };
}

function citationExample(style, quote = false) {
  switch (style) {
    case 'MLA': return quote ? '(Author page), e.g. (Smith 42)' : '(Author page), e.g. (Smith 42)';
    case 'Chicago': return 'a footnote, or (Author Year, page) in author-date style, e.g. (Smith 2021, 42)';
    case 'IEEE': return 'a numbered reference like [1]';
    default: return quote ? '(Author, Year, p. #), e.g. (Smith, 2021, p. 42)' : '(Author, Year), e.g. (Smith, 2021)';
  }
}

// ---------- rule-based humanizer (works offline) ----------
function protect(text) {
  const vault = [];
  const out = text.replace(/["“][^"”]+["”]|\([^)]*\d{4}[^)]*\)|\[\d+(,\s*\d+)*\]/g, (m) => { vault.push(m); return `\u0000${vault.length - 1}\u0000`; });
  return { out, restore: (s) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => vault[+i]) };
}

function matchCase(src, rep) {
  if (src === src.toUpperCase() && src.length > 1) return rep.toUpperCase();
  if (src[0] === src[0].toUpperCase()) return rep[0].toUpperCase() + rep.slice(1);
  return rep;
}

function ruleHumanize(text, toneName) {
  const changes = new Set();
  const { out, restore } = protect(text);
  const paragraphs = out.split(/\n\s*\n/);
  const result = paragraphs.map((para) => {
    let p = para;
    for (const [re, rep] of FILLER_PHRASES) {
      if (re.test(p)) { changes.add('Removed filler or stock phrases'); p = p.replace(re, rep); }
      re.lastIndex = 0;
    }
    // Sentence-start transitions first (so "Furthermore," doesn't become "Also,")
    const starters = ['Also,', 'On top of that,', 'Beyond that,', 'What is more,'];
    let si = 0;
    p = p.replace(/(^|[.!?]\s+)(Furthermore|Moreover|Additionally|In addition),\s*(\w)/g, (m, pre, _w, ch) => {
      changes.add('Varied repetitive transitions');
      if (si++ % 2 === 1) return `${pre}${ch.toUpperCase()}`; // drop it every other time
      return `${pre}${starters[(si - 1) % starters.length]} ${ch}`;
    });
    p = p.replace(/[A-Za-z][A-Za-z'\-]*/g, (w) => {
      const rep = BUZZWORDS[w.toLowerCase()];
      if (!rep) return w;
      changes.add('Replaced overused AI-style vocabulary');
      return matchCase(w, rep);
    });
    // Break up very long sentences
    const sents = splitSentences(p).map((s) => {
      const n = words(s).length;
      if (n > 32) {
        const cut = s.match(/^(.{60,}?),\s+(and|but|which|while|so)\s+(.+)$/);
        if (cut) {
          changes.add('Split overly long sentences for rhythm');
          const conj = { and: '', but: 'But ', which: 'This ', while: 'Meanwhile, ', so: 'So ' }[cut[2].toLowerCase()];
          const rest = conj ? conj + cut[3] : cut[3][0].toUpperCase() + cut[3].slice(1);
          return `${cut[1]}. ${rest}`;
        }
      }
      return s;
    });
    return sents.join(' ');
  });
  let final = result.join('\n\n');
  if (toneName === 'Casual Study Group' || toneName === 'Reflective Journal') {
    for (const [re, rep] of CONTRACTIONS) if (re.test(final)) { final = final.replace(re, rep); changes.add('Added natural contractions for a relaxed tone'); }
  }
  final = final.replace(/\b([Aa]) ([aeiouAEIOU]\w*)/g, (m, a, w) => (/^(one|use|uni|eu)/i.test(w) ? m : `${a}n ${w}`));
  final = final.replace(/\s+([,.;:!?])/g, '$1').replace(/ {2,}/g, ' ').replace(/(^|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
  return { text: restore(final).trim(), changes: [...changes] };
}

module.exports = { analyze, ruleHumanize, readability, tone, splitSentences };
