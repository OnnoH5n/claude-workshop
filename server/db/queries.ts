// Dashboard reads. The aggregates the flat-file version computed in JavaScript
// (median, distribution, pass rate, SLA breach) are done by Postgres here.
import { SLA_DAYS, type PortfolioResponse, type Repo, type Severity, type Totals } from '../../shared/types.ts';
import { query } from './connect.ts';

// Only severities with an active remediation clock count as a breach; see risk.ts.
const SLA_TRACKED: Severity[] = ['critical', 'serious'];

/** Open, un-waived findings past their severity's SLA window. */
const BREACHING = `
  from finding f
 where f.resolved_at is null
   and not f.waived
   and f.severity = any($1::severity[])
   and (now() - f.first_seen_at) > (
         case f.severity
           when 'critical' then make_interval(days => $2)
           when 'serious'  then make_interval(days => $3)
         end)`;

const SLA_PARAMS = [SLA_TRACKED, SLA_DAYS.critical, SLA_DAYS.serious];

type RepoRow = {
  name: string; team: string; domain: string; tier: Repo['tier']; loc: number;
  sonar_payload: Repo['sonar']; checkmarx_payload: Repo['checkmarx'];
  sonatype_payload: Repo['sonatype']; analysis_payload: Repo['analysis'];
  sonar_days: number; checkmarx_days: number; sonatype_days: number;
  score: number; band: Repo['risk']['band']; drivers: string[]; sla_breaches: number;
};

const REPO_SELECT = `
  select c.name, c.team, c.domain, c.tier, c.loc,
         c.sonar_payload, c.checkmarx_payload, c.sonatype_payload, c.analysis_payload,
         -- Recomputed from absolute timestamps, so it can never go stale.
         extract(day from now() - c.sonar_scanned_at)::int     as sonar_days,
         extract(day from now() - c.checkmarx_scanned_at)::int as checkmarx_days,
         extract(day from now() - c.sonatype_scanned_at)::int  as sonatype_days,
         rs.score, rs.band, rs.drivers,
         -- Counted from individual findings rather than per-severity aggregates.
         (select count(*) ${BREACHING} and f.repository_id = c.id)::int as sla_breaches
    from repo_current c
    join lateral (
      select score, band, drivers from risk_snapshot
       where repository_id = c.id order by computed_at desc limit 1
    ) rs on true`;

/** Reassembles the API contract: payloads supply the vendor shapes, columns the facts. */
function toRepo(row: RepoRow): Omit<Repo, 'history'> {
  return {
    name: row.name, team: row.team, domain: row.domain, tier: row.tier, loc: row.loc,
    sonar: { ...row.sonar_payload, lastScanDaysAgo: row.sonar_days },
    checkmarx: { ...row.checkmarx_payload, lastScanDaysAgo: row.checkmarx_days },
    sonatype: { ...row.sonatype_payload, lastScanDaysAgo: row.sonatype_days },
    analysis: row.analysis_payload,
    risk: {
      score: row.score, band: row.band, drivers: row.drivers,
      slaBreaches: row.sla_breaches,
    },
  };
}

export async function getTotals(): Promise<Totals> {
  const [row] = await query<Record<keyof Totals, string>>(
    `select
       (select count(*) from repository)::text as repos,
       (select round(100.0 * count(*) filter (where gate = 'passed') / count(*))
          from repo_current)::text as "gatePassRate",
       -- percentile_cont, not an average: the tail is the point.
       (select round(percentile_cont(0.5) within group (order by coverage))
          from repo_current)::text as "medianCoverage",
       (select count(*) ${BREACHING})::text as "slaBreaches",
       (select count(*) from repo_current where spring_boot_support = 'eol')::text as "eolRepos",
       (select count(*) from finding
         where resolved_at is null and severity = 'critical')::text as "criticalFindings",
       (select sum(tech_debt_days) from repo_current)::text as "techDebtDays",
       (select count(*) from repo_current
         where oldest_scanned_at < now() - interval '30 days')::text as "staleScans",
       (select count(*) from repo_current where not has_codeowners)::text as unowned`,
    SLA_PARAMS,
  );
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value)]),
  ) as unknown as Totals;
}

export async function getPortfolio(): Promise<PortfolioResponse> {
  const [totals, repos, history, meta] = await Promise.all([
    getTotals(),
    query<RepoRow>(`${REPO_SELECT} order by rs.score desc`, SLA_PARAMS),
    // Portfolio trend over a FIXED cohort. Grouping scans by week directly averages
    // a different subset of repositories each week (27-35 of 44 here), which invents
    // movement that isn't there — so carry each repo's last observation forward.
    query<{ week: string; coverage: string; criticals: string }>(
      `with weeks as (
         select generate_series(date_trunc('week', now()) - interval '11 weeks',
                                date_trunc('week', now()), interval '1 week') as wk
       ),
       carried as (
         select w.wk, r.id,
                (select s.coverage from scan s
                  where s.repository_id = r.id and s.tool = 'sonarqube'
                    and s.captured_at < w.wk + interval '1 week'
                  order by s.captured_at desc limit 1) as coverage
           from weeks w cross join repository r
       )
       select to_char(c.wk, 'YYYY-MM-DD') as week,
              round(avg(c.coverage))::text as coverage,
              -- Findings OPEN as of that week, not cumulative arrivals.
              (select count(*) from finding f
                where f.severity = 'critical'
                  and f.first_seen_at < c.wk + interval '1 week'
                  and (f.resolved_at is null
                       or f.resolved_at >= c.wk + interval '1 week'))::text as criticals
         from carried c
        where c.coverage is not null
        group by c.wk order by c.wk`,
    ),
    query<{ latest: string }>(
      `select payload->>'springBoot' as latest from scan
        where tool = 'repo-analysis' order by spring_boot desc limit 1`,
    ),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    latestSpringBoot: meta[0]?.latest ?? '3.5',
    totals,
    history: history.map((h) => ({
      week: h.week, coverage: Number(h.coverage), criticals: Number(h.criticals),
    })),
    repos: repos.map(toRepo),
  };
}

export async function getRepo(name: string): Promise<Repo | null> {
  const [row] = await query<RepoRow & { id: string }>(
    `${REPO_SELECT} where c.name = $4`, [...SLA_PARAMS, name],
  );
  if (!row) return null;

  const history = await query<{ week: string; coverage: string; criticals: string }>(
    `select to_char(captured_at, 'YYYY-MM-DD') as week, coverage::text,
            (select count(*) from finding
              where repository_id = s.repository_id and severity = 'critical'
                and first_seen_at <= s.captured_at)::text as criticals
       from scan s
      where tool = 'sonarqube'
        and repository_id = (select id from repository where name = $1)
      order by captured_at`,
    [name],
  );

  return {
    ...toRepo(row),
    history: history.map((h) => ({
      week: h.week, coverage: Number(h.coverage), criticals: Number(h.criticals),
    })),
  };
}

/**
 * The incident query the flat file could not answer: which repositories ship a
 * given component, and at what version.
 */
export async function findComponent(search: string): Promise<Array<{
  coordinates: string; version: string; repo: string; direct: boolean; cve: string | null;
}>> {
  return query(
    `select cu.coordinates, cu.version, r.name as repo, cu.direct, cu.cve_id as cve
       from component_usage cu join repository r on r.id = cu.repository_id
      where cu.coordinates ilike '%' || $1 || '%'
      order by cu.cve_id nulls last, r.name`,
    [search],
  );
}
