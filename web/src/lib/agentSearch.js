// ============================================================================
// Backstop agent search — an instant, intent-aware ranker for the marketplace.
//
// Goals: feel "AI-smart" (understands synonyms, intent and typos) while running
// entirely client-side in well under a millisecond for the whole shelf — no
// network round-trip, no latency, works offline. The cleverness is in the
// index, not a model call: each agent is expanded with domain-concept synonyms
// derived from its own metadata, then queries are scored with weighted,
// fuzzy, typo-tolerant field matching.
// ============================================================================

/* ----------------------------------------------------------------- normalize */
const DIACRITIC = /[̀-ͯ]/g
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(DIACRITIC, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
const tokenize = (s) => {
  const n = norm(s)
  return n ? n.split(' ').filter((t) => t && !STOP.has(t)) : []
}
// tiny stop-list so "an agent to protect me from scams" keys on the content words
const STOP = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'me', 'my', 'i', 'and', 'or', 'with', 'that',
  'can', 'that', 'who', 'which', 'something', 'agent', 'agents', 'help', 'need', 'want',
  'looking', 'find', 'is', 'are', 'it', 'on', 'in', 'from', 'please', 'show', 'get',
])

/* ------------------------------------------------- Damerau-Levenshtein (≤2) */
// Bounded edit distance — we only ever care about "is this a typo?" so we early-out.
function editDistance(a, b, max = 2) {
  const al = a.length
  const bl = b.length
  if (Math.abs(al - bl) > max) return max + 1
  let prev = new Array(bl + 1)
  let cur = new Array(bl + 1)
  for (let j = 0; j <= bl; j++) prev[j] = j
  for (let i = 1; i <= al; i++) {
    cur[0] = i
    let best = cur[0]
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (cur[j] < best) best = cur[j]
    }
    if (best > max) return max + 1 // whole row already exceeds budget → bail
    ;[prev, cur] = [cur, prev]
  }
  return prev[bl]
}

/* -------------------------------------------------------- domain concepts */
// Each concept is attached to an agent when ANY of its anchor words appears in
// the agent's own metadata. Its `expand` terms then become low-weight synonyms
// in that agent's index — so "refund scam" finds the fraud guardian even though
// neither word is in its copy, and "rebalance my 401k" finds the trader.
const CONCEPTS = [
  {
    id: 'fraud',
    anchors: ['fraud', 'scam', 'safety', 'guardian', 'bill', 'payment', 'phishing', 'defender'],
    expand: ['scam', 'scams', 'phishing', 'refund', 'chargeback', 'stolen', 'identity', 'theft', 'spam',
      'suspicious', 'wire', 'payment', 'payments', 'invoice', 'invoices', 'secure', 'security', 'protect',
      'protection', 'block', 'freeze', 'defend', 'defense', 'impersonation', 'vishing', 'spoof', 'fake',
      'guard', 'safe', 'money', 'bank', 'transfer'],
  },
  {
    id: 'bots',
    anchors: ['bot', 'bots', 'scraper', 'scraping', 'crawler', 'traffic', 'web'],
    expand: ['bot', 'bots', 'scraper', 'scrapers', 'scraping', 'crawler', 'crawlers', 'takeover', 'credential',
      'stuffing', 'ddos', 'traffic', 'captcha', 'fingerprint', 'automation', 'signup', 'signups', 'abuse',
      'fake', 'accounts', 'ratelimit', 'rate', 'limit', 'defense', 'protect', 'block'],
  },
  {
    id: 'travel',
    anchors: ['travel', 'trip', 'flight', 'hotel', 'booking', 'itinerary', 'wander'],
    expand: ['travel', 'trip', 'trips', 'flight', 'flights', 'fly', 'hotel', 'hotels', 'vacation', 'holiday',
      'getaway', 'booking', 'book', 'itinerary', 'destination', 'destinations', 'airfare', 'rental', 'stay',
      'beach', 'weekend', 'abroad'],
  },
  {
    id: 'trading',
    anchors: ['trading', 'trade', 'portfolio', 'invest', 'stock', 'market', 'quant'],
    expand: ['trade', 'trading', 'stock', 'stocks', 'invest', 'investing', 'investment', 'portfolio', 'rebalance',
      'rebalancing', 'crypto', 'bitcoin', 'equities', 'market', 'markets', 'finance', 'financial', 'money',
      'wealth', 'allocation', 'risk', 'hedge', 'buy', 'sell', '401k', 'retirement'],
  },
  {
    id: 'research',
    anchors: ['research', 'paper', 'study', 'cite', 'knowledge', 'scholar', 'analysis'],
    expand: ['research', 'paper', 'papers', 'study', 'studies', 'cite', 'citation', 'citations', 'literature',
      'source', 'sources', 'analysis', 'analyse', 'analyze', 'summarize', 'summary', 'summarise', 'knowledge',
      'fact', 'facts', 'evidence', 'report', 'brief', 'briefing', 'reading', 'learn', 'explain'],
  },
  {
    id: 'tickets',
    anchors: ['ticket', 'tickets', 'event', 'concert', 'show', 'seats', 'encore'],
    expand: ['ticket', 'tickets', 'concert', 'concerts', 'event', 'events', 'show', 'shows', 'seat', 'seats',
      'festival', 'festivals', 'gig', 'sports', 'game', 'games', 'tour', 'venue', 'resale', 'presale',
      'scalper', 'scalping', 'courtside', 'floor'],
  },
]

/* -------------------------------------------------------- build an index doc */
const capText = (caps) =>
  (caps || [])
    .map((c) => (typeof c === 'string' ? c : `${c?.name || ''} ${c?.description || ''}`))
    .join(' ')

// Weighted fields — matching the NAME matters far more than matching the maker.
export function indexAgent(l) {
  const typeWords = norm(l.use_case_type).replace(/[-_]/g, ' ')
  const cap = capText(l.capabilities)
  const base = `${l.name} ${l.category} ${typeWords} ${l.tagline || ''} ${l.blurb || ''} ${cap}`
  const baseNorm = norm(base)

  // attach domain-concept synonyms, but ONLY when an anchor fires in the agent's
  // IDENTITY fields (name / category / purpose). This keeps precision: a travel
  // agent whose tagline says "scam-checked" does not inherit the whole fraud
  // vocabulary — only the actual fraud guardian does.
  const idNorm = norm(`${l.name} ${l.category} ${typeWords}`)
  const related = []
  for (const c of CONCEPTS) {
    if (c.anchors.some((a) => idNorm.includes(a))) related.push(...c.expand)
  }

  const fields = [
    { key: 'name', w: 13, toks: tokenize(l.name) },
    { key: 'category', w: 7, toks: tokenize(l.category) },
    { key: 'type', w: 6, toks: tokenize(typeWords) },
    { key: 'does', w: 6, toks: tokenize(cap) },
    { key: 'tagline', w: 5, toks: tokenize(l.tagline) },
    { key: 'about', w: 4, toks: tokenize(l.blurb) },
    { key: 'maker', w: 3, toks: tokenize(l.developer) },
    { key: 'model', w: 2, toks: tokenize((l.model || '').split('/').pop()) },
    { key: 'related', w: 3.5, toks: Array.from(new Set(related)) },
  ].filter((f) => f.toks.length)

  return { l, fields, nameNorm: norm(l.name), hay: `${baseNorm} ${related.join(' ')}` }
}

/* ------------------------------------------------- one query-token vs a field */
// Returns a match strength in [0,1] for the best field-token the query token hits.
function tokenFieldStrength(q, ftoks) {
  let best = 0
  for (const f of ftoks) {
    let m = 0
    if (f === q) m = 1
    else if (q.length >= 2 && f.startsWith(q)) m = 0.9 // "trad" → "trading"
    else if (f.length >= 2 && q.startsWith(f)) m = 0.72 // "tickets" typed, field "ticket"
    else if (f.length >= 4 && q.length >= 4 && f.includes(q)) m = 0.6
    else if (q.length >= 4 && f.length >= 4) {
      // compute with budget 2 so the >budget sentinel (3) never collides with a real "2"
      const d = editDistance(q, f, 2)
      if (d === 1) m = 0.6
      else if (d === 2 && q.length >= 7) m = 0.4 // only tolerate 2 edits on longer words
    }
    if (m > best) best = m
    if (best === 1) break
  }
  return best
}

/* --------------------------------------------------------------- rank agents */
// Returns [{ l, score, reasons:Set<fieldKey>, coverage }], best first.
export function rankAgents(list, query) {
  const qNorm = norm(query)
  if (!qNorm) return []
  const qToks = tokenize(query)
  // if the query is ALL stop-words (e.g. "an agent for me"), fall back to raw tokens
  const terms = qToks.length ? qToks : norm(query).split(' ').filter(Boolean)
  if (!terms.length) return []

  const out = []
  for (const l of list) {
    const doc = l.__idx || (l.__idx = indexAgent(l))
    let score = 0
    let covered = 0
    const reasons = new Set()

    for (const q of terms) {
      let tokenBest = 0
      let bestField = null
      for (const f of doc.fields) {
        const s = tokenFieldStrength(q, f.toks) * f.w
        if (s > tokenBest) {
          tokenBest = s
          bestField = f.key
        }
      }
      if (tokenBest > 0) {
        score += tokenBest
        covered++
        if (bestField && bestField !== 'related') reasons.add(bestField)
        else if (bestField === 'related') reasons.add('related')
      }
    }

    if (score <= 0) continue

    // phrase & prefix bonuses — a direct hit on the name should always win
    if (doc.nameNorm === qNorm) score += 40
    else if (doc.nameNorm.startsWith(qNorm)) score += 16
    else if (doc.hay.includes(qNorm) && qNorm.length >= 3) score += 6

    const coverage = covered / terms.length
    // keep: a strong single hit, OR decent multi-term coverage, OR a phrase hit
    const phraseHit = doc.hay.includes(qNorm) && qNorm.length >= 3
    if (coverage < 0.5 && score < 9 && !phraseHit) continue

    const finalScore = score * (0.55 + 0.45 * coverage)
    if (finalScore < 2 && !phraseHit) continue // drop faint single-field noise
    out.push({ l, score: finalScore, reasons, coverage })
  }

  out.sort((a, b) => b.score - a.score || (b.l.grade?.score ?? 0) - (a.l.grade?.score ?? 0))
  return out
}

// Human label for why an agent matched — a subtle "AI understood you" signal.
const REASON_LABEL = { name: 'name', category: 'category', type: 'purpose', does: 'what it does', tagline: 'summary', about: 'description', maker: 'maker', model: 'model', related: 'related intent' }
export function reasonText(reasons) {
  const order = ['name', 'does', 'type', 'category', 'tagline', 'about', 'related', 'maker', 'model']
  const picked = order.filter((k) => reasons.has(k)).slice(0, 2).map((k) => REASON_LABEL[k])
  return picked.length ? `matched on ${picked.join(' · ')}` : ''
}
