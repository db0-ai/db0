/**
 * Leveled logger for db0 using the `debug` library.
 *
 * Enable via DEBUG env var:
 *   DEBUG=db0:*          — all db0 logs
 *   DEBUG=db0:info,db0:warn,db0:error — info and above (default-like)
 *   DEBUG=db0:debug      — debug only
 *   DEBUG=db0:error      — errors only
 *
 * OpenClaw's gateway typically sets DEBUG=* which shows everything.
 * In production, use DEBUG=db0:info,db0:warn,db0:error to hide debug spam.
 */

import createDebug from "debug";

export const log = {
  debug: createDebug("db0:debug"),
  info: createDebug("db0:info"),
  warn: createDebug("db0:warn"),
  error: createDebug("db0:error"),
};

// Route warn/error through stderr (debug defaults to stderr for namespaces
// that don't match stdout, but let's be explicit)
log.warn.log = console.warn.bind(console);
log.error.log = console.error.bind(console);
