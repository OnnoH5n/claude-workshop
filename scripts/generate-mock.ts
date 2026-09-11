// Generates data/seed.json — a mocked Java repository portfolio standing in for
// SonarQube, Checkmarx, Sonatype Lifecycle and plain-text repo analysis.
//
// Deterministic by design: a seeded PRNG means the demo shows byte-identical data
// on every run, so a rehearsal matches the live presentation.
//
// NOTE: the Spring Boot / Java support states below are ILLUSTRATIVE mock values
// chosen to exercise the UI. They are not a source of truth for real EOL dates.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeRisk } from '../server/risk.ts';
import type {
  Checkmarx,
  HistoryPoint,
  Portfolio,
  Repo,
  RepoAnalysis,
  Severity,
  SonarGate,
  SonarQube,
  SonarRating,
  Sonatype,
  SupportState,
  Tier,
  Totals,
} from '../shared/types.ts';

/** mulberry32 — small, fast, seeded. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = prng(20260911);
const int = (min: number, max: number): number => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const chance = (p: number): boolean => rand() < p;

const LATEST_SPRING_BOOT = '3.5';

// Illustrative support ladder. `behind` = minor releases behind LATEST_SPRING_BOOT.
const SPRING_BOOT: Array<{ version: string; support: SupportState; behind: number }> = [
  { version: '3.5', support: 'supported', behind: 0 },
  { version: '3.4', support: 'supported', behind: 1 },
  { version: '3.3', support: 'oss-ended', behind: 2 },
  { version: '3.2', support: 'eol', behind: 3 },
  { version: '3.1', support: 'eol', behind: 4 },
  { version: '2.7', support: 'eol', behind: 8 },
];
// Weighted so the portfolio has a realistic laggard tail rather than a flat spread.
const SPRING_BOOT_WEIGHTS = [10, 12, 8, 6, 4, 4];

const JAVA = [
  { version: '21', lts: true },
  { version: '17', lts: true },
  { version: '11', lts: true },
  { version: '22', lts: false },
  { version: '8', lts: true },
];

const REPOS: Array<[string, string, string, Tier]> = [
  ['payments-orchestrator', 'Payments Core', 'Payments', 'tier-1'],
  ['payments-ledger', 'Payments Core', 'Payments', 'tier-1'],
  ['sepa-batch-processor', 'Payments Core', 'Payments', 'tier-1'],
  ['instant-payments-gateway', 'Payments Rail', 'Payments', 'tier-1'],
  ['card-authorisation', 'Cards', 'Payments', 'tier-1'],
  ['card-tokenisation', 'Cards', 'Payments', 'tier-2'],
  ['mortgage-application-api', 'Mortgages', 'Lending', 'tier-1'],
  ['mortgage-pricing-engine', 'Mortgages', 'Lending', 'tier-1'],
  ['mortgage-document-store', 'Mortgages', 'Lending', 'tier-2'],
  ['loan-origination', 'Business Lending', 'Lending', 'tier-1'],
  ['credit-decision-engine', 'Business Lending', 'Lending', 'tier-1'],
  ['collateral-registry', 'Business Lending', 'Lending', 'tier-3'],
  ['customer-onboarding-api', 'Onboarding', 'Customer', 'tier-1'],
  ['kyc-screening-service', 'Onboarding', 'Customer', 'tier-1'],
  ['customer-profile-store', 'Customer Data', 'Customer', 'tier-1'],
  ['customer-consent-service', 'Customer Data', 'Customer', 'tier-2'],
  ['address-validation', 'Customer Data', 'Customer', 'tier-3'],
  ['identity-broker', 'Access', 'Security', 'tier-1'],
  ['session-gateway', 'Access', 'Security', 'tier-1'],
  ['mfa-enrolment', 'Access', 'Security', 'tier-2'],
  ['audit-trail-collector', 'Compliance Eng', 'Security', 'tier-2'],
  ['fraud-scoring-service', 'Financial Crime', 'Risk', 'tier-1'],
  ['transaction-monitoring', 'Financial Crime', 'Risk', 'tier-1'],
  ['sanctions-list-sync', 'Financial Crime', 'Risk', 'tier-2'],
  ['aml-case-manager', 'Financial Crime', 'Risk', 'tier-2'],
  ['regulatory-reporting', 'Reporting', 'Risk', 'tier-1'],
  ['finrep-aggregator', 'Reporting', 'Risk', 'tier-2'],
  ['market-data-adapter', 'Treasury Tech', 'Markets', 'tier-2'],
  ['fx-quote-service', 'Treasury Tech', 'Markets', 'tier-1'],
  ['interest-rate-curve', 'Treasury Tech', 'Markets', 'tier-2'],
  ['savings-account-api', 'Daily Banking', 'Retail', 'tier-1'],
  ['current-account-api', 'Daily Banking', 'Retail', 'tier-1'],
  ['standing-order-service', 'Daily Banking', 'Retail', 'tier-2'],
  ['statement-generator', 'Daily Banking', 'Retail', 'tier-3'],
  ['notification-dispatcher', 'Platform', 'Platform', 'tier-2'],
  ['document-render-service', 'Platform', 'Platform', 'tier-3'],
  ['file-transfer-agent', 'Platform', 'Platform', 'tier-2'],
  ['config-distribution', 'Platform', 'Platform', 'tier-2'],
  ['service-registry', 'Platform', 'Platform', 'tier-1'],
  ['batch-scheduler', 'Platform', 'Platform', 'tier-2'],
  ['legacy-nightly-jobs', 'Platform', 'Platform', 'tier-3'],
  ['branch-appointment-api', 'Channels', 'Retail', 'tier-3'],
  ['mobile-bff', 'Channels', 'Retail', 'tier-1'],
  ['internet-banking-bff', 'Channels', 'Retail', 'tier-1'],
];

const SAST_CATEGORIES = [
  'SQL Injection', 'Reflected XSS', 'Hardcoded Credentials', 'Path Traversal',
  'Insecure Deserialisation', 'XML External Entity', 'Weak Cryptography',
  'Missing Access Control', 'Log Injection', 'SSRF',
];

const VULNERABLE_COMPONENTS = [
  'org.apache.logging.log4j:log4j-core', 'com.fasterxml.jackson.core:jackson-databind',
  'org.springframework:spring-web', 'org.yaml:snakeyaml', 'commons-collections:commons-collections',
  'org.apache.tomcat.embed:tomcat-embed-core', 'ch.qos.logback:logback-classic',
  'org.bouncycastle:bcprov-jdk15on', 'io.netty:netty-codec', 'org.apache.commons:commons-text',
];

function weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function rating(score: number): SonarRating {
  if (score > 85) return 'A';
  if (score > 70) return 'B';
  if (score > 55) return 'C';
  if (score > 40) return 'D';
  return 'E';
}

function severities(base: number, health: number): Record<Severity, number> {
  const scale = (1 - health) * base;
  return {
    critical: Math.max(0, Math.round(scale * 0.18 * (chance(0.55) ? 1 : 0))),
    serious: Math.max(0, Math.round(scale * 0.5 + (chance(0.3) ? 1 : 0))),
    moderate: Math.round(scale * 1.4 + int(0, 3)),
    low: Math.round(scale * 2.6 + int(1, 9)),
  };
}

function ages(counts: Record<Severity, number>, health: number): Record<Severity, number> {
  // Unhealthier repos also sit on their findings longer — that correlation is the
  // whole reason SLA breach concentrates rather than spreading evenly.
  const drag = 1 + (1 - health) * 2.5;
  const age = (n: number, cap: number): number => (n === 0 ? 0 : Math.round(int(2, cap) * drag));
  return {
    critical: age(counts.critical, 40),
    serious: age(counts.serious, 55),
    moderate: age(counts.moderate, 110),
    low: age(counts.low, 200),
  };
}

function history(endCoverage: number, endCriticals: number): HistoryPoint[] {
  const points: HistoryPoint[] = [];
  let coverage = endCoverage - int(-4, 9);
  let criticals = endCriticals + int(0, 3);
  for (let w = 11; w >= 0; w -= 1) {
    const date = new Date(Date.UTC(2026, 8, 11) - w * 7 * 86400000);
    points.push({
      week: date.toISOString().slice(0, 10),
      coverage: Math.max(0, Math.min(100, Math.round(coverage))),
      criticals: Math.max(0, criticals),
    });
    coverage += (endCoverage - coverage) / Math.max(1, w) + (rand() - 0.5) * 2.5;
    criticals += Math.sign(endCriticals - criticals) * (chance(0.4) ? 1 : 0);
  }
  points[points.length - 1] = {
    week: points[points.length - 1].week,
    coverage: endCoverage,
    criticals: endCriticals,
  };
  return points;
}

const repos: Repo[] = REPOS.map(([name, team, domain, tier]) => {
  const boot = weightedPick(SPRING_BOOT, SPRING_BOOT_WEIGHTS);
  // Health anchors every other metric, so a laggard repo is bad across the board —
  // which is how real portfolios actually look.
  const health = Math.max(
    0.05,
    Math.min(0.97, 1 - boot.behind * 0.09 - rand() * 0.35 + (tier === 'tier-1' ? 0.12 : 0)),
  );

  const coverage = Math.round(Math.max(8, Math.min(96, health * 95 + int(-8, 8))));
  const gate: SonarGate = coverage < 60 || health < 0.4 ? 'failed' : health < 0.65 ? 'warn' : 'passed';
  const loc = int(4, 180) * 1000;

  const sonar: SonarQube = {
    gate,
    coverage,
    newCodeCoverage: Math.round(Math.max(0, Math.min(100, coverage + int(-6, 22)))),
    duplication: Math.round((1 - health) * 14 * 10) / 10,
    bugs: Math.round((1 - health) * 90 + int(0, 12)),
    vulnerabilities: Math.round((1 - health) * 24 + int(0, 3)),
    codeSmells: Math.round((1 - health) * 1400 + int(20, 200)),
    techDebtDays: Math.round((1 - health) * 120 + int(1, 15)),
    maintainability: rating(health * 100 + int(-6, 6)),
    reliability: rating(health * 100 + int(-10, 6)),
    security: rating(health * 100 + int(-12, 8)),
    lastScanDaysAgo: chance(0.12) ? int(35, 210) : int(0, 7),
  };

  const cxFindings = severities(26, health);
  const checkmarx: Checkmarx = {
    findings: cxFindings,
    oldestDays: ages(cxFindings, health),
    topCategories: [...SAST_CATEGORIES]
      .sort(() => rand() - 0.5)
      .slice(0, 3)
      .map((cat) => ({ name: cat, count: int(1, 9) })),
    lastScanDaysAgo: chance(0.15) ? int(32, 240) : int(0, 9),
  };

  const scViolations = severities(20, health);
  const hasCve = scViolations.critical > 0 || chance(0.4);
  const sonatype: Sonatype = {
    violations: scViolations,
    oldestDays: ages(scViolations, health),
    components: int(120, 900),
    licenceViolations: chance(0.22) ? int(1, 4) : 0,
    waived: chance(0.3) ? int(1, 3) : 0,
    worstCve: hasCve
      ? {
          id: `CVE-202${int(2, 6)}-${int(1000, 49999)}`,
          cvss: Math.round((6 + rand() * 3.9) * 10) / 10,
          component: pick(VULNERABLE_COMPONENTS),
        }
      : null,
    lastScanDaysAgo: chance(0.1) ? int(31, 150) : int(0, 5),
  };

  const java = boot.version.startsWith('2.') ? pick([JAVA[2], JAVA[4]]) : pick([JAVA[0], JAVA[1], JAVA[3]]);
  const analysis: RepoAnalysis = {
    springBoot: boot.version,
    springBootSupport: boot.support,
    springBootBehind: boot.behind,
    java: java.version,
    javaLts: java.lts,
    buildTool: chance(0.7) ? 'maven' : 'gradle',
    hasReadme: chance(0.85),
    hasCodeowners: chance(health > 0.6 ? 0.92 : 0.55),
    hasDockerfile: chance(0.8),
    todoCount: Math.round((1 - health) * 70 + int(0, 10)),
    lastCommitDaysAgo: chance(0.15) ? int(190, 900) : int(0, 30),
    testRatio: Math.round(Math.max(0.05, health * 0.8 + (rand() - 0.5) * 0.2) * 100) / 100,
  };

  const withoutRisk = { name, team, domain, tier, loc, sonar, checkmarx, sonatype, analysis,
    history: history(coverage, scViolations.critical + cxFindings.critical) };
  return { ...withoutRisk, risk: computeRisk(withoutRisk) };
});

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

const totals: Totals = {
  repos: repos.length,
  gatePassRate: Math.round((repos.filter((r) => r.sonar.gate === 'passed').length / repos.length) * 100),
  medianCoverage: median(repos.map((r) => r.sonar.coverage)),
  slaBreaches: repos.reduce((n, r) => n + r.risk.slaBreaches, 0),
  eolRepos: repos.filter((r) => r.analysis.springBootSupport === 'eol').length,
  criticalFindings: repos.reduce(
    (n, r) => n + r.sonatype.violations.critical + r.checkmarx.findings.critical, 0),
  techDebtDays: repos.reduce((n, r) => n + r.sonar.techDebtDays, 0),
  staleScans: repos.filter((r) =>
    Math.max(r.sonar.lastScanDaysAgo, r.checkmarx.lastScanDaysAgo, r.sonatype.lastScanDaysAgo) > 30).length,
  unowned: repos.filter((r) => !r.analysis.hasCodeowners).length,
};

// Portfolio trend = mean coverage and total criticals per week across all repos.
const portfolioHistory: HistoryPoint[] = repos[0].history.map((_, i) => ({
  week: repos[0].history[i].week,
  coverage: Math.round(repos.reduce((n, r) => n + r.history[i].coverage, 0) / repos.length),
  criticals: repos.reduce((n, r) => n + r.history[i].criticals, 0),
}));

const portfolio: Portfolio = {
  generatedAt: new Date(Date.UTC(2026, 8, 11, 9, 0)).toISOString(),
  latestSpringBoot: LATEST_SPRING_BOOT,
  totals,
  history: portfolioHistory,
  repos,
};

writeFileSync(
  join(import.meta.dirname, '..', 'data', 'seed.json'),
  `${JSON.stringify(portfolio, null, 2)}\n`,
);
console.log(`wrote ${repos.length} repos`);
console.log(totals);
