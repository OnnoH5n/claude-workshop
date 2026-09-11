// Plain (req, res) handlers — no Vite import anywhere in this file, so the whole
// route table lifts into a standalone `node server/main.ts` unchanged if needed.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PortfolioResponse, RepoResponse } from '../shared/types.ts';
import { read, reset } from './store.ts';

type Handler = (ctx: { res: ServerResponse; url: URL }) => void;

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

const routes: Array<{ method: string; pattern: string; handler: Handler }> = [
  {
    method: 'GET',
    pattern: '/api/portfolio',
    handler: ({ res }) => {
      const { repos, ...rest } = read();
      // Strip history per repo — the list view never reads it, and it is ~70% of the payload.
      const summaries = repos.map(({ history: _history, ...summary }) => summary);
      send(res, 200, { ...rest, repos: summaries } satisfies PortfolioResponse);
    },
  },
  {
    method: 'GET',
    pattern: '/api/repos/:name',
    handler: ({ res, url }) => {
      const name = decodeURIComponent(url.pathname.split('/')[3] ?? '');
      const repo = read().repos.find((r) => r.name === name);
      if (!repo) return send(res, 404, { error: `no repo ${name}` });
      send(res, 200, { repo } satisfies RepoResponse);
    },
  },
  {
    // Dev-only (the plugin mounts nothing in a production build). Gives tests a clean
    // starting state and lets the demo be re-run from scratch in front of an audience.
    method: 'POST',
    pattern: '/api/reset',
    handler: ({ res }) => {
      send(res, 200, { totals: reset().totals });
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
    route.handler({ res, url });
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : 'unknown' });
  }
  return true;
}
