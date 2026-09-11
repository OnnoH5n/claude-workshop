# Estate Dashboard Test Plan

## Application Overview

A portfolio dashboard over ~44 mocked Java repositories, aggregating SonarQube,
Checkmarx, Sonatype Lifecycle and repo-level analysis into a ranked remediation
queue. It answers three questions: is the estate on supported framework versions,
is it meeting the coverage policy, and which repositories should be fixed first.

## Test Scenarios

### 1. Portfolio overview

**Seed:** `tests/seed.spec.ts`

#### 1.1. should-render-portfolio-totals

**File:** `tests/portfolio/should-render-portfolio-totals.spec.ts`

**Steps:**
  1. Load the dashboard
    - expect: the KPI row shows repo count, gate pass rate, median coverage and EOL count from `/api/portfolio`
    - expect: every repository appears in the queue
    - expect: the queue is ordered by risk score, worst first

#### 1.2. should-filter-the-estate

**File:** `tests/portfolio/should-filter-the-estate.spec.ts`

**Steps:**
  1. Select "End of life" in the Spring Boot filter
    - expect: the row count drops and the shown-count label agrees
    - expect: every surviving row is labelled "End of life" in text, not colour alone
  2. Apply filters that match nothing
    - expect: an explicit empty state, not a blank table

### 2. Repository detail

**Seed:** `tests/seed.spec.ts`

#### 2.1. should-open-repository-detail

**File:** `tests/portfolio/should-open-repository-detail.spec.ts`

**Steps:**
  1. Click the worst repository in the queue
    - expect: detail resolves from `GET /api/repos/:name` and names that repository
    - expect: all four QA sources are represented
    - expect: the risk score is explained by at least one driver
  2. Toggle the data-table view
    - expect: chart values are reachable as a table, so nothing is hover-only
