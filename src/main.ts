// Mount + wiring. The only entry point.
import { COVERAGE_POLICY, type PortfolioResponse, type Repo, type RepoSummary } from '../shared/types.ts';
import { getPortfolio, getRepo } from './api.ts';
import { barChart } from './ui/bar-chart.ts';
import { el } from './ui/dom.ts';
import { detail } from './ui/detail.ts';
import { EMPTY_FILTERS, applyFilters, filters, type FilterState } from './ui/filters.ts';
import { SUPPORT_STATUS, num, pct } from './ui/format.ts';
import { leaderboard, type SortKey } from './ui/leaderboard.ts';
import { statTile } from './ui/stat-tile.ts';

const mount = document.querySelector<HTMLElement>('#app');
if (!mount) throw new Error('#app not found');
// Bound after the guard so the narrowed type survives into the render closures.
const app: HTMLElement = mount;

type State = {
  portfolio: PortfolioResponse | null;
  filters: FilterState;
  sort: SortKey;
  dir: 'asc' | 'desc';
  selected: string | null;
  selectedRepo: Repo | null;
  tables: boolean;
};

const state: State = {
  portfolio: null, filters: EMPTY_FILTERS, sort: 'risk', dir: 'desc',
  selected: null, selectedRepo: null, tables: false,
};

const SORTERS: Record<SortKey, (r: RepoSummary) => number | string> = {
  risk: (r) => r.risk.score,
  coverage: (r) => r.sonar.coverage,
  criticals: (r) => r.sonatype.violations.critical + r.checkmarx.findings.critical,
  sla: (r) => r.risk.slaBreaches,
  name: (r) => r.name,
};

/** Spring Boot spread. Ordered axis already encodes recency, so all bars share one
 *  hue — colouring by version too would double-encode what position shows. */
function springBootChart(repos: RepoSummary[]) {
  const order = ['3.5', '3.4', '3.3', '3.2', '3.1', '2.7'];
  const bars = order.map((version) => {
    const matching = repos.filter((r) => r.analysis.springBoot === version);
    const support = matching[0]?.analysis.springBootSupport
      ?? (version >= '3.4' ? 'supported' : version === '3.3' ? 'oss-ended' : 'eol');
    const status = SUPPORT_STATUS[support];
    return {
      key: version,
      value: matching.length,
      sublabel: {
        icon: status.icon, role: status.role,
        text: support === 'supported' ? 'supported' : support === 'oss-ended' ? 'OSS ended' : 'EOL',
      },
      detail: [status.label, `Tier 1: ${matching.filter((r) => r.tier === 'tier-1').length}`],
    };
  });
  return barChart({ bars, keyHeader: 'Spring Boot', valueHeader: 'Repositories' });
}

/** Distribution, not an average — an average hides the tail that policy cares about. */
function coverageChart(repos: RepoSummary[]) {
  const bars = Array.from({ length: 10 }, (_, i) => {
    const lo = i * 10;
    const matching = repos.filter((r) => r.sonar.coverage >= lo && r.sonar.coverage < lo + 10);
    return {
      key: `${lo}–${lo + 9}`,
      value: matching.length,
      detail: matching.slice(0, 3).map((r) => r.name),
    };
  });
  return barChart({
    bars, keyHeader: 'Coverage band', valueHeader: 'Repositories',
    threshold: { value: COVERAGE_POLICY, label: `${COVERAGE_POLICY}% policy`, axis: 'x' },
  });
}

function chartCard(title: string, sub: string, built: { chart: SVGSVGElement; table: HTMLElement }): HTMLElement {
  return el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [el('h3', { class: 'card__title', text: title })]),
    el('p', { class: 'card__sub', text: sub }),
    state.tables ? built.table : built.chart,
  ]);
}

function kpis(portfolio: PortfolioResponse): HTMLElement {
  const { totals, history } = portfolio;
  const first = history[0];
  const last = history[history.length - 1];
  const coverageDelta = last.coverage - first.coverage;
  const criticalDelta = last.criticals - first.criticals;

  return el('div', { class: 'kpis', 'data-testid': 'kpis' }, [
    statTile({ label: 'Repositories', value: String(totals.repos) }),
    statTile({
      label: 'Quality gate passing', value: pct(totals.gatePassRate),
      delta: { text: `${totals.repos - Math.round((totals.gatePassRate / 100) * totals.repos)} failing or warning`, dir: 'flat' },
    }),
    statTile({
      label: 'Median coverage', value: pct(totals.medianCoverage),
      delta: {
        text: `${coverageDelta >= 0 ? '+' : ''}${coverageDelta} pts vs 12w ago`,
        dir: coverageDelta > 0 ? 'good' : coverageDelta < 0 ? 'bad' : 'flat',
      },
      trend: history.map((h) => h.coverage),
    }),
    statTile({
      label: 'Findings past SLA', value: num(totals.slaBreaches),
      delta: {
        text: `${criticalDelta <= 0 ? '' : '+'}${criticalDelta} criticals vs 12w ago`,
        dir: criticalDelta < 0 ? 'good' : criticalDelta > 0 ? 'bad' : 'flat',
      },
      trend: history.map((h) => h.criticals),
    }),
    statTile({
      label: 'On end-of-life Spring Boot', value: String(totals.eolRepos),
      delta: { text: `${pct((totals.eolRepos / totals.repos) * 100)} of the estate`, dir: 'bad' },
    }),
    statTile({
      label: 'Stale scans (>30d)', value: String(totals.staleScans),
      delta: { text: `${totals.unowned} without CODEOWNERS`, dir: 'flat' },
    }),
  ]);
}

function render(): void {
  const portfolio = state.portfolio;
  if (!portfolio) return;

  const visible = applyFilters(portfolio.repos, state.filters);
  const sorted = [...visible].sort((a, b) => {
    const av = SORTERS[state.sort](a);
    const bv = SORTERS[state.sort](b);
    const cmp = typeof av === 'string' ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
    return state.dir === 'desc' ? -cmp : cmp;
  });

  const tablesBtn = el('button', {
    class: 'btn', type: 'button', 'aria-pressed': String(state.tables),
    'data-testid': 'toggle-tables', text: state.tables ? 'Show charts' : 'Show data tables',
  });
  tablesBtn.addEventListener('click', () => { state.tables = !state.tables; render(); });

  const themeBtn = el('button', { class: 'btn', type: 'button', 'data-testid': 'toggle-theme', text: 'Toggle theme' });
  themeBtn.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  });

  app.replaceChildren(
    el('div', { class: 'head' }, [
      el('h1', { text: 'Java estate — quality & lifecycle' }),
      el('span', {
        class: 'head__meta',
        text: `${portfolio.totals.repos} repositories · latest Spring Boot ${portfolio.latestSpringBoot} · mocked data`,
      }),
      el('span', { class: 'head__spacer' }),
      tablesBtn,
      themeBtn,
    ]),

    kpis(portfolio),
    filters(portfolio.repos, state.filters, visible.length, (next) => {
      state.filters = next;
      render();
    }),

    el('div', { class: 'grid' }, [
      chartCard('Spring Boot spread', `How much of the estate is on a supported release. ${portfolio.totals.eolRepos} repositories are end-of-life.`, springBootChart(visible)),
      chartCard('Coverage distribution', `Repositories per coverage band, against the ${COVERAGE_POLICY}% policy floor.`, coverageChart(visible)),
    ]),

    el('section', { class: 'card' }, [
      el('div', { class: 'card__head' }, [
        el('h3', { class: 'card__title', text: 'Remediation queue' }),
        el('span', { class: 'card__spacer' }),
        el('span', { class: 'head__meta', text: 'Click a repository for detail' }),
      ]),
      el('p', { class: 'card__sub', text: 'Ranked by composite risk: unremediated criticals, SLA breach, framework support state, coverage gap, scan staleness and ownership — weighted by business tier.' }),
      sorted.length === 0
        ? el('p', { class: 'empty', 'data-testid': 'empty', text: 'No repositories match these filters.' })
        : leaderboard(sorted, { sort: state.sort, dir: state.dir, selected: state.selected }, {
            onSort: (key) => {
              if (state.sort === key) state.dir = state.dir === 'desc' ? 'asc' : 'desc';
              else { state.sort = key; state.dir = key === 'name' ? 'asc' : 'desc'; }
              render();
            },
            onSelect: (name) => { void selectRepo(name); },
          }),
    ]),

    ...(state.selectedRepo ? [detail(state.selectedRepo)] : []),
  );
}

async function selectRepo(name: string): Promise<void> {
  state.selected = name;
  const { repo } = await getRepo(name);
  state.selectedRepo = repo;
  render();
  document.querySelector('[data-testid="detail"]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

getPortfolio()
  .then((portfolio) => {
    state.portfolio = portfolio;
    render();
  })
  .catch((error: unknown) => {
    app.replaceChildren(el('pre', { class: 'error', text: String(error) }));
  });
