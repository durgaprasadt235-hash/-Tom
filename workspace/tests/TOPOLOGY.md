Topology verification
=====================

Model tests (no server or plugin-state mutations):

    node --test workspace/tests/topology.test.js

Browser regression (requires an existing Playwright installation and Chrome):

    TOM_TEST_URL=http://localhost:3017 TOM_PLAYWRIGHT_MODULE=/path/to/playwright node workspace/tests/topology-browser.cjs

Run against a server started from the current source. The browser regression asserts the inspected Drop installation: VS Code, GitHub, Vercel, Neon, and Databricks, with no active bridge relationship. It does not install, enable, disable, or connect integrations. It compares plugin persistence before/after and rejects non-GET requests. Its localStorage writes belong only to an isolated browser context.

Covered: topology API, unknown/prototype project IDs, shared Marketplace/Installed/detail/back navigation, search, status filters, dragging, pan, zoom, fit, automatic layout, save/reload, contextual inspection, unsupported-action absence, responsive overflow at 1440×900 / 900×900 / 390×844, snapshot identity preservation, stale-state recovery, reduced-motion CSS, and browser exceptions.

The reduced-motion check briefly inserts an isolated SVG test element, reads its computed animation style, then removes it. It does not generate runtime activity or change the application snapshot.

Current limitations: no role provider, authorized integration mutation handlers, generic verified relationship store, or project/plugin activity feed. Layout storage is browser-local and project-scoped. An active bridge is required to emit a verified VS Code relationship; installed state alone never produces edges. This implementation does not wire bridge handshake/heartbeat routes.
