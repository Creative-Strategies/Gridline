/** Published Gridline package version. Kept in sync by verify-release.mjs. */
export const GRIDLINE_VERSION = "0.2.1";

/**
 * Same-origin prefix used for Next.js worker entrypoints and their module
 * chunks. Including the package version gives the worker response a new HTTP
 * cache identity whenever Gridline is released.
 */
export const GRIDLINE_WORKER_ASSET_PREFIX =
  `/_gridline/worker/${GRIDLINE_VERSION}` as const;
