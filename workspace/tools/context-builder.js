// Deterministic Tom Context Builder.
//
// Pure aggregation layer over the existing Action Gateway - no filesystem
// access, no AI/model calls, no write/edit/delete/shell capability. Every
// section comes from an already-registered read-only tool, so all security
// (path validation, blocked names/extensions, traversal/symlink protection)
// is enforced exactly once, by those tools.

const actionGateway = require("./action-gateway");

const MAX_TREE_ENTRIES = 500;
const MAX_FILE_CONTENT_CHARS = 4000;
const MAX_FILES = 10;
const MAX_DIAGNOSTICS = 200;
const MAX_TEXT_CHARS = 4000; // git status/diff

function truncateText(text, max) {
  if (typeof text !== "string") return "";
  return text.length > max ? text.slice(0, max) + "\n... (truncated)" : text;
}

async function collectSection(toolName, args) {
  const result = await actionGateway.executeTool(toolName, args);
  if (!result || !result.success) {
    return { available: false, error: (result && result.error) || "Tool unavailable" };
  }
  return { available: true, data: result.data };
}

async function buildProjectContext(filePaths = []) {
  const requestedPaths = Array.isArray(filePaths) ? filePaths.slice(0, MAX_FILES) : [];

  const [treeSection, diagnosticsSection, gitStatusSection, gitDiffSection] = await Promise.all([
    collectSection("vscode.workspace.tree"),
    collectSection("vscode.diagnostics"),
    collectSection("git.status"),
    collectSection("git.diff")
  ]);

  const tree = treeSection.available
    ? {
        available: true,
        truncated: !!treeSection.data.truncated || treeSection.data.tree.length > MAX_TREE_ENTRIES,
        entries: treeSection.data.tree.slice(0, MAX_TREE_ENTRIES)
      }
    : { available: false, error: treeSection.error };

  const diagnostics = diagnosticsSection.available
    ? {
        available: true,
        truncated: diagnosticsSection.data.diagnostics.length > MAX_DIAGNOSTICS,
        entries: diagnosticsSection.data.diagnostics.slice(0, MAX_DIAGNOSTICS)
      }
    : { available: false, error: diagnosticsSection.error };

  const gitStatus = gitStatusSection.available
    ? { available: true, content: truncateText(String(gitStatusSection.data), MAX_TEXT_CHARS) }
    : { available: false, error: gitStatusSection.error };

  const gitDiff = gitDiffSection.available
    ? { available: true, content: truncateText(String(gitDiffSection.data), MAX_TEXT_CHARS) }
    : { available: false, error: gitDiffSection.error };

  const files = [];
  for (const relativePath of requestedPaths) {
    const fileSection = await collectSection("vscode.file.read", { path: relativePath });
    files.push(
      fileSection.available
        ? {
            path: relativePath,
            available: true,
            content: truncateText(fileSection.data.content, MAX_FILE_CONTENT_CHARS)
          }
        : { path: relativePath, available: false, error: fileSection.error }
    );
  }

  return {
    version: "tom-context-v1",
    project: "Drop",
    generatedAt: new Date().toISOString(),
    tree,
    files,
    diagnostics,
    gitStatus,
    gitDiff
  };
}

module.exports = { buildProjectContext };
