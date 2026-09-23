const evidenceByPath = new Map();

function recordAppliedTask(record) {
  if (!record || typeof record.path !== "string" || !record.path) {
    throw new Error("Applied task evidence requires a path");
  }
  const stored = {
    approvalId: record.approvalId,
    path: record.path,
    edits: Array.isArray(record.edits) ? record.edits.map((edit) => ({ ...edit })) : [],
    application: record.application ? { ...record.application } : null,
    diagnostics: record.diagnostics ? { ...record.diagnostics } : null,
    terminal: record.terminal ? { ...record.terminal } : null,
    appliedAt: record.appliedAt || new Date().toISOString(),
    verifiedAt: record.verifiedAt || new Date().toISOString()
  };
  evidenceByPath.set(record.path, stored);
  return stored;
}

function getLatestByPath(path) {
  return evidenceByPath.get(path) || null;
}

function updateVerification(path, diagnostics, terminal) {
  const current = getLatestByPath(path);
  if (!current) return null;
  return recordAppliedTask({
    ...current,
    diagnostics,
    terminal: terminal || current.terminal,
    verifiedAt: new Date().toISOString()
  });
}

function resetForTests() {
  evidenceByPath.clear();
}

module.exports = { recordAppliedTask, getLatestByPath, updateVerification, resetForTests };