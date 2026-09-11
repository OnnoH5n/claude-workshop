// Loads data/seed.json into Postgres: applies the schema, then normalises the
// mocked vendor payloads into repositories, append-only scans, per-finding rows,
// component inventory and a risk snapshot.
//
// Two deliberate corrections happen here, because the relational model will not
// tolerate the shortcuts the flat file allowed:
//
//  * `lastScanDaysAgo` (a relative integer that rots) becomes an absolute
//    `captured_at`, and the 12-week trend is anchored to the last scan rather
//    than to "today" — so a repo with a stale scan truthfully has a trend that
//    stops early instead of a suspiciously fresh one.
//  * Per-severity counts with a single `oldestDays` become individual finding
//    rows whose ages span up to that oldest value, which is what makes SLA
//    ageing and MTTR real rather than approximated.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Portfolio, Repo, Severity } from '../../shared/types.ts';
import { pool, query } from './connect.ts';

const DAY = 86_400_000;
const SEVERITIES: Severity[] = ['critical', 'serious', 'moderate', 'low'];
const FORMULA_VERSION = 'v2-asymptotic';

/** Deterministic per-repo jitter, so ingest is reproducible without a seeded PRNG. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const VULNERABLE = [
  'org.apache.logging.log4j:log4j-core', 'com.fasterxml.jackson.core:jackson-databind',
  'org.springframework:spring-web', 'org.yaml:snakeyaml', 'commons-collections:commons-collections',
  'org.apache.tomcat.embed:tomcat-embed-core', 'ch.qos.logback:logback-classic',
  'org.bouncycastle:bcprov-jdk15on', 'io.netty:netty-codec', 'org.apache.commons:commons-text',
];

function iso(base: number, daysAgo: number): string {
  return new Date(base - daysAgo * DAY).toISOString();
}

async function ingestRepo(repo: Repo, generatedAt: number): Promise<void> {
  const [{ id }] = await query<{ id: string }>(
    `insert into repository (name, team, domain, tier, loc)
     values ($1, $2, $3, $4, $5)
     on conflict (name) do update set team = excluded.team
     returning id`,
    [repo.name, repo.team, repo.domain, repo.tier, repo.loc],
  );

  const sonarLast = repo.sonar.lastScanDaysAgo;

  // Weekly SonarQube history, newest first, anchored to the last scan date.
  const trend = [...repo.history].reverse();
  for (const [weeksBack, point] of trend.entries()) {
    const daysAgo = sonarLast + weeksBack * 7;
    await query(
      `insert into scan (repository_id, tool, captured_at, payload, gate, coverage,
                         new_code_coverage, tech_debt_days)
       values ($1, 'sonarqube', $2, $3, $4, $5, $6, $7)
       on conflict do nothing`,
      [
        id, iso(generatedAt, daysAgo),
        JSON.stringify(weeksBack === 0 ? repo.sonar : { ...repo.sonar, coverage: point.coverage }),
        weeksBack === 0 ? repo.sonar.gate : null,
        point.coverage,
        weeksBack === 0 ? repo.sonar.newCodeCoverage : null,
        weeksBack === 0 ? repo.sonar.techDebtDays : null,
      ],
    );
  }

  await query(
    `insert into scan (repository_id, tool, captured_at, payload) values ($1, 'checkmarx', $2, $3)`,
    [id, iso(generatedAt, repo.checkmarx.lastScanDaysAgo), JSON.stringify(repo.checkmarx)],
  );
  await query(
    `insert into scan (repository_id, tool, captured_at, payload, component_count, licence_violations)
     values ($1, 'sonatype', $2, $3, $4, $5)`,
    [id, iso(generatedAt, repo.sonatype.lastScanDaysAgo), JSON.stringify(repo.sonatype),
     repo.sonatype.components, repo.sonatype.licenceViolations],
  );
  await query(
    `insert into scan (repository_id, tool, captured_at, payload, spring_boot,
                       spring_boot_support, java_version, java_lts, has_codeowners)
     values ($1, 'repo-analysis', $2, $3, $4, $5, $6, $7, $8)`,
    [id, iso(generatedAt, 0), JSON.stringify(repo.analysis), repo.analysis.springBoot,
     repo.analysis.springBootSupport, repo.analysis.java, repo.analysis.javaLts,
     repo.analysis.hasCodeowners],
  );

  // Expand aggregate counts into individual findings. The oldest finding in a
  // severity sits exactly at that severity's reported age; the rest spread newer.
  let waiversLeft = repo.sonatype.waived;
  for (const [tool, counts, ages, categories] of [
    ['checkmarx', repo.checkmarx.findings, repo.checkmarx.oldestDays,
     repo.checkmarx.topCategories.map((c) => c.name)],
    ['sonatype', repo.sonatype.violations, repo.sonatype.oldestDays, ['security-policy', 'licence-policy']],
  ] as const) {
    for (const severity of SEVERITIES) {
      const count = counts[severity];
      const oldest = ages[severity];
      for (let i = 0; i < count; i += 1) {
        const daysAgo = count === 1 ? oldest : Math.round(oldest * (1 - i / count));
        // Waivers land on the least severe findings first, as they do in practice.
        const waived = waiversLeft > 0 && (severity === 'low' || severity === 'moderate');
        if (waived) waiversLeft -= 1;
        await query(
          `insert into finding (repository_id, tool, severity, category, first_seen_at, waived)
           values ($1, $2, $3, $4, $5, $6)`,
          [id, tool, severity, categories[i % categories.length], iso(generatedAt, daysAgo), waived],
        );
      }
    }
  }

  // Component inventory for the vulnerable set — enough to answer the incident
  // question ("who ships this component") across the estate.
  const offset = Math.floor(hash(repo.name) * VULNERABLE.length);
  const used = 3 + Math.floor(hash(`${repo.name}:n`) * 4);
  for (let i = 0; i < used; i += 1) {
    const coordinates = VULNERABLE[(offset + i) % VULNERABLE.length];
    const major = 1 + Math.floor(hash(`${repo.name}${coordinates}`) * 3);
    const minor = Math.floor(hash(`${coordinates}${repo.name}`) * 20);
    const isWorst = repo.sonatype.worstCve?.component === coordinates;
    await query(
      `insert into component_usage (repository_id, coordinates, version, direct, cve_id, cvss)
       values ($1, $2, $3, $4, $5, $6) on conflict (repository_id, coordinates) do nothing`,
      [id, coordinates, `${major}.${minor}.${Math.floor(hash(coordinates) * 9)}`,
       i < 2, isWorst ? repo.sonatype.worstCve?.id : null,
       isWorst ? repo.sonatype.worstCve?.cvss : null],
    );
  }
  // Ensure the reported worst CVE is always present, even if not in the sampled set.
  if (repo.sonatype.worstCve) {
    const { component, id: cve, cvss } = repo.sonatype.worstCve;
    await query(
      `insert into component_usage (repository_id, coordinates, version, direct, cve_id, cvss)
       values ($1, $2, $3, true, $4, $5)
       on conflict (repository_id, coordinates)
       do update set cve_id = excluded.cve_id, cvss = excluded.cvss`,
      [id, component, `${1 + Math.floor(hash(cve) * 3)}.${Math.floor(hash(component) * 20)}.0`, cve, cvss],
    );
  }

  // Findings that were open at the start of the trend window but are closed now.
  // Without these every critical looks like it is still open, so the burn-down can
  // only rise and MTTR is uncomputable.
  const openNow = repo.checkmarx.findings.critical + repo.sonatype.violations.critical;
  const resolvedInWindow = Math.max(0, repo.history[0].criticals - openNow);
  for (let i = 0; i < resolvedInWindow; i += 1) {
    const seenDaysAgo = 84 + Math.round(hash(`${repo.name}seen${i}`) * 120);
    // Spread closures across the 12-week window so the weekly open-count declines.
    const resolvedDaysAgo = Math.round(84 * (1 - (i + 1) / (resolvedInWindow + 1)));
    await query(
      `insert into finding (repository_id, tool, severity, category, first_seen_at, resolved_at)
       values ($1, 'sonatype', 'critical', 'security-policy', $2, $3)`,
      [id, iso(generatedAt, seenDaysAgo), iso(generatedAt, resolvedDaysAgo)],
    );
  }

  await query(
    `insert into risk_snapshot (repository_id, computed_at, score, band, sla_breaches, drivers, formula_version)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, iso(generatedAt, 0), repo.risk.score, repo.risk.band, repo.risk.slaBreaches,
     JSON.stringify(repo.risk.drivers), FORMULA_VERSION],
  );
}

export async function ingest(): Promise<number> {
  const schema = readFileSync(join(import.meta.dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);

  const portfolio = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', '..', 'data', 'seed.json'), 'utf8'),
  ) as Portfolio;
  const generatedAt = new Date(portfolio.generatedAt).getTime();

  for (const repo of portfolio.repos) await ingestRepo(repo, generatedAt);
  return portfolio.repos.length;
}

if (process.argv[1]?.endsWith('ingest.ts')) {
  const n = await ingest();
  const [counts] = await query<Record<string, string>>(
    `select (select count(*) from repository)::text as repositories,
            (select count(*) from scan)::text       as scans,
            (select count(*) from finding)::text    as findings,
            (select count(*) from component_usage)::text as components,
            (select count(*) from risk_snapshot)::text   as risk_snapshots`,
  );
  console.log(`ingested ${n} repositories`, counts);
  await pool.end();
}
