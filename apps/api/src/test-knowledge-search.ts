#!/usr/bin/env npx tsx
/**
 * Knowledge Search Auto-Researcher
 *
 * Iteratively tests and improves the knowledge search pipeline.
 * Similar to the prior vision autoresearch sandbox pattern.
 *
 * Ground truth: queries an estimator would ask + expected content from the Mechanical Estimating Manual.
 */

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({ connectionString: "postgresql://bidwright:bidwright@localhost:5432/bidwright" });

// Simple DB helpers
async function queryRows(sql: string, params: any[] = []): Promise<any[]> {
  const { rows } = await pool.query(sql, params);
  return rows;
}

// ── Ground Truth Test Cases ──────────────────────────────────────────
// Each test case has a query the agent would use and keywords that MUST appear in the results
const TEST_CASES = [
  {
    id: "pipe-hours-carbon-steel",
    query: "carbon steel pipe welding hours per piece butt weld",
    mustContain: ["carbon steel", "butt weld", "hours"],
    shouldContainSection: "carbon steel butt weld",
    description: "Agent needs welding man-hours for carbon steel pipe",
  },
  {
    id: "pipe-threaded-fittings",
    query: "threaded pipe fittings installation hours malleable",
    mustContain: ["threaded", "fittings", "hours"],
    shouldContainSection: "threaded connection labor",
    description: "Agent needs threaded fitting install times",
  },
  {
    id: "pressure-pipe-insulation",
    query: "pipe insulation labor hours fiberglass",
    mustContain: ["insulation"],
    shouldContainSection: "insulation",
    description: "Agent needs insulation install rates",
  },
  {
    id: "equipment-setting",
    query: "equipment rigging setting anchor labor hours pump skid",
    mustContain: ["equipment", "set"],
    shouldContainSection: "",
    description: "Agent needs equipment setting man-hours",
  },
  {
    id: "fabrication-labor",
    query: "pipe fabrication labor hours per pound",
    mustContain: ["fabrication", "hours", "lb"],
    shouldContainSection: "fabrication labor",
    description: "Agent needs fabrication rates per pound",
  },
  {
    id: "pipe-support-hangers",
    query: "pipe support hanger installation hours trapeze",
    mustContain: ["support", "hanger"],
    shouldContainSection: "",
    description: "Agent needs pipe support installation rates",
  },
  {
    id: "grounding-megger",
    query: "grounding resistance testing megger ohms",
    mustContain: ["ground"],
    shouldContainSection: "",
    description: "Agent needs grounding/testing info",
  },
  {
    id: "chiller-install",
    query: "chiller installation man hours tonnage",
    mustContain: ["chiller"],
    shouldContainSection: "",
    description: "Agent needs chiller install rates",
  },
];

const GLOBAL_BOOK_ID = "kb-367c468c-9119-4bd4-b863-c8e13ea00411";

// ── Search Functions to Test ──────────────────────────────────────────

interface SearchConfig {
  name: string;
  // Scoring weights
  exactPhraseBonus: number;     // Bonus for exact phrase match
  termProximityBonus: number;   // Bonus for terms appearing close together
  sectionTitleBonus: number;    // Bonus for matching section title
  multiTermBonus: number;       // Bonus per additional matching term
  // Search tweaks
  stemTerms: boolean;           // Simple stemming (remove -ing, -tion, etc)
  expandSynonyms: boolean;      // Add domain synonyms (pipe→piping, hours→manhours)
  boostTables: boolean;         // Boost chunks containing numbers/tables
  minTermsRequired: number;     // Minimum terms that must match (fraction of total)
}

const DEFAULT_CONFIG: SearchConfig = {
  name: "baseline",
  exactPhraseBonus: 0,
  termProximityBonus: 0,
  sectionTitleBonus: 0,
  multiTermBonus: 0,
  stemTerms: false,
  expandSynonyms: false,
  boostTables: false,
  minTermsRequired: 0,
};

const DOMAIN_SYNONYMS: Record<string, string[]> = {
  pipe: ["piping", "pipes"],
  hour: ["hours", "manhour", "manhours", "man-hour", "man-hours", "hr", "hrs"],
  install: ["installation", "installing", "installed"],
  labor: ["labour", "labor"],
  weld: ["welded", "welding", "welds", "butt-weld"],
  fabricat: ["fabrication", "fabricating", "fabricate"],
  insul: ["insulation", "insulating", "insulated"],
  support: ["supports", "hanger", "hangers"],
  ground: ["grounding", "grounded"],
  carbon: ["carbon steel", "cs"],
};

function stemWord(word: string): string {
  return word
    .replace(/ing$/, "")
    .replace(/tion$/, "")
    .replace(/ment$/, "")
    .replace(/ness$/, "")
    .replace(/ated$/, "")
    .replace(/ed$/, "")
    .replace(/es$/, "")
    .replace(/s$/, "");
}

function expandTerms(terms: string[], config: SearchConfig): string[] {
  let expanded = [...terms];

  if (config.stemTerms) {
    const stemmed = terms.map(stemWord);
    expanded = [...new Set([...expanded, ...stemmed])];
  }

  if (config.expandSynonyms) {
    const extras: string[] = [];
    for (const term of terms) {
      for (const [root, synonyms] of Object.entries(DOMAIN_SYNONYMS)) {
        if (term.includes(root) || synonyms.some(s => s.includes(term) || term.includes(s))) {
          extras.push(...synonyms);
        }
      }
    }
    expanded = [...new Set([...expanded, ...extras])];
  }

  return expanded.filter(t => t.length >= 2);
}

async function searchWithConfig(query: string, config: SearchConfig, limit = 10): Promise<Array<{ id: string; text: string; sectionTitle: string; score: number }>> {
  const rawTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const terms = expandTerms(rawTerms, config);

  const chunks = await queryRows(
    `SELECT id, "bookId", "pageNumber", "sectionTitle", text, "tokenCount", "order", metadata FROM "KnowledgeChunk" WHERE "bookId" = $1`,
    [GLOBAL_BOOK_ID]
  );

  const scored = chunks.map(chunk => {
    const lowerText = chunk.text.toLowerCase();
    const lowerSection = chunk.sectionTitle.toLowerCase();
    const combined = lowerText + " " + lowerSection;

    // Base: count matching terms
    const matchingTerms = terms.filter(t => combined.includes(t));
    const matchRatio = matchingTerms.length / Math.max(terms.length, 1);

    // Skip if not enough terms match
    if (matchRatio < config.minTermsRequired) return { chunk, score: 0 };

    let score = matchRatio;

    // Multi-term bonus: more matching = disproportionately better
    if (config.multiTermBonus > 0) {
      score += config.multiTermBonus * Math.pow(matchingTerms.length, 1.5) / terms.length;
    }

    // Exact phrase bonus
    if (config.exactPhraseBonus > 0) {
      const fullQuery = query.toLowerCase();
      // Check 2-word and 3-word phrases from the query
      const words = rawTerms;
      for (let i = 0; i < words.length - 1; i++) {
        const bigram = words[i] + " " + words[i + 1];
        if (combined.includes(bigram)) score += config.exactPhraseBonus * 0.5;
        if (i < words.length - 2) {
          const trigram = bigram + " " + words[i + 2];
          if (combined.includes(trigram)) score += config.exactPhraseBonus;
        }
      }
    }

    // Section title bonus
    if (config.sectionTitleBonus > 0) {
      const sectionMatches = rawTerms.filter(t => lowerSection.includes(t));
      score += config.sectionTitleBonus * (sectionMatches.length / rawTerms.length);
    }

    // Term proximity bonus (are matching terms close together?)
    if (config.termProximityBonus > 0 && matchingTerms.length >= 2) {
      const positions = matchingTerms.map(t => combined.indexOf(t)).sort((a, b) => a - b);
      const avgGap = positions.length > 1
        ? positions.slice(1).reduce((sum, p, i) => sum + (p - positions[i]), 0) / (positions.length - 1)
        : 0;
      const proximityScore = Math.max(0, 1 - avgGap / 500); // closer = higher
      score += config.termProximityBonus * proximityScore;
    }

    // Table/numeric content boost
    if (config.boostTables) {
      const numberCount = (chunk.text.match(/\d+\.\d+/g) || []).length;
      if (numberCount > 5) score *= 1.3; // Lots of numbers = likely a data table
      if (chunk.text.includes("————") || chunk.text.includes("───")) score *= 1.2; // Table formatting
    }

    return { chunk, score };
  })
  .filter(s => s.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, limit);

  return scored.map(s => ({
    id: s.chunk.id,
    text: s.chunk.text,
    sectionTitle: s.chunk.sectionTitle,
    score: s.score,
  }));
}

// ── Evaluation ──────────────────────────────────────────────

interface TestResult {
  testId: string;
  query: string;
  resultCount: number;
  topResultRelevant: boolean;     // Does the top result contain expected keywords?
  anyResultRelevant: boolean;     // Does any top-5 result contain expected keywords?
  sectionMatch: boolean;          // Does any result match expected section title?
  avgScore: number;
  bestText: string;
}

async function evaluate(config: SearchConfig): Promise<{ score: number; results: TestResult[]; breakdown: string }> {
  const results: TestResult[] = [];

  for (const tc of TEST_CASES) {
    const hits = await searchWithConfig(tc.query, config, 10);

    const topRelevant = hits.length > 0 && tc.mustContain.every(kw =>
      hits[0].text.toLowerCase().includes(kw) || hits[0].sectionTitle.toLowerCase().includes(kw)
    );

    const anyRelevant = hits.slice(0, 5).some(h =>
      tc.mustContain.every(kw => h.text.toLowerCase().includes(kw) || h.sectionTitle.toLowerCase().includes(kw))
    );

    const sectionMatch = tc.shouldContainSection
      ? hits.slice(0, 5).some(h => h.sectionTitle.toLowerCase().includes(tc.shouldContainSection.toLowerCase()))
      : true;

    results.push({
      testId: tc.id,
      query: tc.query,
      resultCount: hits.length,
      topResultRelevant: topRelevant,
      anyResultRelevant: anyRelevant,
      sectionMatch,
      avgScore: hits.length > 0 ? hits.reduce((s, h) => s + h.score, 0) / hits.length : 0,
      bestText: hits[0]?.text?.substring(0, 100) || "(no results)",
    });
  }

  // Composite score
  const topHits = results.filter(r => r.topResultRelevant).length;
  const anyHits = results.filter(r => r.anyResultRelevant).length;
  const sectionHits = results.filter(r => r.sectionMatch).length;

  const score = (
    (topHits / results.length) * 0.5 +      // 50% weight: top result is relevant
    (anyHits / results.length) * 0.3 +       // 30% weight: any top-5 result is relevant
    (sectionHits / results.length) * 0.2     // 20% weight: section title match
  );

  const breakdown = `top1=${topHits}/${results.length} any5=${anyHits}/${results.length} section=${sectionHits}/${results.length}`;

  return { score, results, breakdown };
}

// ── Auto-Research Loop ──────────────────────────────────────

async function main() {
  console.log("🔬 Knowledge Search Auto-Researcher");
  console.log("=" .repeat(70));
  console.log(`Test cases: ${TEST_CASES.length}`);
  console.log(`Book: ${GLOBAL_BOOK_ID}`);

  // Check chunk count
  const [{ count: chunkCount }] = await queryRows(`SELECT COUNT(*)::int as count FROM "KnowledgeChunk" WHERE "bookId" = $1`, [GLOBAL_BOOK_ID]);
  console.log(`Chunks: ${chunkCount}`);
  console.log();

  // ── Iteration Configs ──
  const configs: SearchConfig[] = [
    // 1. Baseline — simple term matching (current behavior)
    { ...DEFAULT_CONFIG, name: "1-baseline" },

    // 2. Add section title bonus
    { ...DEFAULT_CONFIG, name: "2-section-title-bonus", sectionTitleBonus: 0.5 },

    // 3. Add exact phrase bonus
    { ...DEFAULT_CONFIG, name: "3-phrase-bonus", exactPhraseBonus: 0.3 },

    // 4. Section + phrase combined
    { ...DEFAULT_CONFIG, name: "4-section+phrase", sectionTitleBonus: 0.5, exactPhraseBonus: 0.3 },

    // 5. Add stemming
    { ...DEFAULT_CONFIG, name: "5-stemming", stemTerms: true },

    // 6. Add synonyms
    { ...DEFAULT_CONFIG, name: "6-synonyms", expandSynonyms: true },

    // 7. Stemming + synonyms
    { ...DEFAULT_CONFIG, name: "7-stem+syn", stemTerms: true, expandSynonyms: true },

    // 8. Everything so far
    { ...DEFAULT_CONFIG, name: "8-all-basics", sectionTitleBonus: 0.5, exactPhraseBonus: 0.3, stemTerms: true, expandSynonyms: true },

    // 9. Add table boost
    { ...DEFAULT_CONFIG, name: "9-table-boost", sectionTitleBonus: 0.5, exactPhraseBonus: 0.3, stemTerms: true, expandSynonyms: true, boostTables: true },

    // 10. Add proximity
    { ...DEFAULT_CONFIG, name: "10-proximity", sectionTitleBonus: 0.5, exactPhraseBonus: 0.3, stemTerms: true, expandSynonyms: true, boostTables: true, termProximityBonus: 0.2 },

    // 11. Multi-term bonus
    { ...DEFAULT_CONFIG, name: "11-multiterm", sectionTitleBonus: 0.5, exactPhraseBonus: 0.3, stemTerms: true, expandSynonyms: true, boostTables: true, multiTermBonus: 0.3 },

    // 12. All features
    { ...DEFAULT_CONFIG, name: "12-all-features", sectionTitleBonus: 0.5, exactPhraseBonus: 0.3, stemTerms: true, expandSynonyms: true, boostTables: true, termProximityBonus: 0.2, multiTermBonus: 0.3 },

    // 13. High section bonus
    { ...DEFAULT_CONFIG, name: "13-high-section", sectionTitleBonus: 1.0, exactPhraseBonus: 0.3, stemTerms: true, expandSynonyms: true, boostTables: true, termProximityBonus: 0.2, multiTermBonus: 0.3 },

    // 14. High phrase bonus
    { ...DEFAULT_CONFIG, name: "14-high-phrase", sectionTitleBonus: 0.5, exactPhraseBonus: 0.8, stemTerms: true, expandSynonyms: true, boostTables: true, termProximityBonus: 0.2, multiTermBonus: 0.3 },

    // 15. Minimum 2 terms required
    { ...DEFAULT_CONFIG, name: "15-min2terms", sectionTitleBonus: 0.5, exactPhraseBonus: 0.3, stemTerms: true, expandSynonyms: true, boostTables: true, termProximityBonus: 0.2, multiTermBonus: 0.3, minTermsRequired: 0.2 },

    // 16. Minimum 30% terms
    { ...DEFAULT_CONFIG, name: "16-min30pct", sectionTitleBonus: 0.5, exactPhraseBonus: 0.3, stemTerms: true, expandSynonyms: true, boostTables: true, termProximityBonus: 0.2, multiTermBonus: 0.3, minTermsRequired: 0.3 },

    // 17. High proximity
    { ...DEFAULT_CONFIG, name: "17-high-prox", sectionTitleBonus: 0.5, exactPhraseBonus: 0.3, stemTerms: true, expandSynonyms: true, boostTables: true, termProximityBonus: 0.5, multiTermBonus: 0.3 },

    // 18. High multi-term
    { ...DEFAULT_CONFIG, name: "18-high-multi", sectionTitleBonus: 0.5, exactPhraseBonus: 0.3, stemTerms: true, expandSynonyms: true, boostTables: true, termProximityBonus: 0.2, multiTermBonus: 0.6 },

    // 19. Balanced everything
    { ...DEFAULT_CONFIG, name: "19-balanced", sectionTitleBonus: 0.7, exactPhraseBonus: 0.5, stemTerms: true, expandSynonyms: true, boostTables: true, termProximityBonus: 0.3, multiTermBonus: 0.4, minTermsRequired: 0.15 },

    // 20. Conservative
    { ...DEFAULT_CONFIG, name: "20-conservative", sectionTitleBonus: 0.3, exactPhraseBonus: 0.2, stemTerms: true, expandSynonyms: false, boostTables: true, termProximityBonus: 0.1, multiTermBonus: 0.2, minTermsRequired: 0.25 },
  ];

  let bestScore = 0;
  let bestConfig = configs[0];
  let bestBreakdown = "";

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    const { score, results, breakdown } = await evaluate(config);

    const improved = score > bestScore;
    if (improved) {
      bestScore = score;
      bestConfig = config;
      bestBreakdown = breakdown;
    }

    const icon = improved ? "✅" : score === bestScore ? "➡️" : "❌";
    console.log(`${icon} [${i + 1}/${configs.length}] ${config.name}: ${(score * 100).toFixed(1)}% (${breakdown})${improved ? " ← NEW BEST" : ""}`);

    // Show per-test breakdown for notable configs
    if (improved || i === 0 || i === configs.length - 1) {
      for (const r of results) {
        const top = r.topResultRelevant ? "✓" : "✗";
        const any = r.anyResultRelevant ? "✓" : "✗";
        const sec = r.sectionMatch ? "✓" : "✗";
        console.log(`    ${top}${any}${sec} ${r.testId}: ${r.resultCount} results, best="${r.bestText.substring(0, 60)}..."`);
      }
    }
    console.log();
  }

  console.log("=" .repeat(70));
  console.log(`🏆 Best config: ${bestConfig.name}`);
  console.log(`   Score: ${(bestScore * 100).toFixed(1)}% (${bestBreakdown})`);
  console.log(`   Settings: ${JSON.stringify(bestConfig, null, 2)}`);

  await pool.end();
}

main().catch(console.error);
