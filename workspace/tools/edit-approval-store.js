// In-memory pending-edit approval store for Tom's controlled write POC.
//
// A proposed edit is never written to disk. It is only recorded here with a
// unique, single-use, expiring approval id. Only vscode.file.apply_edit may
// consume an approval, and only after validating id, path, expiry, and
// single-use state.

const crypto = require("crypto");

const APPROVAL_TTL_MS = 5 * 60 * 1000; // 5 minutes

const approvals = new Map();

function createApproval(relativePath, edits, sourceHash, verification = null) {
  const approvalId = crypto.randomUUID();
  const now = Date.now();
  approvals.set(approvalId, {
    approvalId,
    path: relativePath,
    edits,
    sourceHash,
    verification,
    createdAt: now,
    expiresAt: now + APPROVAL_TTL_MS,
    used: false
  });
  return approvalId;
}

function getApproval(approvalId) {
  return approvals.get(approvalId) || null;
}

// Validates and marks an approval as used. Throws a safe, non-leaky error
// for every rejection case (unknown/used/expired/mismatched path).
function consumeApproval(approvalId, relativePath) {
  if (typeof approvalId !== "string" || !approvalId) {
    throw new Error("A valid approvalId is required");
  }
  const approval = approvals.get(approvalId);
  if (!approval) {
    throw new Error("Unknown or invalid approval");
  }
  if (approval.used) {
    throw new Error("Approval has already been used");
  }
  if (Date.now() > approval.expiresAt) {
    approvals.delete(approvalId);
    throw new Error("Approval has expired");
  }
  if (typeof relativePath !== "string" || relativePath !== approval.path) {
    throw new Error("Approval does not match the requested path");
  }
  approval.used = true;
  return approval;
}

function resetForTests() {
  approvals.clear();
}

module.exports = { createApproval, getApproval, consumeApproval, resetForTests, APPROVAL_TTL_MS };
