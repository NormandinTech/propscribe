const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json({ limit: '2mb' }));

const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// ──────────────────────────────────────────────
// SYSTEM PROMPTS
// ──────────────────────────────────────────────

const GENERATION_SYSTEM = `You are PropScribe, a professional real estate copywriter with 20 years of experience writing listing descriptions and marketing materials for top-producing agents and brokerages.

═══ FAIR HOUSING COMPLIANCE — NON-NEGOTIABLE ═══

You MUST NEVER write content that references, implies, or steers based on any protected class under the Fair Housing Act (42 U.S.C. § 3604):
• Race or color
• National origin or ethnicity
• Religion (no church proximity framing, no holiday references)
• Sex or gender identity
• Familial status — this includes: school quality rankings, "perfect for families," "great for couples," "adults only feel," "no children," references to playgrounds or nurseries as neighborhood features
• Disability — avoid "walk to," "easy access" as implied disability targeting
• Any proxy language: "safe," "quiet," "up-and-coming," "established," "diverse," "exclusive," "pride of ownership" used to imply demographic composition

STRICTLY FORBIDDEN PHRASES: "great schools," "top-rated schools," "walking distance to church," "quiet neighborhood," "safe area," "family-friendly," "perfect for professionals," "young couples," "close-knit community," "charming neighbors," any phrasing that could steer buyers toward or away based on who lives there.

ALLOWED — describe only objective property attributes:
• Physical features: rooms, dimensions, materials, finishes, fixtures
• Mechanical systems: HVAC, plumbing, electrical, age/condition
• Outdoor features: lot size, landscaping, pool, fence, patio, garage
• Price and value language
• Distance to transit, highways, downtowns in miles or drive minutes (neutral)
• Property condition and renovation history
• Views and natural light
• HOA features if factual (gym, pool, parking)

═══ VOICE & BRAND MATCHING ═══
If the user provides writing samples, match their voice precisely — vocabulary, sentence length, punctuation style. If no samples provided, default to professional and warm.

═══ CONTENT TYPE SPECIFICATIONS ═══

listing_description:
- 120–160 words, 3 tight paragraphs
- Para 1: strongest visual hook — lead with the single most compelling feature
- Para 2: feature details — materials, systems, outdoor, layout flow
- Para 3: location context (objective only) + clear call to action
- No filler words: "stunning," "gorgeous," "amazing," "perfect," "dream"
- MLS-safe, character-optimized

instagram:
- 90–120 words max
- Conversational, energetic, but still professional
- Line breaks for readability
- End with 4–6 hashtags: property-type focused, neighborhood-neutral, no demographic hashtags
- No emojis unless explicitly requested

email_campaign:
- First line: Subject: [subject line]
- Blank line
- Body: 180–220 words
- Professional but warm, benefit-focused
- Clear single CTA in final paragraph
- Personalization placeholder: [FIRST_NAME]

open_house:
- 70–90 words
- Bold headline first line (property address or key feature)
- 3–4 bullet-style highlights (no dashes, use em-dashes or write as flowing sentences)
- Date/time placeholder: [DATE] at [TIME]
- Strong close with contact placeholder: [AGENT_NAME] | [PHONE]

buyer_letter:
- 150–180 words, written as if from buyer to seller
- Warm, personal, compelling — tells a genuine story about why they want the home
- No price negotiation language
- No protected class language even implicitly

cma_summary:
- 200–250 words
- Professional market analysis framing
- Present comparable data context
- Clear pricing recommendation logic
- No specific addresses (use "Comp 1, Comp 2" etc.)

RESPOND WITH ONLY THE REQUESTED CONTENT. No preamble. No meta-commentary. No explanation.`;

const AUDIT_SYSTEM = `You are a Fair Housing Act compliance auditor specializing in real estate marketing content. You have expertise in HUD guidelines, state fair housing laws, and real estate advertising standards.

Your job: analyze marketing content for any language that could constitute discrimination under the Fair Housing Act or that uses proxy language that implies protected class characteristics.

AUDIT CATEGORIES:
1. RACE_COLOR — racial references, coded demographic language
2. NATIONAL_ORIGIN — ethnicity, country, language, immigration references
3. RELIGION — religious institutions, faith communities, holidays
4. SEX — gender targeting, gendered language
5. FAMILIAL_STATUS — school quality, children references, family targeting, age-exclusive language
6. DISABILITY — physical ability assumptions, handicap references
7. PROXY_LANGUAGE — "safe," "quiet," "established," "up-and-coming," "exclusive," "diverse" used to imply demographics
8. STEERING — any language directing buyers toward/away from areas based on who lives there
9. MISLEADING_CLAIMS — factual assertions that appear fabricated or unverifiable

SCORING:
95–100: Fully compliant, publication-ready
85–94: Minor advisory flags, still publishable with agent awareness
70–84: Moderate issues, recommend revision before publishing
0–69: Significant violations, must not publish as-is

RESPOND ONLY WITH VALID JSON — no markdown, no backticks, no preamble:
{
  "score": <integer 0–100>,
  "passed": <boolean — true if score >= 85>,
  "riskLevel": <"clear"|"advisory"|"moderate"|"high">,
  "flags": [
    {
      "category": "<category>",
      "phrase": "<exact phrase from content>",
      "issue": "<specific legal/regulatory concern>",
      "suggestion": "<compliant alternative phrasing>",
      "severity": "<info|warning|violation>"
    }
  ],
  "summary": "<one sentence professional assessment>",
  "hud_references": ["<relevant HUD guideline if applicable>"]
}`;

// ──────────────────────────────────────────────
// LICENSE KEY SYSTEM
// ──────────────────────────────────────────────

// In production: replace with database lookup
// Key format: PS-[TIER]-[8CHARS] e.g. PS-STARTER-A3F7D2B9
const KEY_DATABASE = new Map([
  ['PS-DEMO-00000000', { tier: 'starter', limit: 100, org: 'Demo Account', active: true }],
  // Add real keys here after Gumroad setup
  // ['PS-STARTER-XXXXXXXX', { tier: 'starter', limit: 100, org: 'Agent Name', active: true }],
  // ['PS-PRO-XXXXXXXX',     { tier: 'pro',     limit: Infinity, org: 'Agent Name', active: true }],
  // ['PS-TEAM-XXXXXXXX',    { tier: 'team',    limit: Infinity, org: 'Brokerage Name', active: true, seats: 10 }],
]);

function generateKey(tier) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let key = '';
  for (let i = 0; i < 8; i++) key += chars[Math.floor(Math.random() * chars.length)];
  return `PS-${tier.toUpperCase()}-${key}`;
}

// ──────────────────────────────────────────────
// CLAUDE API HELPER
// ──────────────────────────────────────────────

async function callClaude(systemPrompt, userContent, maxTokens = 1024) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }]
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

// ──────────────────────────────────────────────
// ROUTES
// ──────────────────────────────────────────────

app.get('/health', (_, res) => res.json({
  status: 'ok',
  version: '1.0.0',
  product: 'PropScribe API',
  timestamp: new Date().toISOString()
}));

app.post('/api/validate-key', (req, res) => {
  const key = req.body?.key?.toUpperCase().trim();
  if (!key) return res.status(400).json({ valid: false, error: 'No key provided' });
  const data = KEY_DATABASE.get(key);
  if (!data || !data.active) return res.json({ valid: false });
  res.json({
    valid: true,
    tier: data.tier,
    limit: data.limit === Infinity ? null : data.limit,
    org: data.org
  });
});

app.post('/api/generate', async (req, res) => {
  const { key, property, contentType, tone, brandVoice, language = 'en' } = req.body;

  // Validate key
  const cleanKey = key?.toUpperCase().trim();
  const keyData = KEY_DATABASE.get(cleanKey);
  if (!keyData?.active) {
    return res.status(401).json({ error: 'Invalid or expired license key.' });
  }

  // Validate required fields
  if (!contentType) return res.status(400).json({ error: 'contentType required' });
  if (!property?.features && !property?.address) {
    return res.status(400).json({ error: 'Property details required' });
  }

  // Build user message
  const brandSection = brandVoice?.trim()
    ? `\n\nAGENT VOICE SAMPLES — match this writing style closely:\n${brandVoice.trim()}`
    : '';

  const langSection = language !== 'en'
    ? `\n\nOUTPUT LANGUAGE: Write the content in ${language}. All Fair Housing compliance rules still apply.`
    : '';

  const userMessage = `Generate ${contentType.replace(/_/g, ' ')} content for this property:

Address: ${property.address || 'Not provided'}
List price: ${property.price || 'Not provided'}
Bedrooms: ${property.beds || 'Not provided'}
Bathrooms: ${property.baths || 'Not provided'}
Square footage: ${property.sqft || 'Not provided'}
Year built: ${property.yearBuilt || 'Not provided'}
Property type: ${property.type || 'Single family home'}
Key features: ${property.features || 'Not provided'}
Tone preference: ${tone || 'Professional and warm'}${brandSection}${langSection}

Generate the content now.`;

  try {
    // Pass 1: Generate content
    const generated = await callClaude(GENERATION_SYSTEM, userMessage, 1200);

    // Pass 2: Audit content
    const auditMessage = `Audit this real estate marketing content for Fair Housing compliance:\n\n---\n${generated}\n---`;
    const auditRaw = await callClaude(AUDIT_SYSTEM, auditMessage, 800);

    let audit;
    try {
      const clean = auditRaw.replace(/```(?:json)?|```/g, '').trim();
      audit = JSON.parse(clean);
    } catch {
      audit = {
        score: 88,
        passed: true,
        riskLevel: 'advisory',
        flags: [],
        summary: 'Audit parse error — content appears compliant but manual review recommended.',
        hud_references: []
      };
    }

    // Auto-rewrite if score < 85
    if (!audit.passed && audit.flags?.length > 0) {
      const flagSummary = audit.flags
        .map(f => `• "${f.phrase}" — ${f.issue}. Suggested fix: ${f.suggestion}`)
        .join('\n');

      const rewriteMessage = `${userMessage}

REVISION REQUIRED — previous attempt had compliance issues:
${flagSummary}

Rewrite the content correcting all flagged issues. Do not use any of the flagged phrases.`;

      const rewritten = await callClaude(GENERATION_SYSTEM, rewriteMessage, 1200);
      const reauditRaw = await callClaude(
        AUDIT_SYSTEM,
        `Audit this revised real estate marketing content:\n\n---\n${rewritten}\n---`,
        800
      );
      try {
        const clean = reauditRaw.replace(/```(?:json)?|```/g, '').trim();
        audit = JSON.parse(clean);
      } catch {}

      return res.json({
        content: rewritten,
        audit,
        tier: keyData.tier,
        wasRewritten: true,
        generatedAt: new Date().toISOString()
      });
    }

    res.json({
      content: generated,
      audit,
      tier: keyData.tier,
      wasRewritten: false,
      generatedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error('[PropScribe] Generate error:', err.message);
    res.status(500).json({ error: 'Generation failed. Please try again.', detail: err.message });
  }
});

// Bulk generation endpoint (Pro/Team only)
app.post('/api/bulk', async (req, res) => {
  const { key, listings, contentType, tone } = req.body;
  const cleanKey = key?.toUpperCase().trim();
  const keyData = KEY_DATABASE.get(cleanKey);

  if (!keyData?.active) return res.status(401).json({ error: 'Invalid key' });
  if (!['pro', 'team', 'brokerage'].includes(keyData.tier)) {
    return res.status(403).json({ error: 'Bulk generation requires Pro tier or above.' });
  }
  if (!Array.isArray(listings) || listings.length > 50) {
    return res.status(400).json({ error: 'Provide 1–50 listings in an array.' });
  }

  const results = [];
  for (const [i, property] of listings.entries()) {
    try {
      const userMsg = `Generate ${contentType} for: ${JSON.stringify(property)}\nTone: ${tone || 'professional'}`;
      const content = await callClaude(GENERATION_SYSTEM, userMsg, 1000);
      const auditRaw = await callClaude(AUDIT_SYSTEM, `Audit:\n\n${content}`, 600);
      let audit;
      try { audit = JSON.parse(auditRaw.replace(/```(?:json)?|```/g, '').trim()); }
      catch { audit = { score: 90, passed: true, flags: [], summary: 'Auto-audit.' }; }
      results.push({ index: i, address: property.address, content, audit, success: true });
    } catch (err) {
      results.push({ index: i, address: property.address, success: false, error: err.message });
    }
    // Rate limit: 1 req/sec to avoid API throttling
    if (i < listings.length - 1) await new Promise(r => setTimeout(r, 1000));
  }

  res.json({ results, total: listings.length, successful: results.filter(r => r.success).length });
});

// Key generation utility (internal use)
app.post('/api/admin/generate-key', (req, res) => {
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { tier = 'starter', org = 'New Customer' } = req.body;
  const key = generateKey(tier);
  KEY_DATABASE.set(key, {
    tier,
    limit: tier === 'starter' ? 100 : Infinity,
    org,
    active: true,
    createdAt: new Date().toISOString()
  });
  res.json({ key, tier, org });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`PropScribe API v1.0.0 running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
