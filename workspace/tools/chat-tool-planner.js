// Deterministic chat tool planner.
//
// Maps a user's /chat message to a small, safe set of tools already
// registered in the Action Gateway. This is intentionally NOT an LLM call:
// selection is regex-based so it stays fast, predictable, and auditable.
// The Action Gateway (and agent.js underneath it) remains the sole
// authority on whether a path is actually safe to read.

function planGitTools(message) {
  const text = String(message || "").toLowerCase();

  const tools = [];
  const hasRepositoryContext = /\b(git|repository|repo)\b/.test(text);
  if (/\bbranch(?:es)?\b/.test(text)) tools.push("git.branch");
  if (/\bcommits?\b|\bcommit (?:history|log)\b|\bgit log\b/.test(text)) tools.push("git.log");
  if (/\bdiff(?:erences?)?\b/.test(text)) tools.push("git.diff");
  if (/\b(staged|unstaged)\b|\bworking tree\b/.test(text)) tools.push("git.status", "git.diff");
  if (hasRepositoryContext && /\b(status|changes?|changed|modified|dirty)\b/.test(text)) {
    tools.push("git.status", "git.diff");
  }
  return [...new Set(tools)];
}

function planVscodeTools(message) {
  const text = String(message || "").toLowerCase();
  const asksForActiveFile =
    /\b(active|current|open)(?: vs code| vscode)? file\b/.test(text) ||
    /\bfile\b.*\bcurrently open\b/.test(text) ||
    /\b(open|working on|currently editing|in vscode)\b.*\bfile\b/.test(text) ||
    /\bfile\b.*\b(open|working on|currently editing|in vscode)\b/.test(text);
  const asksForDiagnostics = /\b(errors?|warnings?|diagnostics?|problems?)\b/.test(text);
  return [
    ...(asksForActiveFile ? ["vscode.file.active"] : []),
    ...(asksForDiagnostics ? ["vscode.diagnostics"] : [])
  ];
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

function planCodeInspection(message) {
  const text = String(message || "");
  const filePlan = planFileAnalysis(text);
  if (!filePlan || filePlan.mode !== "explicit") return null;
  if (!/\b(errors?|warnings?|diagnostics?|problems?)\b/i.test(text)) return null;
  return {
    intent: "inspect_file_with_diagnostics",
    path: filePlan.path,
    steps: [
      { tool: "vscode.file.read", args: { path: filePlan.path }, riskLevel: "read" },
      { tool: "vscode.diagnostics", args: {}, riskLevel: "read" }
    ]
  };
}

const PROJECT_DISCOVERY_VERBS = /\b(inspect|search|find|locate)\b/i;
const PROJECT_DISCOVERY_CONTEXT = /\b(project|repository|repo|codebase)\b/i;
const PROJECT_IMPLEMENTATION_PATTERNS = [
  /\b(?:which|what)\s+(?:files?|components?)\b[^?]*\b(?:control|controls|implement|implements|handle|handles|define|defines)\b/i,
  /\bwhere\b[^?]*\b(?:implemented|defined|handled|located)\b/i,
  /\bwhat\b[^?]*\bcomponent\b[^?]*\b(?:handles|controls|implements)\b/i,
  /\bhow does\b[^?]*\b(?:flow|work|works|happen|happens)\b/i,
  /\btrace\b[^?]*\b(?:flow|work|happen|happens|button|action|pressed)\b/i,
  /\b(?:trace|identify)\b[^?]*\b(?:files?|components?|callbacks?|view.?state|navigation|transition(?:s)?|screen(?:s)?)\b/i
];
const PROJECT_SEARCH_STOP_WORDS = new Set([
  "which", "what", "where", "how", "does", "do", "is", "are", "the", "a", "an", "in", "on", "for", "to", "of",
  "file", "files", "component", "components", "project", "repository", "repo", "codebase", "implemented", "defined", "handled",
  "handles", "control", "controls", "flow", "work", "works", "happen", "happens", "when", "pressed", "button", "trace", "tell", "me"
]);

function projectDiscoveryCandidates(message) {
  const text = String(message || "").toLowerCase();
  if (/\b(home|home page|homepage|main page)\b/.test(text)) {
    return [
      "web/app/page.tsx",
      "web/app/page.jsx",
      "web/app/page.js",
      "web/pages/index.tsx",
      "web/src/pages/Home.tsx",
      "web/src/pages/Home.jsx",
      "src/pages/Home.tsx",
      "src/pages/Home.jsx",
      "src/App.tsx",
      "src/App.jsx"
    ];
  }
  return [];
}

function deriveProjectSearchTerms(message) {
  return [...new Set(String(message || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !PROJECT_SEARCH_STOP_WORDS.has(term)))]
    .slice(0, 6)
    .join(" ");
}

function planProjectDiscovery(message) {
  const text = String(message || "");
  if (!(PROJECT_DISCOVERY_VERBS.test(text) && PROJECT_DISCOVERY_CONTEXT.test(text)) && !PROJECT_IMPLEMENTATION_PATTERNS.some((pattern) => pattern.test(text))) return null;
  const candidates = projectDiscoveryCandidates(text);
  const searchTerms = deriveProjectSearchTerms(text);
  const steps = [{ tool: "vscode.workspace.tree", args: {}, riskLevel: "read" }];
  if (candidates.length) {
    steps.push({
      tool: "vscode.file.read",
      args: {},
      candidatePathsFrom: "vscode.workspace.tree",
      candidatePaths: candidates,
      riskLevel: "read"
    });
  } else {
    steps.push({ tool: "vscode.workspace.search", args: { query: searchTerms }, riskLevel: "read" });
    steps.push({
      tool: "vscode.file.read",
      args: {},
      candidatePathsFrom: "vscode.workspace.search",
      candidatePathsAllowedBy: "vscode.workspace.tree",
      maxCandidates: 12,
      riskLevel: "read"
    });
  }
  return {
    intent: "inspect_project",
    candidates,
    searchTerms,
    steps
  };
}

function planVerification(message) {
  const intent = require("./runtime-intent").classify(message);
  if (intent?.tool !== "terminal.run") return null;
  try {
    require("./command-policy").command(require("../agent").DROP_ROOT, intent.args.cwd, intent.args.command);
    return intent.args;
  } catch { return null; }
}

function planPostEditVerification(message) {
  const text = String(message || "");
  const path = extractExplicitFilePath(text);
  if (!path || !/\bverify\b/i.test(text) || !/\b(?:cleanup|edit|change)\b/i.test(text)) return null;
  const wantsFreshBuild = /\b(?:run|rerun|re-run)\s+(?:the\s+)?(?:drop\s+)?build\b/i.test(text);
  const wantsCompletedBuild = /\b(?:completed|previous|existing|stored)\b[^.]*\b(?:build|verification)\b|\bbuild result\b/i.test(text);
  return {
    path,
    buildMode: wantsFreshBuild ? "fresh" : wantsCompletedBuild ? "stored" : "stored"
  };
}

// Requires an explicit edit-style verb plus an explicit path so a
// proposal is only ever triggered for a clearly named file.
const EDIT_PROPOSAL_VERBS = /\b(fix|clean up|remove unused imports?|refactor)\b/i;

function planEditProposal(message) {
  const text = String(message || "");
  if (!EDIT_PROPOSAL_VERBS.test(text)) return null;
  const targetPath = extractExplicitFilePath(text);
  if (!targetPath) return null;
  return {
    path: targetPath,
    kind: /\b(?:clean up|remove)\s+(?:the\s+)?unused\s+(?:code|imports?)\b/i.test(text)
      ? "unused-code-cleanup"
      : "model-edit"
  };
}

function unquoteReplacementText(value) {
  if (value.startsWith("“") && value.endsWith("”")) return value.slice(1, -1);
  return value.slice(1, -1);
}

function planExplicitReplacement(message) {
  const text = String(message || "");
  const path = extractExplicitFilePath(text);
  if (!path || !/\b(propose|change|changing|replace|replacing)\b/i.test(text)) return null;

  const quotedText = "(`[^`]+`|\"[^\"]+\"|'[^']+'|“[^”]+”)";
  const replacementPattern = new RegExp(
    "\\b(?:propose\\s+)?(?:change|changing|replace|replacing)\\s+" +
    quotedText + "\\s+(?:to|with)\\s+" + quotedText,
    "i"
  );
  const quotedMatch = text.match(replacementPattern);
  if (quotedMatch) {
    return {
      path,
      oldText: unquoteReplacementText(quotedMatch[1]),
      newText: unquoteReplacementText(quotedMatch[2])
    };
  }

  const plainMatch = text.match(
    /\b(?:propose\s+)?(?:change|changing|replace|replacing)\s+(.+?)(?=\.\s+(?:do not|don't|dont)\b|[.!?]\s*$|$)/i
  );
  if (!plainMatch) return null;

  const replacementText = plainMatch[1].trim();
  const delimiters = [...replacementText.matchAll(/\s+(?:to|with)\s+/gi)];
  if (delimiters.length !== 1) return null;

  const delimiter = delimiters[0];
  const oldText = replacementText.slice(0, delimiter.index).trim();
  const newText = replacementText.slice(delimiter.index + delimiter[0].length).trim();
  if (!oldText || !newText) return null;

  return {
    path,
    oldText,
    newText
  };
}

// Matches an explicit approval request such as "approve edit <uuid>" or
// "apply <uuid>". The approval id itself is still fully re-validated
// (single-use, unexpired, path-matching) by the Action Gateway.
const APPROVAL_INTENT_VERBS = /\b(approve(?:d)?|apply)\b/i;
const APPROVAL_ID_PATTERN = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

function planEditApproval(message, pendingApprovalId = null) {
  const text = String(message || "");
  if (/\b(?:do not|don't|dont|not)\s+(?:approve|apply)\b/i.test(text)) return null;
  if (!APPROVAL_INTENT_VERBS.test(text) && !/\byes[,.]?\s+(?:please\s+)?apply\b/i.test(text)) return null;
  const match = text.match(APPROVAL_ID_PATTERN);
  if (match) return { approvalId: match[1] };
  if (pendingApprovalId && /\bapproved?\b|\bapply\s+(?:it|this|the\s+(?:proposed\s+)?change)\b|\byes[,.]?\s+(?:please\s+)?apply\b/i.test(text)) {
    return { approvalId: pendingApprovalId };
  }
  return null;
}

function createExecutionPlan(message) {
  const filePlan = planFileAnalysis(message);
  const projectPlan = !filePlan ? planProjectDiscovery(message) : null;
  if (projectPlan) return projectPlan;
  const vscodeTools = filePlan && filePlan.mode === "explicit" ? [] : planVscodeTools(message);
  const plannedTools = [...new Set([...planGitTools(message), ...vscodeTools])];
  const steps = plannedTools.map((tool) => ({ tool, args: {}, riskLevel: "read" }));
  const verification = planVerification(message);

  if (filePlan && filePlan.mode === "explicit") {
    steps.push({ tool: "vscode.file.read", args: { path: filePlan.path }, riskLevel: "read" });
  } else if (filePlan && filePlan.mode === "active") {
    if (!steps.some((step) => step.tool === "vscode.file.active")) {
      steps.unshift({ tool: "vscode.file.active", args: {}, riskLevel: "read" });
    }
    steps.push({
      tool: "vscode.file.read",
      args: { pathFrom: "vscode.file.active" },
      riskLevel: "read",
      dependsOn: "vscode.file.active"
    });
  }
  if (verification) {
    steps.push({ tool: "terminal.run", args: verification, riskLevel: "consequential" });
  }

  const hasGit = steps.some((step) => step.tool.startsWith("git."));
  const hasDiagnostics = steps.some((step) => step.tool === "vscode.diagnostics");
  const hasFileRead = steps.some((step) => step.tool === "vscode.file.read");
  const hasActiveFile = steps.some((step) => step.tool === "vscode.file.active");
  const intent = hasGit && (hasDiagnostics || hasFileRead || hasActiveFile)
    ? "inspect_project"
    : hasGit
      ? "inspect_git"
      : hasFileRead
        ? "inspect_source"
        : hasDiagnostics
          ? "inspect_vscode_diagnostics"
          : hasActiveFile
            ? "inspect_active_file"
            : "chat";

  return { intent, steps };
}

module.exports = {
  createExecutionPlan,
  planGitTools,
  planVscodeTools,
  planFileAnalysis,
  planProjectDiscovery,
  deriveProjectSearchTerms,
  planCodeInspection,
  planVerification,
  planPostEditVerification,
  extractExplicitFilePath,
  planExplicitReplacement,
  planEditProposal,
  planEditApproval
};
