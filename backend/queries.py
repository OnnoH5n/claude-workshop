"""Dashboard reads.

The aggregates a flat file would compute in application code — median,
distribution, pass rate, SLA breach — are done by Postgres here.
"""

from datetime import datetime, timezone
from typing import Any

from db import query, query_one
from models import SLA_DAYS, SLA_TRACKED

# Open, un-waived findings past their severity's SLA window.
BREACHING = """
  from finding f
 where f.resolved_at is null
   and not f.waived
   and f.severity = any(%(tracked)s::severity[])
   and (now() - f.first_seen_at) > (
         case f.severity
           when 'critical' then make_interval(days => %(critical)s)
           when 'serious'  then make_interval(days => %(serious)s)
         end)"""

SLA_PARAMS = {
    "tracked": list(SLA_TRACKED),
    "critical": SLA_DAYS["critical"],
    "serious": SLA_DAYS["serious"],
}

REPO_SELECT = f"""
  select c.name, c.team, c.domain, c.tier, c.loc,
         c.sonar_payload, c.checkmarx_payload, c.sonatype_payload, c.analysis_payload,
         -- Recomputed from absolute timestamps, so it can never go stale.
         extract(day from now() - c.sonar_scanned_at)::int     as sonar_days,
         extract(day from now() - c.checkmarx_scanned_at)::int as checkmarx_days,
         extract(day from now() - c.sonatype_scanned_at)::int  as sonatype_days,
         rs.score, rs.band, rs.drivers,
         -- Counted from individual findings rather than per-severity aggregates.
         (select count(*) {BREACHING} and f.repository_id = c.id)::int as sla_breaches
    from repo_current c
    join lateral (
      select score, band, drivers from risk_snapshot
       where repository_id = c.id order by computed_at desc limit 1
    ) rs on true"""


def _to_repo(row: dict[str, Any]) -> dict[str, Any]:
    """Reassembles the API contract: payloads supply the vendor shapes, columns the facts."""
    return {
        "name": row["name"],
        "team": row["team"],
        "domain": row["domain"],
        "tier": row["tier"],
        "loc": row["loc"],
        "sonar": {**row["sonar_payload"], "lastScanDaysAgo": row["sonar_days"]},
        "checkmarx": {**row["checkmarx_payload"], "lastScanDaysAgo": row["checkmarx_days"]},
        "sonatype": {**row["sonatype_payload"], "lastScanDaysAgo": row["sonatype_days"]},
        "analysis": row["analysis_payload"],
        "risk": {
            "score": row["score"],
            "band": row["band"],
            "drivers": row["drivers"],
            "slaBreaches": row["sla_breaches"],
        },
    }


def get_totals() -> dict[str, int]:
    row = query_one(
        f"""select
          (select count(*) from repository) as repos,
          (select round(100.0 * count(*) filter (where gate = 'passed') / count(*))
             from repo_current) as "gatePassRate",
          -- percentile_cont, not an average: the tail is the point.
          (select round(percentile_cont(0.5) within group (order by coverage))
             from repo_current) as "medianCoverage",
          (select count(*) {BREACHING}) as "slaBreaches",
          (select count(*) from repo_current where spring_boot_support = 'eol') as "eolRepos",
          -- The honest headline: 'eol' alone excludes the extended-support lines
          -- (3.5, 2.7), which are equally unpatched by the free stream.
          (select count(*) from repo_current
            where spring_boot_support in ('eol', 'oss-ended')) as "offOssSupport",
          (select count(*) from finding
            where resolved_at is null and severity = 'critical') as "criticalFindings",
          (select sum(tech_debt_days) from repo_current) as "techDebtDays",
          -- Staleness uses the OLDEST of the three tools, not the newest.
          (select count(*) from repo_current
            where oldest_scanned_at < now() - interval '30 days') as "staleScans",
          (select count(*) from repo_current where not has_codeowners) as unowned""",
        SLA_PARAMS,
    )
    assert row is not None
    return {k: int(v) for k, v in row.items()}


def get_history() -> list[dict[str, Any]]:
    """Portfolio trend over a FIXED cohort.

    Grouping scans by week directly averages a different subset of repositories each
    week (27-35 of 44 here), which invents movement that isn't in the data — so carry
    each repo's last observation forward instead.
    """
    rows = query(
        """with weeks as (
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
                  round(avg(c.coverage)) as coverage,
                  -- Findings OPEN as of that week, not cumulative arrivals.
                  (select count(*) from finding f
                    where f.severity = 'critical'
                      and f.first_seen_at < c.wk + interval '1 week'
                      and (f.resolved_at is null
                           or f.resolved_at >= c.wk + interval '1 week')) as criticals
             from carried c
            where c.coverage is not null
            group by c.wk order by c.wk"""
    )
    return [
        {"week": r["week"], "coverage": int(r["coverage"]), "criticals": int(r["criticals"])}
        for r in rows
    ]


def get_portfolio() -> dict[str, Any]:
    rows = query(f"{REPO_SELECT} order by rs.score desc", SLA_PARAMS)
    latest = query_one(
        """select payload->>'springBoot' as latest from scan
            where tool = 'repo-analysis' order by spring_boot desc limit 1"""
    )
    return {
        "generatedAt": datetime.now(timezone.utc),
        "latestSpringBoot": (latest or {}).get("latest") or "3.5",
        "totals": get_totals(),
        "history": get_history(),
        "repos": [_to_repo(r) for r in rows],
    }


def get_repo(name: str) -> dict[str, Any] | None:
    row = query_one(f"{REPO_SELECT} where c.name = %(name)s", {**SLA_PARAMS, "name": name})
    if row is None:
        return None

    history = query(
        """select to_char(captured_at, 'YYYY-MM-DD') as week, coverage,
                  (select count(*) from finding
                    where repository_id = s.repository_id and severity = 'critical'
                      and first_seen_at <= s.captured_at) as criticals
             from scan s
            where tool = 'sonarqube'
              and repository_id = (select id from repository where name = %(name)s)
            order by captured_at""",
        {"name": name},
    )
    return {
        **_to_repo(row),
        "history": [
            {"week": h["week"], "coverage": int(h["coverage"]), "criticals": int(h["criticals"])}
            for h in history
        ],
    }


def find_component(search: str) -> list[dict[str, Any]]:
    """The incident query: which repositories ship a given component, at what version."""
    return query(
        """select cu.coordinates, cu.version, r.name as repo, cu.direct,
                  cu.cve_id as cve
             from component_usage cu join repository r on r.id = cu.repository_id
            where cu.coordinates ilike '%%' || %(q)s || '%%'
            order by cu.cve_id nulls last, r.name""",
        {"q": search},
    )
