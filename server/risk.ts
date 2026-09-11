// Composite risk score. Deliberately explicit and weighted rather than a black box:
// on a dashboard people act on, "why is this repo red" must be answerable, so every
// contribution also emits a human-readable driver string.
import {
  COVERAGE_POLICY,
  SLA_DAYS,
  type Repo,
  type Risk,
  type RiskBand,
  type Severity,
} from '../shared/types.ts';

// Only severities carrying an active remediation clock. Counting moderate/low here
// produces four-digit "breach" totals that drown out the findings anyone will act on.
const SLA_TRACKED: Severity[] = ['critical', 'serious'];

/** Findings whose oldest instance sits past its SLA window, net of waivers. */
export function countSlaBreaches(repo: Omit<Repo, 'risk'>): number {
  let breaches = 0;
  for (const severity of SLA_TRACKED) {
    if (repo.checkmarx.oldestDays[severity] > SLA_DAYS[severity]) {
      breaches += repo.checkmarx.findings[severity];
    }
    if (repo.sonatype.oldestDays[severity] > SLA_DAYS[severity]) {
      breaches += repo.sonatype.violations[severity];
    }
  }
  return Math.max(0, breaches - repo.sonatype.waived);
}

const TIER_WEIGHT = { 'tier-1': 1.25, 'tier-2': 1, 'tier-3': 0.75 } as const;

export function computeRisk(repo: Omit<Repo, 'risk'>): Risk {
  const contributions: Array<{ points: number; driver: string }> = [];
  const add = (points: number, driver: string): void => {
    if (points > 0) contributions.push({ points, driver });
  };

  const slaBreaches = countSlaBreaches(repo);

  // Unremediated criticals dominate: they are the findings with a policy clock on them.
  add(
    Math.min(30, repo.sonatype.violations.critical * 6 + repo.checkmarx.findings.critical * 5),
    `${repo.sonatype.violations.critical + repo.checkmarx.findings.critical} critical finding(s)`,
  );
  add(Math.min(15, slaBreaches * 2), `${slaBreaches} finding(s) past SLA`);

  // Running an unsupported framework is a standing risk regardless of findings:
  // no patch route exists when the next CVE lands.
  if (repo.analysis.springBootSupport === 'eol') {
    add(20, `Spring Boot ${repo.analysis.springBoot} is end-of-life`);
  } else if (repo.analysis.springBootSupport === 'oss-ended') {
    add(10, `Spring Boot ${repo.analysis.springBoot} is out of OSS support`);
  }
  if (!repo.analysis.javaLts) add(5, `Java ${repo.analysis.java} is not an LTS release`);

  const coverageGap = Math.max(0, COVERAGE_POLICY - repo.sonar.coverage);
  add(Math.min(15, coverageGap * 0.35), `Coverage ${repo.sonar.coverage}% is under the ${COVERAGE_POLICY}% policy`);

  if (repo.sonar.gate === 'failed') add(8, 'SonarQube quality gate failing');
  else if (repo.sonar.gate === 'warn') add(4, 'SonarQube quality gate at warning');

  // A green dashboard built on stale scans is a lie, so staleness is itself a risk.
  const worstScan = Math.max(
    repo.sonar.lastScanDaysAgo,
    repo.checkmarx.lastScanDaysAgo,
    repo.sonatype.lastScanDaysAgo,
  );
  if (worstScan > 30) add(Math.min(10, (worstScan - 30) * 0.2), `No scan in ${worstScan} days`);

  if (!repo.analysis.hasCodeowners) add(5, 'No CODEOWNERS — unowned');
  if (repo.analysis.lastCommitDaysAgo > 180) {
    add(4, `No commit in ${repo.analysis.lastCommitDaysAgo} days`);
  }
  if (repo.sonatype.licenceViolations > 0) {
    add(4, `${repo.sonatype.licenceViolations} licence violation(s)`);
  }

  const raw = contributions.reduce((sum, c) => sum + c.points, 0) * TIER_WEIGHT[repo.tier];
  // Asymptotic rather than clipped at 100: a hard cap tied the three worst repos at
  // the same score, which is precisely where a remediation queue must still rank.
  const score = Math.round(100 * (1 - Math.exp(-raw / 42)));

  const band: RiskBand =
    score >= 78 ? 'critical' : score >= 58 ? 'high' : score >= 32 ? 'elevated' : 'low';

  return {
    score,
    band,
    slaBreaches,
    drivers: contributions
      .sort((a, b) => b.points - a.points)
      .slice(0, 4)
      .map((c) => c.driver),
  };
}
