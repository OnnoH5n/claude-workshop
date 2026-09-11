// Thin adapter mounting the route table into Vite's dev server, so the app and the
// API share one process, one port, and one log. This is the only Vite-aware file
// in server/ — deliberately, so routes.ts stays portable.
import type { Plugin } from 'vite';
import { handle } from './routes.ts';

export function apiPlugin(): Plugin {
  return {
    name: 'workshop-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        handle(req, res).then((handled) => {
          if (!handled) next();
        }, next);
      });
    },
  };
}
