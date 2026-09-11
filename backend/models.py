"""API response models.

These mirror shared/types.ts field-for-field, including camelCase names, because
the frontend contract must not change when the middle tier switches language.

The duplication with shared/types.ts is the real cost of a Python backend behind a
TypeScript frontend. It is contained deliberately: FastAPI emits an OpenAPI schema
at /openapi.json, so shared/types.ts can be generated from these models rather than
hand-maintained. Until that generation step exists, these two files must be edited
together.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Severity = Literal["critical", "serious", "moderate", "low"]
SonarGate = Literal["passed", "warn", "failed"]
SonarRating = Literal["A", "B", "C", "D", "E"]
SupportState = Literal["supported", "oss-ended", "eol"]
Tier = Literal["tier-1", "tier-2", "tier-3"]
RiskBand = Literal["low", "elevated", "high", "critical"]

# Days allowed before a finding of each severity breaches remediation policy.
SLA_DAYS: dict[str, int] = {"critical": 14, "serious": 30, "moderate": 90, "low": 180}

# Only severities with an active remediation clock count towards a breach.
SLA_TRACKED: tuple[str, ...] = ("critical", "serious")

COVERAGE_POLICY = 80


class SonarQube(BaseModel):
    gate: SonarGate
    coverage: float
    newCodeCoverage: float
    duplication: float
    bugs: int
    vulnerabilities: int
    codeSmells: int
    techDebtDays: int
    maintainability: SonarRating
    reliability: SonarRating
    security: SonarRating
    lastScanDaysAgo: int


class Checkmarx(BaseModel):
    findings: dict[Severity, int]
    oldestDays: dict[Severity, int]
    topCategories: list[dict[str, object]]
    lastScanDaysAgo: int


class WorstCve(BaseModel):
    id: str
    cvss: float
    component: str


class Sonatype(BaseModel):
    violations: dict[Severity, int]
    oldestDays: dict[Severity, int]
    components: int
    licenceViolations: int
    waived: int
    worstCve: WorstCve | None
    lastScanDaysAgo: int


class RepoAnalysis(BaseModel):
    springBoot: str
    springBootSupport: SupportState
    springBootBehind: int
    springBootOssSupportEnd: str
    springBootCommercialSupportEnd: str
    java: str
    javaLts: bool
    buildTool: Literal["maven", "gradle"]
    hasReadme: bool
    hasCodeowners: bool
    hasDockerfile: bool
    todoCount: int
    lastCommitDaysAgo: int
    testRatio: float


class Risk(BaseModel):
    score: int
    band: RiskBand
    drivers: list[str]
    slaBreaches: int


class HistoryPoint(BaseModel):
    week: str
    coverage: int
    criticals: int


class RepoSummary(BaseModel):
    """List payload — drops per-repo history to keep the response lean."""

    name: str
    team: str
    domain: str
    tier: Tier
    loc: int
    sonar: SonarQube
    checkmarx: Checkmarx
    sonatype: Sonatype
    analysis: RepoAnalysis
    risk: Risk


class Repo(RepoSummary):
    history: list[HistoryPoint]


class Totals(BaseModel):
    repos: int
    gatePassRate: int
    medianCoverage: int
    slaBreaches: int
    eolRepos: int
    offOssSupport: int
    criticalFindings: int
    techDebtDays: int
    staleScans: int
    unowned: int


class PortfolioResponse(BaseModel):
    generatedAt: datetime
    latestSpringBoot: str
    totals: Totals
    history: list[HistoryPoint]
    repos: list[RepoSummary]


class RepoResponse(BaseModel):
    repo: Repo


class ComponentMatch(BaseModel):
    coordinates: str
    version: str
    repo: str
    direct: bool
    cve: str | None


class ComponentsResponse(BaseModel):
    matches: list[ComponentMatch]


class ResetResponse(BaseModel):
    repos: int = Field(description="Number of repositories re-ingested")
