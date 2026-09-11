// Single source of truth for the API contract. Imported by BOTH src/ and server/,
// so changing a shape here breaks the other side at typecheck time, not at demo time.
//
// Models a Java repository portfolio as assembled from four QA sources:
// SonarQube (quality), Checkmarx (SAST), Sonatype Lifecycle (SCA/licence),
// and plain-text analysis of the repo itself (framework/LCM posture).

/** Severity ladder shared by Checkmarx findings and Sonatype policy violations. */
export type Severity = 'critical' | 'serious' | 'moderate' | 'low';

/** Days allowed before a finding of each severity breaches remediation policy. */
export const SLA_DAYS: Record<Severity, number> = {
  critical: 14,
  serious: 30,
  moderate: 90,
  low: 180,
};

/** Minimum line coverage required by policy. Drives the threshold marker. */
export const COVERAGE_POLICY = 80;

export type SonarGate = 'passed' | 'warn' | 'failed';
export type SonarRating = 'A' | 'B' | 'C' | 'D' | 'E';

/** Vendor support state of a framework release. `oss-ended` = commercial support only. */
export type SupportState = 'supported' | 'oss-ended' | 'eol';

/** Business criticality, which scales how much a given risk actually matters. */
export type Tier = 'tier-1' | 'tier-2' | 'tier-3';

export type SonarQube = {
  gate: SonarGate;
  coverage: number;
  /** Coverage on recently changed lines — the metric that actually shifts behaviour. */
  newCodeCoverage: number;
  duplication: number;
  bugs: number;
  vulnerabilities: number;
  codeSmells: number;
  techDebtDays: number;
  maintainability: SonarRating;
  reliability: SonarRating;
  security: SonarRating;
  lastScanDaysAgo: number;
};

export type Checkmarx = {
  findings: Record<Severity, number>;
  /** Oldest unresolved finding per severity, in days — feeds SLA breach maths. */
  oldestDays: Record<Severity, number>;
  topCategories: Array<{ name: string; count: number }>;
  lastScanDaysAgo: number;
};

export type Sonatype = {
  violations: Record<Severity, number>;
  oldestDays: Record<Severity, number>;
  components: number;
  /** Components whose licence conflicts with commercial distribution policy. */
  licenceViolations: number;
  /** Violations formally accepted by a risk owner — excluded from SLA breaches. */
  waived: number;
  worstCve: { id: string; cvss: number; component: string } | null;
  lastScanDaysAgo: number;
};

/** Derived from reading pom.xml / build.gradle / the file tree — no vendor needed. */
export type RepoAnalysis = {
  springBoot: string;
  springBootSupport: SupportState;
  /** Minor releases behind the current latest. */
  springBootBehind: number;
  /** End-of-month policy boundaries, not precise cutoffs. */
  springBootOssSupportEnd: string;
  springBootCommercialSupportEnd: string;
  java: string;
  javaLts: boolean;
  buildTool: 'maven' | 'gradle';
  hasReadme: boolean;
  hasCodeowners: boolean;
  hasDockerfile: boolean;
  todoCount: number;
  lastCommitDaysAgo: number;
  /** Test files ÷ main source files. A crude but honest smell. */
  testRatio: number;
};

export type RiskBand = 'low' | 'elevated' | 'high' | 'critical';

export type Risk = {
  /** 0-100, higher is worse. Formula documented in server/risk.ts. */
  score: number;
  band: RiskBand;
  /** Human-readable reasons, largest contributor first. Drives the work queue. */
  drivers: string[];
  /** Findings past their SLA_DAYS window, excluding waivers. */
  slaBreaches: number;
};

export type HistoryPoint = {
  week: string;
  coverage: number;
  criticals: number;
};

export type Repo = {
  name: string;
  team: string;
  domain: string;
  tier: Tier;
  loc: number;
  sonar: SonarQube;
  checkmarx: Checkmarx;
  sonatype: Sonatype;
  analysis: RepoAnalysis;
  risk: Risk;
  history: HistoryPoint[];
};

export type Totals = {
  repos: number;
  gatePassRate: number;
  medianCoverage: number;
  slaBreaches: number;
  /** Strictly end-of-life: no commercial support route either. */
  eolRepos: number;
  /** Off free/OSS support — includes eolRepos plus the extended-support lines. */
  offOssSupport: number;
  criticalFindings: number;
  techDebtDays: number;
  staleScans: number;
  unowned: number;
};

/** The list payload drops per-repo history to keep the initial response lean. */
export type RepoSummary = Omit<Repo, 'history'>;

/**
 * Shape of data/seed.json — raw vendor metrics only, which is what a real
 * SonarQube or Checkmarx API returns. Risk is scored at ingest by the Python
 * backend (backend/risk.py) and totals/trend are derived in SQL, so neither is
 * carried in the committed seed.
 */
export type SeedRepo = Omit<Repo, 'risk'>;

export type Seed = {
  generatedAt: string;
  latestSpringBoot: string;
  repos: SeedRepo[];
};

export type Portfolio = {
  generatedAt: string;
  latestSpringBoot: string;
  totals: Totals;
  /** Portfolio-wide weekly trend, for the stat-tile sparklines. */
  history: HistoryPoint[];
  repos: Repo[];
};

/** GET /api/portfolio — summaries only; fetch a repo for its history. */
export type PortfolioResponse = Omit<Portfolio, 'repos'> & { repos: RepoSummary[] };

/** GET /api/repos/:name */
export type RepoResponse = { repo: Repo };
