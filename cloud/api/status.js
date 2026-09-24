'use strict';

// GET /api/status — authentication-ready cloud surface stub.
//
// Contract:
// - Reports readiness slots (auth, database, local-agent pairing) as
//   explicit "not_configured" / "not_paired" placeholders.
// - Adds no secrets, no credentials, no connection strings, no endpoints
//   beyond the safe cloud surface. No local-runtime imports.

module.exports = (req, res) => {
  res.status(200).json({
    service: 'tom-cloud',
    version: '0.1.0',
    auth: 'not_configured',
    database: {
      provider: 'neon',
      status: 'not_configured'
    },
    localAgent: {
      status: 'not_paired'
    },
    endpoints: ['/api/health', '/api/status']
  });
};
