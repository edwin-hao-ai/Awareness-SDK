/**
 * F-055 bug B — plugin-side metadata envelope stripper.
 *
 * Thin re-export of the shared implementation in `./_shared/envelope-strip.mjs`
 * (synced from the monorepo SSOT at `sdks/_shared/js/envelope-strip.mjs`).
 * The daemon also filters envelopes (sdks/local/src/core/noise-filter.mjs) as
 * defense-in-depth; this stripper runs earliest — before the `Request: ...`
 * turn_brief is even constructed — so titles stay clean.
 */
export { stripMetadataEnvelope } from './_shared/envelope-strip.mjs';
