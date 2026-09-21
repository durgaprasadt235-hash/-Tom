/* Project-scoped visualization. No integration mutations are sent from this module. */
window.TomTopology = (() => {
  'use strict';
  const labels = { connected: 'Connected', working: 'Working', warning: 'Warning', error: 'Error', not_connected: 'Not Connected', disabled: 'Disabled', unknown: 'Unknown' };
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls || ''; if (text !== undefined) e.textContent = text; return e; };
  let panelSignature = '';
  let options, snapshot, selected = null, tab = 'Overview', filter = 'all', query = '', stale = false;
  let positions = {}, viewport = { x: 0, y: 0, zoom: 1 }, saved = false, dirty = false, request, timer, drag, frame;
  const nodeElements = new Map(), edgeElements = new Map();
  const key = () => `tom:topology:layout:v1:${options.projectId}`;
  const active = () => !document.hidden && $('topology').classList.contains('active');
  const status = node => stale ? 'unknown' : (labels[node.operationalStatus] ? node.operationalStatus : 'unknown');
  function message(text) { $('topoMessage').textContent = text; }
  function changed() { dirty = true; message('Layout has unsaved changes'); }
  function transform() { $('topoWorld').style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`; $('topoZoomValue').textContent = `${Math.round(viewport.zoom * 100)}%`; }
  function restore() {
    try {
      const data = JSON.parse(localStorage.getItem(key()));
      if (!data || data.schemaVersion !== 1 || data.projectId !== options.projectId) return;
      positions = Object.fromEntries(Object.entries(data.positions || {}).filter(([id, p]) => /^(project|plugin):/.test(id) && p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 1e6 && Math.abs(p.y) < 1e6));
      const v = data.viewport;
      if (v && [v.x, v.y, v.zoom].every(Number.isFinite) && v.zoom >= .2 && v.zoom <= 2) viewport = v;
      saved = true;
    } catch { message('Saved layout unavailable; using automatic layout'); }
  }
  function layout(reset = false) {
    if (!snapshot) return;
    const related = new Set(snapshot.edges.flatMap(e => [e.source, e.target]));
    let linked = 0, unlinked = 0;
    snapshot.nodes.forEach(node => {
      let point;
      if (node.type === 'project') point = { x: 350, y: 170 };
      else if (related.has(node.id)) { const angle = linked++ * 2.399; point = { x: 350 + 290 * Math.cos(angle), y: 170 + 140 * Math.sin(angle) }; }
      else { const i = unlinked++; point = { x: 65 + (i % 3) * 260, y: 425 + Math.floor(i / 3) * 110 }; }
      if (reset || !positions[node.id]) positions[node.id] = point;
    });
    $('topoUnverified').hidden = !unlinked;
    drawPositions();
  }
  function drawPositions() {
    nodeElements.forEach((element, id) => { const p = positions[id]; if (p) { element.style.left = `${p.x}px`; element.style.top = `${p.y}px`; } });
    snapshot?.edges.forEach(edge => {
      const p = positions[edge.source], q = positions[edge.target], group = edgeElements.get(edge.id);
      if (!p || !q || !group) return;
      const reverse = edge.activeDestination === edge.source;
      const a = reverse ? q : p, b = reverse ? p : q;
      group.querySelector('path').setAttribute('d', `M ${a.x + 110} ${a.y + 42} L ${b.x + 110} ${b.y + 42}`);
      const text = group.querySelector('text'); text.setAttribute('x', (a.x + b.x) / 2 + 110); text.setAttribute('y', (a.y + b.y) / 2 + 30);
    });
    transform();
  }
  function fit() {
    const nodes = [...nodeElements].filter(([, e]) => !e.hidden).map(([id]) => positions[id]).filter(Boolean);
    if (!nodes.length) return;
    const minX = Math.min(...nodes.map(p => p.x)) - 35, minY = Math.min(...nodes.map(p => p.y)) - 45;
    const width = Math.max(...nodes.map(p => p.x)) + 255 - minX, height = Math.max(...nodes.map(p => p.y)) + 125 - minY;
    const canvas = $('topologyCanvas');
    viewport.zoom = Math.max(.2, Math.min(1.15, canvas.clientWidth / width, (canvas.clientHeight - 65) / height));
    viewport.x = (canvas.clientWidth - width * viewport.zoom) / 2 - minX * viewport.zoom;
    viewport.y = 25 - minY * viewport.zoom;
    transform();
  }
  function zoom(factor) {
    const canvas = $('topologyCanvas'), x = canvas.clientWidth / 2, y = canvas.clientHeight / 2;
    const next = Math.max(.2, Math.min(2, viewport.zoom * factor)), ratio = next / viewport.zoom;
    viewport.x = x - (x - viewport.x) * ratio; viewport.y = y - (y - viewport.y) * ratio; viewport.zoom = next;
    transform(); changed();
  }
  function render() {
    if (!snapshot) return;
    $('topoProject').textContent = `${snapshot.project.name} / Project workspace`;
    document.querySelector('.project-selector strong').textContent = snapshot.project.name;
    const ids = new Set(snapshot.nodes.map(n => n.id));
    nodeElements.forEach((element, id) => { if (!ids.has(id)) { element.remove(); nodeElements.delete(id); } });
    snapshot.nodes.forEach(node => {
      let button = nodeElements.get(node.id);
      if (!button) {
        button = el('button', 'topo-node'); button.type = 'button'; button.dataset.nodeId = node.id;
        const icon = el('span', 'topo-icon');
        if (node.type === 'project') icon.textContent = 'T'; else options.renderIcon(icon, { id: node.pluginId });
        const copy = el('span', 'topo-node-copy'); copy.append(el('strong'), el('span'), el('small'));
        button.append(icon, copy); $('topoNodes').append(button); nodeElements.set(node.id, button);
        button.addEventListener('click', () => { if (button.dataset.dragged === 'true') { button.dataset.dragged = 'false'; return; } selected = node.id; tab = 'Overview'; renderPanel(); renderSelection(); });
        button.addEventListener('keydown', event => {
          if (!event.shiftKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation(); const p = positions[node.id]; p.x += event.key === 'ArrowRight' ? 15 : event.key === 'ArrowLeft' ? -15 : 0; p.y += event.key === 'ArrowDown' ? 15 : event.key === 'ArrowUp' ? -15 : 0; drawPositions(); changed();
        });
      }
      button.className = `topo-node ${node.type === 'project' ? 'topo-project' : `state-${status(node)}`}`;
      const copy = button.querySelector('.topo-node-copy'); copy.children[0].textContent = node.type === 'project' ? 'TOM' : node.label;
      copy.children[1].textContent = node.type === 'project' ? node.label : node.category || 'Not reported';
      copy.children[2].textContent = node.type === 'project' ? 'Workspace Orchestrator' : stale ? 'Stale / Unknown' : node.rawStatus === 'configuration_required' ? 'Setup required' : node.rawStatus === 'installed' ? 'Connection not verified' : labels[status(node)];
      button.setAttribute('aria-label', `${node.label}. ${copy.children[2].textContent}. Shift plus arrow keys to reposition.`);
    });
    const edgeIds = new Set(snapshot.edges.map(e => e.id));
    edgeElements.forEach((element, id) => { if (!edgeIds.has(id)) { element.remove(); edgeElements.delete(id); } });
    snapshot.edges.forEach(edge => {
      let group = edgeElements.get(edge.id);
      if (!group) {
        group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.append(document.createElementNS(group.namespaceURI, 'path'), document.createElementNS(group.namespaceURI, 'text'));
        $('topoEdges').append(group); edgeElements.set(edge.id, group);
      }
      const working = edge.activityState === 'working' && [edge.source, edge.target].includes(edge.activeDestination);
      group.setAttribute('class', `state-${stale ? 'unknown' : working ? 'working' : edge.status === 'working' ? 'unknown' : edge.status}`);
      group.querySelector('text').textContent = edge.relationship;
    });
    layout(); applyFilters(); renderSelection(); renderSummaries(); renderPanel();
    $('topoUpdated').textContent = `${stale ? 'Last successful refresh' : 'Updated'} ${new Date(snapshot.observedAt).toLocaleTimeString()}`;
  }
  function renderSelection() { nodeElements.forEach((element, id) => { element.classList.toggle('selected', selected === id); element.setAttribute('aria-pressed', String(selected === id)); }); }
  function applyFilters() {
    if (!snapshot) return;
    const matchingEdges = snapshot.edges.filter(e => e.relationship.toLowerCase().includes(query));
    let visible = 0;
    snapshot.nodes.forEach(node => {
      const match = [node.label, node.vendor, node.category].filter(Boolean).join(' ').toLowerCase().includes(query) || matchingEdges.some(e => [e.source, e.target].includes(node.id));
      const show = node.type === 'project' || (match && (filter === 'all' || status(node) === filter));
      nodeElements.get(node.id).hidden = !show; if (show && node.type === 'plugin') visible++;
    });
    snapshot.edges.forEach(edge => { edgeElements.get(edge.id).style.display = nodeElements.get(edge.source)?.hidden || nodeElements.get(edge.target)?.hidden ? 'none' : ''; });
    $('topoEmpty').hidden = visible > 0;
    $('topoEmpty').textContent = snapshot.nodes.length === 1 ? 'No integrations installed for this project' : 'No matching integrations';
    $('topoSummary').textContent = `${snapshot.nodes.length - 1} integrations · ${snapshot.edges.length} verified relationships`;
    $('topoFilters').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
  }
  function renderSummaries() {
    const plugins = snapshot.nodes.filter(n => n.type === 'plugin');
    $('topoHealth').replaceChildren(...Object.entries(labels).map(([s, label]) => { const row = el('div', `state-${s}`); row.append(el('strong', '', String(plugins.filter(n => status(n) === s).length)), el('span', '', label)); return row; }));
    const alerts = plugins.filter(n => ['warning', 'error', 'unknown'].includes(status(n)));
    $('topoAlerts').replaceChildren(...(alerts.length ? alerts.map(n => el('p', `state-${status(n)}`, `${n.label}: ${stale ? 'status is stale' : n.rawStatus === 'configuration_required' ? 'setup required' : n.rawStatus === 'degraded' ? 'degraded' : labels[status(n)]}`)) : [el('p', '', 'No integration alerts')]));
    const activityMessage = event => {
      const labels = {
        'vscode.workspace.info': 'Read workspace',
        'vscode.workspace.tree': 'Read workspace tree',
        'vscode.file.active': 'Read active file',
        'vscode.diagnostics': 'Read diagnostics',
        'vscode.file.read': 'Read project file'
      };
      const states = {
        operation_started: 'Started',
        operation_completed: 'Completed',
        operation_failed: 'Failed'
      };
      const timestamp = event.completedAt || event.startedAt;
      const time = timestamp ? new Date(timestamp).toLocaleTimeString() : 'Unknown time';
      return `${event.pluginId === 'vscode' ? 'VS Code' : event.pluginId} · ${labels[event.capability] || event.capability} · ${states[event.state] || event.state} · ${time}`;
    };
    $('topoActivity').replaceChildren(...(snapshot.activity.length ? snapshot.activity.slice().reverse().map(a => el('p', '', activityMessage(a))) : [el('p', '', 'No recent integration activity')]));
  }
  function renderPanel() {
    const panel = $('topoPanel'), node = snapshot.nodes.find(n => n.id === selected);
    panel.hidden = !node && selected !== 'connections';
    if (panel.hidden) { panelSignature = ''; return; }
    const signature = JSON.stringify({ node: node && { ...node, observedAt: null }, edges: snapshot.edges.map(e => ({ ...e, observedAt: null })), selected, tab, stale });
    if (signature === panelSignature && tab !== 'Connection') return;
    panelSignature = signature;
    const scrollTop = panel.scrollTop;
    const focusedTab = panel.contains(document.activeElement) && document.activeElement.getAttribute('role') === 'tab';
    const close = el('button', 'topo-close', '×'); close.setAttribute('aria-label', 'Close details'); close.onclick = () => { selected = null; panelSignature = ''; panel.hidden = true; renderSelection(); };
    const title = el('h2', '', node?.label || 'Add Connection'); panel.replaceChildren(close, el('span', 'topo-eyebrow', 'WORKSPACE INSPECTOR'), title);
    if (node?.type === 'plugin') { const icon = el('span', 'topo-icon'); options.renderIcon(icon, { id: node.pluginId }); title.prepend(icon); }
    if (!node) { panel.append(el('p', '', 'Connection creation is not available. No authorized connection handlers are configured for this workspace. Installed applications appear without edges until a relationship is verified.')); return; }
    panel.append(el('p', '', node.type === 'project' ? 'Workspace Orchestrator · Status not reported' : `${node.vendor || 'Vendor not reported'} · ${stale ? 'Stale / Unknown' : labels[status(node)]}`));
    const tabs = el('div', 'topo-tabs'); tabs.setAttribute('role', 'tablist');
    ['Overview', 'Connection', 'Permissions', 'Usage', 'Settings'].forEach(name => { const b = el('button', '', name); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(name === tab)); b.onclick = () => { tab = name; renderPanel(); }; tabs.append(b); }); panel.append(tabs);
    const body = el('div', 'topo-panel-body'); body.setAttribute('role', 'tabpanel'); body.setAttribute('aria-label', tab);
    const field = (label, value) => { body.append(el('h3', '', label), el('p', '', value || 'Not reported')); };
    if (tab === 'Overview') {
      field('Description', node.description || (node.type === 'project' ? 'Current project orchestration workspace' : null));
      field('Category', node.category); field('Billing', node.billingMode?.replaceAll('_', ' ')); field('Connection type', node.connectionType);
      field('Installed time', null); field('Version', node.connection?.version); field('Manifest capabilities', node.capabilities?.map(c => `${c.name} — ${c.description}`).join('\n'));
    } else if (tab === 'Connection') {
      field('Connection evidence', node.connection?.connected ? 'Verified VS Code workspace session' : 'Connection not verified');
      field('Runtime source', node.connection?.source); field('Connected since', node.connection?.connectedAt);
      field('Last status observation', node.observedAt); field('API / Data access / Sync jobs / Latency', null);
      field('Verified relationships', snapshot.edges.filter(e => [e.source, e.target].includes(node.id)).map(e => e.relationship).join(', ') || 'Not configured');
    } else if (tab === 'Permissions') {
      field('Assigned role', 'Not available — no authoritative role provider'); field('Authorized integration actions', 'Not available');
      field('Manifest risk levels (not user grants)', node.riskLevels?.join(', ')); field('Supported authentication', node.supportedAuth?.join(', '));
      field('Runtime-available capabilities (not user grants)', node.runtimeCapabilities?.map(c => c.name).join('\n') || 'Not available');
    } else if (tab === 'Usage') { field('Integration activity', 'No recent integration activity'); field('Usage / Last sync', null); }
    else { field('Integration settings', 'Not available — no authorized configuration handler'); field('Layout', 'Visual coordinates are saved locally for this project and browser.'); }
    panel.append(body);
    // Action descriptors are reserved for server authorization; no privileged handlers are wired here.
    if (node.type === 'plugin') { const details = el('button', 'topo-details', 'View Plugin Details'); details.onclick = () => options.viewDetails(node); panel.append(details); }
    panel.scrollTop = scrollTop;
    if (focusedTab) [...tabs.children].find(b => b.textContent === tab)?.focus();
  }
  async function refresh() {
    if (!options || !active() || request) return;
    request = new AbortController(); const controller = request;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`/projects/${encodeURIComponent(options.projectId)}/topology`, { signal: controller.signal });
      if (!response.ok) throw new Error('Snapshot unavailable');
      const data = await response.json();
      if (data.project.id !== options.projectId || !active()) return;
      const first = !snapshot; snapshot = data; stale = false; render();
      if (first && !saved) fit();
      if (!dirty) message('Drag nodes to arrange · Drag canvas to pan');
    } catch (error) { if (active()) { stale = true; if (snapshot) render(); message('Topology unavailable. Existing observations are stale; retrying automatically.'); } }
    finally { clearTimeout(timeout); if (request === controller) request = null; }
  }
  function visibility() { clearInterval(timer); if (active()) { refresh(); timer = setInterval(refresh, 15000); } else { request?.abort(); } }
  function init(config) {
    options = config; restore(); transform();
    Object.entries({ all: 'All', ...labels }).forEach(([value, label]) => { const b = el('button', '', label); b.dataset.filter = value; b.onclick = () => { filter = value; applyFilters(); }; $('topoFilters').append(b); });
    Object.entries(labels).forEach(([value, label]) => $('topoLegend').append(el('span', `state-${value}`, label)));
    $('topoSearch').oninput = event => { query = event.target.value.trim().toLowerCase(); applyFilters(); };
    $('topoAuto').onclick = () => { layout(true); fit(); changed(); };
    $('topoFit').onclick = () => { fit(); changed(); };
    $('topoZoomIn').onclick = () => zoom(1.2); $('topoZoomOut').onclick = () => zoom(1 / 1.2);
    $('topoSave').onclick = () => { try { localStorage.setItem(key(), JSON.stringify({ schemaVersion: 1, projectId: options.projectId, positions, viewport })); dirty = false; message('Layout saved for this project and browser'); } catch { message('Unable to save layout: browser storage is unavailable'); } };
    $('topoAdd').onclick = () => { if (!snapshot) return; selected = 'connections'; renderPanel(); renderSelection(); };
    const canvas = $('topologyCanvas');
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('.topo-controls')) return;
      const node = event.target.closest('[data-node-id]');
      drag = { pointerId: event.pointerId, id: node?.dataset.nodeId, x: event.clientX, y: event.clientY, start: { ...(node ? positions[node.dataset.nodeId] : viewport) }, moved: false };
      if (node) node.dataset.dragged = 'false'; canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) < 4 && !drag.moved) return;
      drag.moved = true;
      if (drag.id) { positions[drag.id] = { x: drag.start.x + dx / viewport.zoom, y: drag.start.y + dy / viewport.zoom }; nodeElements.get(drag.id).dataset.dragged = 'true'; }
      else { viewport.x = drag.start.x + dx; viewport.y = drag.start.y + dy; }
      cancelAnimationFrame(frame); frame = requestAnimationFrame(drawPositions);
    });
    const end = event => { if (!drag) return; if (drag.moved) changed(); else if (drag.id) { selected = drag.id; tab = 'Overview'; renderPanel(); renderSelection(); } drag = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('keydown', event => { if (event.target !== canvas) return; if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); viewport.x += event.key === 'ArrowLeft' ? 30 : event.key === 'ArrowRight' ? -30 : 0; viewport.y += event.key === 'ArrowUp' ? 30 : event.key === 'ArrowDown' ? -30 : 0; transform(); changed(); } });
    document.addEventListener('visibilitychange', visibility);
    new MutationObserver(visibility).observe($('topology'), { attributes: true, attributeFilter: ['class'] });
    visibility();
  }
  // Future authenticated SSE/WebSocket transport may deliver authoritative snapshots.
  // It must retain operation correlation on the server; no synthetic working events.
  function applyRuntimeSnapshot(data) {
    if (!options || data.schemaVersion !== 1 || data.project?.id !== options.projectId || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return false;
    if (snapshot && Date.parse(data.observedAt) < Date.parse(snapshot.observedAt)) return false;
    snapshot = data; stale = false; render(); return true;
  }
  return { init, refresh, applyRuntimeSnapshot };
})();
