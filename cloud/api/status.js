'use strict';

// GET /api/status — authentication-ready cloud surface stub.
//
// Contract:
// - Reports auth + local-agent pairing placeholders, plus the live Neon
//   database status ('connected' | 'not_configured' | 'unavailable').
// - Reads DATABASE_URL only inside the shared probe; this handler never
//   sees credentials and returns no connection strings or metadata.
// - Endpoints list covers only the safe cloud surface. No local-runtime imports.

const { checkDatabaseStatus } = require('./lib/db');

module.exports = async (req, res) => {
  const databaseStatus = await checkDatabaseStatus(process.env);
  res.status(200).json({
    service: 'tom-cloud',
    version: '0.1.0',
    auth: 'not_configured',
    database: {
      provider: 'neon',
      status: databaseStatus
    },
    localAgent: {
      status: 'not_paired'
    },
    endpoints: ['/api/health', '/api/status']
  });
};
