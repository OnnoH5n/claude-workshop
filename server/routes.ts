// Plain (req, res) handlers — no Vite import anywhere in this file, so the whole
// route table lifts into a standalone `node server/main.ts` unchanged if needed.
//
// Reads come from Postgres (server/db/queries.ts). The JSON contract is unchanged
// from the flat-file version, which is what lets the existing e2e suite verify the
// swap rather than being rewritten around it.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PortfolioResponse, RepoResponse } from '../shared/types.ts';
import { isReady } from './db/connect.ts';
import { ingest } from './db/ingest.ts';
import { findComponent, getPortfolio, getRepo } from './db/queries.ts';

type Handler = (ctx: { res: ServerResponse; url: URL }) => Promise<void>;

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

const routes: Array<{ method: string; pattern: string; handler: Handler }> = [
  {
    method: 'GET',
    pattern: '/api/portfolio',
    handler: async ({ res }) => {
      send(res, 200, (await getPortfolio()) satisfies PortfolioResponse);
    },
  },
  {
    method: 'GET',
    pattern: '/api/repos/:name',
    handler: async ({ res, url }) => {
      const name = decodeURIComponent(url.pathname.split('/')[3] ?? '');
      const repo = await getRepo(name);
      if (!repo) return send(res, 404, { error: `no repo ${name}` });
      send(res, 200, { repo } satisfies RepoResponse);
    },
  },
  {
    // The question a bare component count could never answer: during an incident,
    // which repositories ship this dependency, and at what version.
    method: 'GET',
    pattern: '/api/components',
    handler: async ({ res, url }) => {
      const search = url.searchParams.get('q') ?? '';
      if (search.length < 3) return send(res, 400, { error: 'q must be at least 3 characters' });
      send(res, 200, { matches: await findComponent(search) });
    },
  },
  {
    // Re-applies the schema and re-ingests the seed. Gives tests a clean starting
    // state and lets the demo be re-run from scratch in front of an audience.
    method: 'POST',
    pattern: '/api/reset',
    handler: async ({ res }) => {
      const repos = await ingest();
      send(res, 200, { repos });
    },
  },
];

function matches(pattern: string, pathname: string): boolean {
  const p = pattern.split('/');
  const a = pathname.split('/');
  if (p.length !== a.length) return false;
  return p.every((seg, i) => seg.startsWith(':') || seg === a[i]);
}

/** Returns false when no route matched, so the caller can fall through. */
export async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const route = routes.find((r) => r.method === req.method && matches(r.pattern, url.pathname));
  if (!route) return false;

  try {
    // First run against an empty database bootstraps itself rather than 500-ing.
    if (!(await isReady())) await ingest();
    await route.handler({ res, url });
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : 'unknown' });
  }
  return true;
}
