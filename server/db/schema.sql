-- Estate quality & lifecycle schema.
--
-- Two ideas drive the design:
--  1. Scans are append-only snapshots with ABSOLUTE timestamps. Everything the
--     dashboard shows is derived from "the latest scan per repo per tool", and
--     trends come free from the same table instead of being interpolated.
--  2. Each scan keeps the vendor's raw response in `payload` jsonb AND promotes
--     the fields we query into typed, constrained columns. A vendor adding a
--     field costs no migration; charting it later is just a promotion.

drop table if exists risk_snapshot, component_usage, finding, scan, repository cascade;
drop type if exists qa_tool, severity, sonar_gate, support_state, tier cascade;

create type qa_tool        as enum ('sonarqube', 'checkmarx', 'sonatype', 'repo-analysis');
create type severity       as enum ('critical', 'serious', 'moderate', 'low');
create type sonar_gate     as enum ('passed', 'warn', 'failed');
create type support_state  as enum ('supported', 'oss-ended', 'eol');
create type tier           as enum ('tier-1', 'tier-2', 'tier-3');

create table repository (
  id          bigserial primary key,
  name        text        not null unique,
  team        text        not null,
  domain      text        not null,
  tier        tier        not null,
  loc         integer     not null check (loc >= 0),
  -- Ownership and tier genuinely change over time. When that history starts to
  -- matter, this becomes a temporal dimension rather than current-state columns.
  created_at  timestamptz not null default now()
);
create index on repository (team);
create index on repository (tier);

create table scan (
  id             bigserial   primary key,
  repository_id  bigint      not null references repository (id) on delete cascade,
  tool           qa_tool     not null,
  captured_at    timestamptz not null,
  payload        jsonb       not null,

  -- Promoted columns: only what we filter, sort or aggregate on.
  gate                sonar_gate,
  coverage            numeric(5, 2) check (coverage between 0 and 100),
  new_code_coverage   numeric(5, 2) check (new_code_coverage between 0 and 100),
  tech_debt_days      integer,
  spring_boot         text,
  spring_boot_support support_state,
  java_version        text,
  java_lts            boolean,
  has_codeowners      boolean,
  component_count     integer,
  licence_violations  integer,

  -- One scan per tool per repo per instant; makes ingest idempotent.
  unique (repository_id, tool, captured_at)
);
-- Supports the DISTINCT ON (repository_id, tool) ... ORDER BY captured_at DESC
-- that every dashboard query starts from.
create index on scan (repository_id, tool, captured_at desc);
create index on scan (captured_at desc);
create index on scan using gin (payload);

-- Per-finding rows, not per-severity counts. This is what makes SLA ageing, MTTR
-- and new-vs-recurring real rather than approximated from an aggregate.
create table finding (
  id             bigserial   primary key,
  repository_id  bigint      not null references repository (id) on delete cascade,
  tool           qa_tool     not null,
  severity       severity    not null,
  category       text        not null,
  first_seen_at  timestamptz not null,
  resolved_at    timestamptz,
  waived         boolean     not null default false,
  check (resolved_at is null or resolved_at >= first_seen_at)
);
create index on finding (repository_id, severity) where resolved_at is null;
create index on finding (first_seen_at);

-- Dependency inventory. The table that answers "which repos ship this component
-- below this version" during an incident — impossible from a bare count.
create table component_usage (
  id             bigserial primary key,
  repository_id  bigint    not null references repository (id) on delete cascade,
  coordinates    text      not null,           -- group:artifact
  version        text      not null,
  direct         boolean   not null,
  cve_id         text,
  cvss           numeric(3, 1) check (cvss between 0 and 10),
  unique (repository_id, coordinates)
);
-- Leading-wildcard search ("%log4j%") cannot use a btree index. Trigram GIN is what
-- keeps the incident query fast once this table is hundreds of thousands of rows.
create extension if not exists pg_trgm;
create index on component_usage using gin (coordinates gin_trgm_ops);
create index on component_usage (cve_id) where cve_id is not null;

-- The score AS REPORTED at ingest time. Recomputing on read would silently
-- rewrite past quarters whenever the formula is recalibrated.
create table risk_snapshot (
  repository_id  bigint      not null references repository (id) on delete cascade,
  computed_at    timestamptz not null,
  score          integer     not null check (score between 0 and 100),
  band           text        not null,
  sla_breaches   integer     not null,
  drivers        jsonb       not null,
  formula_version text       not null,
  primary key (repository_id, computed_at)
);

-- Latest scan per repo per tool, pivoted to one row per repository. Every
-- dashboard query reads this instead of repeating the window logic.
create view repo_current as
with latest as (
  select distinct on (repository_id, tool) *
    from scan
   order by repository_id, tool, captured_at desc
)
select r.id, r.name, r.team, r.domain, r.tier, r.loc,
       so.gate, so.coverage, so.new_code_coverage, so.tech_debt_days,
       so.captured_at              as sonar_scanned_at,
       cx.captured_at              as checkmarx_scanned_at,
       sc.captured_at              as sonatype_scanned_at,
       sc.component_count, sc.licence_violations,
       ra.spring_boot, ra.spring_boot_support, ra.java_version, ra.java_lts,
       ra.has_codeowners,
       greatest(so.captured_at, cx.captured_at, sc.captured_at) as last_scanned_at,
       -- Staleness uses the OLDEST of the three tools, not the newest: a six-month-old
       -- Checkmarx scan leaves the security picture stale however fresh Sonar is.
       least(so.captured_at, cx.captured_at, sc.captured_at)    as oldest_scanned_at,
       so.payload as sonar_payload, cx.payload as checkmarx_payload,
       sc.payload as sonatype_payload, ra.payload as analysis_payload
  from repository r
  left join latest so on so.repository_id = r.id and so.tool = 'sonarqube'
  left join latest cx on cx.repository_id = r.id and cx.tool = 'checkmarx'
  left join latest sc on sc.repository_id = r.id and sc.tool = 'sonatype'
  left join latest ra on ra.repository_id = r.id and ra.tool = 'repo-analysis';
