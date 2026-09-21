// TOM PATCH v1 parser/validator.
//
// Parses and validates a multi-file patch document. Never writes to disk.
// Reuses agent.js for all path/security/read logic and
// tools/patch-validator.js for per-file edit validation - no duplicate
// security or diffing logic lives here.

const agent = require("../agent");
const patchValidator = require("./patch-validator");

const REQUIRED_VERSION = "tom-patch-v1";
const REQUIRED_PROJECT = "Drop";
const MAX_EDITS = 20;
const ALLOWED_EDIT_KEYS = ["path", "oldText", "newText"];

// Strict JSON parse + structural checks. Throws on any malformed/invalid input.
function parsePatch(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    throw new Error("Malformed patch JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Patch must be a JSON object");
  }
  if (parsed.version !== REQUIRED_VERSION) {
    throw new Error(`Patch version must be exactly "${REQUIRED_VERSION}"`);
  }
  if (parsed.project !== REQUIRED_PROJECT) {
    throw new Error(`Patch project must be exactly "${REQUIRED_PROJECT}"`);
  }
  if (!Array.isArray(parsed.edits) || parsed.edits.length === 0) {
    throw new Error("Patch edits must be a non-empty array");
  }
  if (parsed.edits.length > MAX_EDITS) {
    throw new Error(`Too many edits: max ${MAX_EDITS} allowed per patch`);
  }

  for (const edit of parsed.edits) {
    if (!edit || typeof edit !== "object" || Array.isArray(edit)) {
      throw new Error("Each edit must be an object");
    }
    const unexpectedKeys = Object.keys(edit).filter((key) => !ALLOWED_EDIT_KEYS.includes(key));
    if (unexpectedKeys.length > 0) {
      throw new Error(`Each edit may only contain ${ALLOWED_EDIT_KEYS.join(", ")}`);
    }
    if (typeof edit.path !== "string" || !edit.path.trim()) {
      throw new Error("Each edit's path must be a non-empty string");
    }
    if (typeof edit.oldText !== "string" || typeof edit.newText !== "string") {
      throw new Error("Each edit's oldText and newText must be strings");
    }
  }

  return parsed;
}

// Validates a parsed TOM PATCH v1 document against the live, authorized
// project filesystem and returns a normalized, validated patch object.
// Never writes; only reads through agent.readProjectFile.
function validatePatch(rawText) {
  const parsed = parsePatch(rawText);

  // Group by path so per-file uniqueness/overlap checks are scoped correctly.
  const editsByPath = new Map();
  for (const edit of parsed.edits) {
    if (!editsByPath.has(edit.path)) editsByPath.set(edit.path, []);
    editsByPath.get(edit.path).push({ oldText: edit.oldText, newText: edit.newText });
  }

  const files = [];
  for (const [relativePath, edits] of editsByPath) {
    // agent.readProjectFile enforces validateProjectPath: blocked
    // names/extensions, traversal, symlink escape, existence, 1MB limit.
    const currentContent = agent.readProjectFile(relativePath);
    const { summary } = patchValidator.validateEdits(currentContent, edits);
    files.push({ path: relativePath, edits: summary });
  }

  return {
    version: REQUIRED_VERSION,
    project: REQUIRED_PROJECT,
    files
  };
}

module.exports = { parsePatch, validatePatch };
