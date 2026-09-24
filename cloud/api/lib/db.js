'use strict';

// Shared Neon database probe for the TOM cloud surface.
//
// Contract:
// - Reads ONLY process.env.DATABASE_URL (wired by the Vercel-Neon
//   integration for Production + Preview). No other env var, no fallback
//   connection string, nothing hardcoded.
// - Runs a single lightweight `SELECT 1` with a bounded timeout.
// - Returns one of 'connected' | 'not_configured' | 'unavailable'.
// - NEVER returns, logs, or throws credential material, connection
//   strings, error details, or database metadata.

const PROBE_TIMEOUT_MS = 5000;

async function checkDatabaseStatus(env = process.env) {
  const connectionString = env ? env.DATABASE_URL : undefined;
  if (typeof connectionString !== 'string' || connectionString.trim() === '') {
    return 'not_configured';
  }

  let sql;
  try {
    const { neon } = require('@neondatabase/serverless');
    sql = neon(connectionString);
  } catch {
    return 'unavailable';
  }

  let timer = null;
  try {
    const probe = sql('SELECT 1');
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('database probe timed out')), PROBE_TIMEOUT_MS);
      if (timer.unref) timer.unref();
    });
    await Promise.race([probe, timeout]);
    return 'connected';
  } catch {
    return 'unavailable';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { checkDatabaseStatus, PROBE_TIMEOUT_MS };
