'use strict';

// GET /api/health — safe cloud health probe.
//
// Contract:
// - Static payload only. No environment reads, no filesystem access,
//   no process/host introspection, no local-machine information.
// - Must stay dependency-free and import-free (no local-runtime imports).

module.exports = (req, res) => {
  res.status(200).json({
    service: 'tom-cloud',
    status: 'ok',
    version: '0.1.0'
  });
};
