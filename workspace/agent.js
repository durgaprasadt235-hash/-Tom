const fs = require("fs");
const path = require("path");

const DROP_ROOT = "/Users/tdurg/Projects/Drop";

// --------------------------------------------------
// SECURITY CONFIGURATION
// --------------------------------------------------

const BLOCKED_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".git",
  "web-git-backup",
  ".vercel",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage"
]);

const BLOCKED_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx"
]);

// --------------------------------------------------
// SAFE PATH VALIDATION (for read operations)
// --------------------------------------------------

function validateProjectPath(relativePath) {
  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("A valid project path is required");
  }

  const resolvedRoot = path.resolve(DROP_ROOT);
  const resolvedPath = path.resolve(DROP_ROOT, relativePath);

  // Never allow Tom to escape the DROP project.
  if (
    resolvedPath !== resolvedRoot &&
    !resolvedPath.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error("Access outside DROP project is blocked");
  }

  const relativeResolved = path.relative(
    resolvedRoot,
    resolvedPath
  );

  const pathParts = relativeResolved
    .split(path.sep)
    .filter(Boolean);

  // Block sensitive directories/files anywhere in the path.
  for (const part of pathParts) {
    if (BLOCKED_NAMES.has(part)) {
      throw new Error(
        `Access to sensitive path "${part}" is blocked`
      );
    }

    if (part.startsWith(".env.")) {
      throw new Error(
        "Access to environment files is blocked"
      );
    }
  }

  const extension = path.extname(resolvedPath).toLowerCase();

  if (BLOCKED_EXTENSIONS.has(extension)) {
    throw new Error(
      `Access to sensitive ${extension} files is blocked`
    );
  }

  return resolvedPath;
}

// --------------------------------------------------
// RECURSIVE PROJECT TREE INSPECTOR
// --------------------------------------------------

const MAX_DEPTH = 10;
const MAX_ENTRIES = 500;

function isAllowedForTraversal(entryName) {
  // Block by exact name
  if (BLOCKED_NAMES.has(entryName)) {
    return false;
  }

  // Block .env.* files (e.g., .env.local, .env.development)
  if (entryName.startsWith(".env.")) {
    return false;
  }

  // Block secret file extensions
  const ext = path.extname(entryName).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return false;
  }

  return true;
}

function getProjectTree(dir, currentDepth) {
  if (currentDepth === undefined) {
    currentDepth = 0;
  }

  const result = { tree: [], truncated: false };

  // Depth limit exceeded
  if (currentDepth > MAX_DEPTH) {
    result.truncated = true;
    return result;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // Permission denied or directory doesn't exist
    return result;
  }

  // Sort for deterministic output
  const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of sorted) {
    // SECURITY: Skip symbolic links entirely
    // fs.statSync would follow the link, so we use Dirent method
    // to detect symlinks without following them
    try {
      if (entry.isSymbolicLink()) {
        continue;
      }
    } catch (e) {
      // If isSymbolicLink throws, skip the entry
      continue;
    }

    // Apply path filters
    if (!isAllowedForTraversal(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(DROP_ROOT, fullPath);

    // Entry count limit
    if (result.tree.length >= MAX_ENTRIES) {
      result.truncated = true;
      return result;
    }

    if (entry.isDirectory()) {
      const subResult = getProjectTree(fullPath, currentDepth + 1);
      result.tree.push({ path: relPath, type: "dir" });
      result.tree.push(...subResult.tree.map(e => ({
        ...e,
        path: e.path // paths are already relative
      })));
      if (subResult.truncated) {
        result.truncated = true;
        // Continue collecting but mark truncated
      }
    } else if (entry.isFile()) {
      result.tree.push({ path: relPath, type: "file" });
    }
  }

  return result;
}

function searchProjectFiles(query) {
  const terms = String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .filter((term) => term.length >= 2)
    .slice(0, 6);
  if (!terms.length) return { query: String(query || ""), matches: [] };

  const matches = [];
  for (const entry of getProjectTree(DROP_ROOT).tree) {
    if (entry.type !== "file") continue;
    const pathText = entry.path.toLowerCase();
    let score = terms.reduce((total, term) => total + (pathText.includes(term) ? 3 : 0), 0);
    if (!score) {
      try {
        const content = readProjectFile(entry.path).toLowerCase();
        score = terms.reduce((total, term) => total + (content.includes(term) ? 1 : 0), 0);
      } catch {
        score = 0;
      }
    }
    if (score) matches.push({ path: entry.path, score });
  }

  matches.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  return { query: String(query || ""), matches: matches.slice(0, 20) };
}

// --------------------------------------------------
// LIST DROP PROJECT FILES (top level only)
// --------------------------------------------------

function listProjectFiles() {
  return fs
    .readdirSync(DROP_ROOT, {
      withFileTypes: true
    })
    .filter(item => {
      if (BLOCKED_NAMES.has(item.name)) {
        return false;
      }

      if (item.name.startsWith(".env.")) {
        return false;
      }

      const extension =
        path.extname(item.name).toLowerCase();

      if (BLOCKED_EXTENSIONS.has(extension)) {
        return false;
      }

      return true;
    })
    .map(item => ({
      name: item.name,
      type: item.isDirectory()
        ? "folder"
        : "file"
    }));
}

// --------------------------------------------------
// READ DROP PROJECT FILE
// --------------------------------------------------

function readProjectFile(relativePath) {
  const resolvedFile =
    validateProjectPath(relativePath);

  if (!fs.existsSync(resolvedFile)) {
    throw new Error(
      "Requested file does not exist"
    );
  }

  // SECURITY: resolve symlinks and re-check containment so a symlink
  // inside the project cannot be used to read files outside DROP_ROOT.
  const realPath = fs.realpathSync(resolvedFile);
  const resolvedRoot = path.resolve(DROP_ROOT);
  if (
    realPath !== resolvedRoot &&
    !realPath.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error("Access outside DROP project is blocked");
  }

  const stats = fs.statSync(resolvedFile);

  if (!stats.isFile()) {
    throw new Error(
      "Requested path is not a file"
    );
  }

  // Prevent Tom from accidentally loading huge files.
  const MAX_FILE_SIZE = 1024 * 1024;

  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(
      "File is larger than Tom's 1 MB read limit"
    );
  }

  return fs.readFileSync(
    resolvedFile,
    "utf8"
  );
}

// --------------------------------------------------
// PROJECT FILE METADATA (read-only, no content)
// --------------------------------------------------
// Used for safe oversized-file detection so large
// files are never sent to the AI in full. This only
// reads filesystem metadata; it does not broaden any
// filesystem permissions or bypass path validation.

const MAX_ANALYZABLE_FILE_SIZE = 1024 * 1024; // 1 MB

function getProjectFileInfo(relativePath) {
  const resolvedFile =
    validateProjectPath(relativePath);

  if (!fs.existsSync(resolvedFile)) {
    throw new Error(
      "Requested file does not exist"
    );
  }

  const stats = fs.statSync(resolvedFile);

  if (!stats.isFile()) {
    throw new Error(
      "Requested path is not a file"
    );
  }

  return {
    path: relativePath,
    size: stats.size,
    maxSize: MAX_ANALYZABLE_FILE_SIZE,
    isLarge: stats.size > MAX_ANALYZABLE_FILE_SIZE
  };
}

// --------------------------------------------------
// CONTROLLED TERMINAL EXECUTION
// --------------------------------------------------

const crypto = require("crypto");

// Execution limits
const MAX_EXECUTION_TIME = 5000; // 5 seconds
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB

// Audit event storage (in-memory, bounded)
const MAX_AUDIT_EVENTS = 1000;
let auditEvents = [];
let auditCounter = 0;

// Metrics storage
const metrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  activeRequests: 0,
  totalLatency: 0,
  commandExecutions: 0,
  commandFailures: 0,
  fileReads: 0,
  fileWrites: 0,
  omniRouteRequests: 0,
  omniRouteFailures: 0,
  startTime: Date.now()
};

/**
 * Generate a simple request ID
 */
function generateRequestId() {
  return crypto.randomBytes(8).toString("hex");
}

/**
 * Record an audit event
 */
function recordAuditEvent(operation, target, success, duration, error = null) {
  const event = {
    id: auditCounter++,
    timestamp: new Date().toISOString(),
    requestId: generateRequestId(), // Simplified for now
    operation,
    target: String(target).substring(0, 200), // Limit length
    success,
    duration: Math.round(duration),
    error: error ? String(error).substring(0, 200) : null
  };

  auditEvents.push(event);
  if (auditEvents.length > MAX_AUDIT_EVENTS) {
    auditEvents.shift(); // Remove oldest
  }
}

/**
 * Update metrics
 */
function updateMetrics(success, latencyIncrement = 0) {
  metrics.totalRequests++;
  if (success) {
    metrics.successfulRequests++;
  } else {
    metrics.failedRequests++;
  }
  metrics.totalLatency += latencyIncrement;
}

// Legacy entry point deliberately fails closed; no alternate spawn path.
function executeControlledCommand() {
  throw new Error("Direct execution disabled; use Action Gateway terminal.run and execution.approve");
}

/**
 * Controlled file write function
 */
function writeProjectFile(relativePath, content) {
  const startTime = Date.now();
  const requestId = generateRequestId();

  try {
    // Validate path using existing read security (reuse validateProjectPath)
    const resolvedFile = validateProjectPath(relativePath);

    // Use lstat (does not follow symlinks) so a symlink target itself is
    // detected rather than silently followed.
    let lstat = null;
    try {
      lstat = fs.lstatSync(resolvedFile);
    } catch (e) {
      lstat = null;
    }

    // Prevent writing to directories
    if (lstat && lstat.isDirectory()) {
      throw new Error("Cannot write to a directory");
    }

    // Prevent writing to (or through) a symbolic link.
    if (lstat && lstat.isSymbolicLink()) {
      throw new Error("Cannot write to a symbolic link");
    }

    // SECURITY: if the parent directory is (or contains) a symlink that
    // resolves outside DROP_ROOT, refuse the write even though the target
    // file itself may not exist yet.
    const parentDir = path.dirname(resolvedFile);
    if (fs.existsSync(parentDir)) {
      const realParent = fs.realpathSync(parentDir);
      const resolvedRoot = path.resolve(DROP_ROOT);
      if (realParent !== resolvedRoot && !realParent.startsWith(resolvedRoot + path.sep)) {
        throw new Error("Access outside DROP project is blocked");
      }
    }

    // Check content size
    if (Buffer.byteLength(content, "utf8") > MAX_OUTPUT_SIZE) {
      throw new Error(`Content exceeds maximum write size of ${MAX_OUTPUT_SIZE} bytes`);
    }

    // Atomic write using temp file
    const tempFile = resolvedFile + ".tmp." + Date.now() + "." + Math.random().toString(36).substr(2, 9);
    
    fs.writeFileSync(tempFile, content, "utf8");
    // Ensure it's written
    fs.syncSync ? fs.syncSync() : null; // Node.js may not have syncSync, but try
    fs.renameSync(tempFile, resolvedFile);
    
    const duration = Date.now() - startTime;
    const bytesWritten = Buffer.byteLength(content, "utf8");
    
    // Update metrics
    metrics.fileWrites++;
    
    // Record audit event
    recordAuditEvent(
      "write",
      relativePath,
      true,
      duration
    );

    return {
      path: relativePath,
      bytesWritten,
      duration,
      success: true
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    
    // Update metrics
    metrics.fileWrites++;
    
    // Record audit event
    recordAuditEvent(
      "write",
      relativePath,
      false,
      duration,
      err.message
    );

    throw err;
  }
}

/**
 * Get audit events
 */
function getAuditEvents(limit = 100) {
  return auditEvents.slice(-limit).concat(); // Return copy
}

/**
 * Get metrics
 */
function getMetrics() {
  const avgLatency = metrics.totalRequests > 0 
    ? Math.round(metrics.totalLatency / metrics.totalRequests) 
    : 0;
    
  return {
    ...metrics,
    averageLatency: avgLatency,
    uptime: Date.now() - metrics.startTime,
    activeRequests: metrics.activeRequests // This would need middleware to track properly
  };
}

/**
 * Increment active requests counter
 */
function incrementActiveRequests() {
  metrics.activeRequests++;
}

/**
 * Decrement active requests counter
 */
function decrementActiveRequests() {
  metrics.activeRequests = Math.max(0, metrics.activeRequests - 1);
}

// --------------------------------------------------
// EXPORT TOM PROJECT TOOLS
// --------------------------------------------------

module.exports = {
  DROP_ROOT,
  listProjectFiles,
  readProjectFile,
  getProjectFileInfo,
  getProjectTree,
  searchProjectFiles,
  executeControlledCommand,
  writeProjectFile,
  getAuditEvents,
  getMetrics,
  incrementActiveRequests,
  decrementActiveRequests
};