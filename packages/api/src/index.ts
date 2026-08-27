/**
 * @ligma/api — the shared shape of the daemon's HTTP surface.
 *
 * The one package web, cli and daemon all import for API types. Mostly types,
 * route path constants and SSE event names, but some modules (e.g. `./deck`)
 * ship pure functions too — this package is the shared contract layer, not a
 * types-only one.
 */
export * from './types';
export * from './verification';
export * from './limits';
export * from './routes';
export * from './sse';
export * from './deck';
export * from './journeys';
export * from './knowledge';
export * from './adoption';
export * from './shapes';
export * from './designs';
export * from './promote';
export * from './briefs';
export * from './evidence-pins';
export * from './catalogs';
export * from './health';
export * from './goals';
export * from './probes';
export * from './library-meta';
export * from './talk';
