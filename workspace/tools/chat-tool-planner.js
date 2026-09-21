// Deterministic chat tool planner.
//
// Maps a user's /chat message to a small, safe set of tools already
// registered in the Action Gateway. This is intentionally NOT an LLM call:
// selection is regex-based so it stays fast, predictable, and auditable.
// The Action Gateway (and agent.js underneath it) remains the sole
// authority on whether a path is actually safe to read.

function planGitTools(message) {
  const text = String(message || "").toLowerCase();

  if (/\bbranch(es)?\b/.test(text)) {
    return ["git.branch"];
  }

  if (
    /\b(commit|commits|commit history|recent commits|commit log|git log|history)\b/.test(text)
  ) {
    return ["git.log"];
  }

  if (
    /\b(changed|changes|change|diff|differences?|modified|unstaged|working tree|dirty|status)\b/.test(text)
  ) {
    return ["git.status", "git.diff"];
  }

  return [];
}

function planVscodeTools(message) {
  const text = String(message || "").toLowerCase();
  const asksForActiveFile =
    /\bactive file\b/.test(text) ||
    /\b(open|working on|currently editing|in vscode)\b.*\bfile\b/.test(text) ||
    /\bfile\b.*\b(open|working on|currently editing|in vscode)\b/.test(text);
  return asksForActiveFile ? ["vscode.file.active"] : [];
}

// Requires an explicit "do something with a file" verb so plain mentions
// of a path in casual conversation don't trigger a read.
const FILE_ANALYSIS_VERBS =
  /\b(read|analy[sz]e[sd]?|analysing|analyzing|explain(?:s|ing)?|review(?:s|ing)?|summari[sz]e[sd]?|describe[sd]?|inspect(?:s|ing)?|look(?:ing)? at)\b/i;

// An explicit relative project path: at least one "/" and a dotted
// extension, e.g. "web/app/page.tsx" or "web/components/drop-hub.tsx".
const EXPLICIT_FILE_PATH_PATTERN =
  /\b([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]+)\b/;

const ACTIVE_FILE_WORDING =
  /\bactive file\b|\bcurrent file\b|\bcurrently open file\b|\bopen file\b|\bcurrently editing\b/i;

function extractExplicitFilePath(message) {
  const match = String(message || "").match(EXPLICIT_FILE_PATH_PATTERN);
  return match ? match[1] : null;
}

// Returns null when no file analysis is requested, otherwise:
//   { mode: "explicit", path: "web/app/page.tsx" }
//   { mode: "active" }                      -- resolve via vscode.file.active first
function planFileAnalysis(message) {
  const text = String(message || "");
  if (!FILE_ANALYSIS_VERBS.test(text)) return null;

  const explicitPath = extractExplicitFilePath(text);
  if (explicitPath) {
    return { mode: "explicit", path: explicitPath };
  }

  if (ACTIVE_FILE_WORDING.test(text)) {
    return { mode: "active" };
  }

  return null;
}

// Requires an explicit edit-style verb plus an explicit path so a
// proposal is only ever triggered for a clearly named file.
const EDIT_PROPOSAL_VERBS = /\b(fix|clean up|remove unused imports?|refactor)\b/i;

function planEditProposal(message) {
  const text = String(message || "");
  if (!EDIT_PROPOSAL_VERBS.test(text)) return null;
  const targetPath = extractExplicitFilePath(text);
  if (!targetPath) return null;
  return { path: targetPath };
}

// Matches an explicit approval request such as "approve edit <uuid>" or
// "apply <uuid>". The approval id itself is still fully re-validated
// (single-use, unexpired, path-matching) by the Action Gateway.
const APPROVAL_INTENT_VERBS = /\b(approve|apply)\b/i;
const APPROVAL_ID_PATTERN = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

function planEditApproval(message) {
  const text = String(message || "");
  if (!APPROVAL_INTENT_VERBS.test(text)) return null;
  const match = text.match(APPROVAL_ID_PATTERN);
  if (!match) return null;
  return { approvalId: match[1] };
}

module.exports = {
  planGitTools,
  planVscodeTools,
  planFileAnalysis,
  extractExplicitFilePath,
  planEditProposal,
  planEditApproval
};
