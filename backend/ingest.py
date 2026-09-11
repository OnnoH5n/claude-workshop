"""Loads data/seed.json into Postgres.

Applies the schema, then normalises the mocked vendor payloads into repositories,
append-only scans, per-finding rows, component inventory and a risk snapshot.

Risk is computed HERE (risk.py) rather than read from the seed file: the seed holds
raw vendor metrics, which is what a real SonarQube or Checkmarx API returns.

Four corrections the relational model forces, carried over from the TypeScript
version they were first found in:

  * `lastScanDaysAgo` (a relative integer that rots) becomes an absolute
    `captured_at`, and the weekly trend is anchored to the last scan rather than to
    "today" — so a repo with a stale scan truthfully has a trend that stops early.
  * Per-severity counts with a single `oldestDays` become individual finding rows,
    which is what makes SLA ageing and MTTR real rather than approximated.
  * Findings open at the start of the window but closed now get a `resolved_at`,
    so the critical burn-down can fall instead of only ever rising.
  * One row per artifact per repository, so a CVE cannot attach to two versions.
"""

import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from db import pool, query
from models import SLA_DAYS
from risk import FORMULA_VERSION, compute_risk

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "data" / "seed.json"
SCHEMA = Path(__file__).resolve().parent / "schema.sql"

SEVERITIES = ("critical", "serious", "moderate", "low")

VULNERABLE = [
    "org.apache.logging.log4j:log4j-core",
    "com.fasterxml.jackson.core:jackson-databind",
    "org.springframework:spring-web",
    "org.yaml:snakeyaml",
    "commons-collections:commons-collections",
    "org.apache.tomcat.embed:tomcat-embed-core",
    "ch.qos.logback:logback-classic",
    "org.bouncycastle:bcprov-jdk15on",
    "io.netty:netty-codec",
    "org.apache.commons:commons-text",
]


def _hash(text: str) -> float:
    """Deterministic per-repo jitter, so ingest is reproducible without a PRNG."""
    h = 2166136261
    for ch in text:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h / 0x100000000


def _at(base: datetime, days_ago: float) -> datetime:
    return base - timedelta(days=days_ago)


def _ingest_repo(cur: Any, repo: dict[str, Any], base: datetime) -> None:
    cur.execute(
        """insert into repository (name, team, domain, tier, loc)
           values (%s, %s, %s, %s, %s)
           on conflict (name) do update set team = excluded.team
           returning id""",
        (repo["name"], repo["team"], repo["domain"], repo["tier"], repo["loc"]),
    )
    repo_id = cur.fetchone()["id"]

    sonar, cx, sc, analysis = (
        repo["sonar"],
        repo["checkmarx"],
        repo["sonatype"],
        repo["analysis"],
    )
    sonar_last = sonar["lastScanDaysAgo"]

    # Weekly SonarQube history, newest first, anchored to the last scan date.
    for weeks_back, point in enumerate(reversed(repo["history"])):
        payload = sonar if weeks_back == 0 else {**sonar, "coverage": point["coverage"]}
        cur.execute(
            """insert into scan (repository_id, tool, captured_at, payload, gate,
                                 coverage, new_code_coverage, tech_debt_days)
               values (%s, 'sonarqube', %s, %s, %s, %s, %s, %s)
               on conflict do nothing""",
            (
                repo_id,
                _at(base, sonar_last + weeks_back * 7),
                json.dumps(payload),
                sonar["gate"] if weeks_back == 0 else None,
                point["coverage"],
                sonar["newCodeCoverage"] if weeks_back == 0 else None,
                sonar["techDebtDays"] if weeks_back == 0 else None,
            ),
        )

    cur.execute(
        """insert into scan (repository_id, tool, captured_at, payload)
           values (%s, 'checkmarx', %s, %s)""",
        (repo_id, _at(base, cx["lastScanDaysAgo"]), json.dumps(cx)),
    )
    cur.execute(
        """insert into scan (repository_id, tool, captured_at, payload,
                             component_count, licence_violations)
           values (%s, 'sonatype', %s, %s, %s, %s)""",
        (
            repo_id,
            _at(base, sc["lastScanDaysAgo"]),
            json.dumps(sc),
            sc["components"],
            sc["licenceViolations"],
        ),
    )
    cur.execute(
        """insert into scan (repository_id, tool, captured_at, payload, spring_boot,
                             spring_boot_support, java_version, java_lts, has_codeowners)
           values (%s, 'repo-analysis', %s, %s, %s, %s, %s, %s, %s)""",
        (
            repo_id,
            base,
            json.dumps(analysis),
            analysis["springBoot"],
            analysis["springBootSupport"],
            analysis["java"],
            analysis["javaLts"],
            analysis["hasCodeowners"],
        ),
    )

    # Expand aggregate counts into individual findings. The oldest finding in a
    # severity sits exactly at that severity's reported age; the rest spread newer.
    waivers_left = sc["waived"]
    sources = (
        ("checkmarx", cx["findings"], cx["oldestDays"],
         [c["name"] for c in cx["topCategories"]] or ["uncategorised"]),
        ("sonatype", sc["violations"], sc["oldestDays"],
         ["security-policy", "licence-policy"]),
    )
    for tool, counts, ages, categories in sources:
        for severity in SEVERITIES:
            count, oldest = counts[severity], ages[severity]
            for i in range(count):
                days_ago = oldest if count == 1 else round(oldest * (1 - i / count))
                # Waivers land on the least severe findings first, as in practice.
                waived = waivers_left > 0 and severity in ("low", "moderate")
                if waived:
                    waivers_left -= 1
                cur.execute(
                    """insert into finding (repository_id, tool, severity, category,
                                            first_seen_at, waived)
                       values (%s, %s, %s, %s, %s, %s)""",
                    (repo_id, tool, severity, categories[i % len(categories)],
                     _at(base, days_ago), waived),
                )

    # Findings open at the start of the trend window but closed now, so the
    # burn-down can fall and MTTR is computable.
    open_now = cx["findings"]["critical"] + sc["violations"]["critical"]
    resolved_in_window = max(0, repo["history"][0]["criticals"] - open_now)
    for i in range(resolved_in_window):
        seen = 84 + round(_hash(f"{repo['name']}seen{i}") * 120)
        closed = round(84 * (1 - (i + 1) / (resolved_in_window + 1)))
        cur.execute(
            """insert into finding (repository_id, tool, severity, category,
                                    first_seen_at, resolved_at)
               values (%s, 'sonatype', 'critical', 'security-policy', %s, %s)""",
            (repo_id, _at(base, seen), _at(base, closed)),
        )

    # Component inventory for the vulnerable set — enough to answer the incident
    # question ("who ships this component") across the estate.
    offset = int(_hash(repo["name"]) * len(VULNERABLE))
    used = 3 + int(_hash(f"{repo['name']}:n") * 4)
    worst = sc["worstCve"]
    for i in range(used):
        coordinates = VULNERABLE[(offset + i) % len(VULNERABLE)]
        major = 1 + int(_hash(f"{repo['name']}{coordinates}") * 3)
        minor = int(_hash(f"{coordinates}{repo['name']}") * 20)
        is_worst = bool(worst and worst["component"] == coordinates)
        cur.execute(
            """insert into component_usage (repository_id, coordinates, version,
                                            direct, cve_id, cvss)
               values (%s, %s, %s, %s, %s, %s)
               on conflict (repository_id, coordinates) do nothing""",
            (repo_id, coordinates, f"{major}.{minor}.{int(_hash(coordinates) * 9)}",
             i < 2, worst["id"] if is_worst else None,
             worst["cvss"] if is_worst else None),
        )
    # Ensure the reported worst CVE is present, attached to the existing row.
    if worst:
        cur.execute(
            """insert into component_usage (repository_id, coordinates, version,
                                            direct, cve_id, cvss)
               values (%s, %s, %s, true, %s, %s)
               on conflict (repository_id, coordinates)
               do update set cve_id = excluded.cve_id, cvss = excluded.cvss""",
            (repo_id, worst["component"],
             f"{1 + int(_hash(worst['id']) * 3)}.{int(_hash(worst['component']) * 20)}.0",
             worst["id"], worst["cvss"]),
        )

    # The score AS REPORTED at ingest time, with the formula version that produced it.
    scored = compute_risk(repo)
    cur.execute(
        """insert into risk_snapshot (repository_id, computed_at, score, band,
                                      sla_breaches, drivers, formula_version)
           values (%s, %s, %s, %s, %s, %s, %s)""",
        (repo_id, base, scored["score"], scored["band"], scored["slaBreaches"],
         json.dumps(scored["drivers"]), FORMULA_VERSION),
    )


def ingest() -> int:
    seed = json.loads(SEED.read_text())
    base = datetime.fromisoformat(seed["generatedAt"].replace("Z", "+00:00"))

    with pool.connection() as conn:
        # Idempotent DDL, then clear the data. Kept separate because dropping and
        # recreating the enum types changed their OIDs, which broke pooled psycopg
        # connections holding the old ones ("cache lookup failed for type NNNNN").
        conn.execute(SCHEMA.read_text())
        conn.execute(
            "truncate risk_snapshot, component_usage, finding, scan, repository"
            " restart identity cascade"
        )

    from psycopg.rows import dict_row

    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        for repo in seed["repos"]:
            _ingest_repo(cur, repo, base)

    return len(seed["repos"])


if __name__ == "__main__":
    pool.open()
    n = ingest()
    counts = query(
        """select (select count(*) from repository) as repositories,
                  (select count(*) from scan) as scans,
                  (select count(*) from finding) as findings,
                  (select count(*) from component_usage) as components,
                  (select count(*) from risk_snapshot) as risk_snapshots"""
    )[0]
    print(f"ingested {n} repositories", counts, file=sys.stderr)
    pool.close()
