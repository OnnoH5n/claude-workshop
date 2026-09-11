"""Composite risk score.

This is now the ONLY home for the formula. It used to live in TypeScript beside the
mock data generator, which meant the generator baked scores into data/seed.json.
Scoring belongs with the service that owns the data, so the generator emits raw
vendor metrics only — exactly what a real SonarQube or Checkmarx API returns — and
the score is computed here at ingest.

Deliberately explicit and weighted rather than a black box: on a dashboard people
act on, "why is this repo red" must be answerable, so every contribution also emits
a human-readable driver string.
"""

import math
from typing import Any

from models import COVERAGE_POLICY, SLA_DAYS, SLA_TRACKED

TIER_WEIGHT = {"tier-1": 1.25, "tier-2": 1.0, "tier-3": 0.75}

FORMULA_VERSION = "v2-asymptotic"


def count_sla_breaches(repo: dict[str, Any]) -> int:
    """Findings whose oldest instance sits past its SLA window, net of waivers."""
    breaches = 0
    for severity in SLA_TRACKED:
        if repo["checkmarx"]["oldestDays"][severity] > SLA_DAYS[severity]:
            breaches += repo["checkmarx"]["findings"][severity]
        if repo["sonatype"]["oldestDays"][severity] > SLA_DAYS[severity]:
            breaches += repo["sonatype"]["violations"][severity]
    return max(0, breaches - repo["sonatype"]["waived"])


def compute_risk(repo: dict[str, Any]) -> dict[str, Any]:
    contributions: list[tuple[float, str]] = []

    def add(points: float, driver: str) -> None:
        if points > 0:
            contributions.append((points, driver))

    sonar, cx, sc, analysis = (
        repo["sonar"],
        repo["checkmarx"],
        repo["sonatype"],
        repo["analysis"],
    )
    sla_breaches = count_sla_breaches(repo)

    # Unremediated criticals dominate: they are the findings with a policy clock on them.
    criticals = sc["violations"]["critical"] + cx["findings"]["critical"]
    add(
        min(30, sc["violations"]["critical"] * 6 + cx["findings"]["critical"] * 5),
        f"{criticals} critical finding(s)",
    )
    add(min(15, sla_breaches * 2), f"{sla_breaches} finding(s) past SLA")

    # Running an unsupported framework is a standing risk regardless of findings:
    # no patch route exists when the next CVE lands.
    if analysis["springBootSupport"] == "eol":
        add(20, f"Spring Boot {analysis['springBoot']} is end-of-life")
    elif analysis["springBootSupport"] == "oss-ended":
        add(10, f"Spring Boot {analysis['springBoot']} is out of OSS support")

    # Support state alone understates the risk. Spring Boot 2.7 and 3.5 are
    # "extended support" generations with commercial tails into 2029 and 2032, so
    # both register as oss-ended rather than eol — yet 2.7 is eight minor lines
    # behind and 3.5 only two. Distance from current carries its own weight: the
    # upgrade cost and the unpatched-CVE exposure both scale with it.
    behind = analysis["springBootBehind"]
    if behind >= 2:
        add(min(12, (behind - 1) * 2), f"{behind} Spring Boot minor releases behind")

    if not analysis["javaLts"]:
        add(5, f"Java {analysis['java']} is not an LTS release")
    # Java 17 is the baseline for every supported Spring Boot line, so anything
    # below it blocks an upgrade regardless of that version's own LTS status.
    if analysis["java"] in ("8", "11"):
        add(6, f"Java {analysis['java']} is below the Java 17 baseline")

    coverage_gap = max(0, COVERAGE_POLICY - sonar["coverage"])
    add(
        min(15, coverage_gap * 0.35),
        f"Coverage {sonar['coverage']}% is under the {COVERAGE_POLICY}% policy",
    )

    if sonar["gate"] == "failed":
        add(8, "SonarQube quality gate failing")
    elif sonar["gate"] == "warn":
        add(4, "SonarQube quality gate at warning")

    # A green dashboard built on stale scans is a lie, so staleness is itself a risk.
    worst_scan = max(
        sonar["lastScanDaysAgo"], cx["lastScanDaysAgo"], sc["lastScanDaysAgo"]
    )
    if worst_scan > 30:
        add(min(10, (worst_scan - 30) * 0.2), f"No scan in {worst_scan} days")

    if not analysis["hasCodeowners"]:
        add(5, "No CODEOWNERS — unowned")
    if analysis["lastCommitDaysAgo"] > 180:
        add(4, f"No commit in {analysis['lastCommitDaysAgo']} days")
    if sc["licenceViolations"] > 0:
        add(4, f"{sc['licenceViolations']} licence violation(s)")

    raw = sum(points for points, _ in contributions) * TIER_WEIGHT[repo["tier"]]
    # Asymptotic rather than clipped at 100: a hard cap tied the three worst repos at
    # the same score, which is precisely where a remediation queue must still rank.
    score = round(100 * (1 - math.exp(-raw / 42)))

    band = (
        "critical"
        if score >= 78
        else "high"
        if score >= 58
        else "elevated"
        if score >= 32
        else "low"
    )

    return {
        "score": score,
        "band": band,
        "slaBreaches": sla_breaches,
        "drivers": [d for _, d in sorted(contributions, key=lambda c: -c[0])[:4]],
    }
