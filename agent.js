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
// CONTROLLED TERMINAL EXECUTION
// --------------------------------------------------

const { spawn } = require("child_process");
const crypto = require("crypto");

// Allowed commands for controlled execution
const ALLOWED_COMMANDS = new Set([
  "pwd",
  "ls",
  "find",
  "git",
  "npm",
  "node"
]);

// Allowed npm subcommands
const ALLOWED_NPM_SUBCOMMANDS = new Set([
  "run",
  "test"
]);

// Allowed node flags (limited to safe ones)
const ALLOWED_NODE_FLAGS = new Set([
  "--check"
]);

// Shell operators to reject
const SHELL_OPERATORS = [
  ";",
  "&",
  "|",
  ">",
  "<",
  "$(",
  "`"
];

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

/**
 * Validate that a command is allowed and safe
 */
function validateCommand(command) {
  if (!command || typeof command !== "string") {
    throw new Error("Command must be a non-empty string");
  }

  // Check for shell operators
  for (const operator of SHELL_OPERATORS) {
    if (command.includes(operator)) {
      throw new Error(`Shell operator "${operator}" is not allowed`);
    }
  }

  // Split command into parts
  const parts = command.trim().split(/\s+/);
  if (parts.length === 0) {
    throw new Error("Empty command");
  }

  const baseCommand = parts[0];

  // Check if base command is allowed
  if (!ALLOWED_COMMANDS.has(baseCommand)) {
    throw new Error(`Command "${baseCommand}" is not allowed`);
  }

  // Additional validation for specific commands
  switch (baseCommand) {
    case "npm":
      if (parts.length < 2) {
        throw new Error("npm command requires a subcommand");
      }
      const npmSubcommand = parts[1];
      if (!ALLOWED_NPM_SUBCOMMANDS.has(npmSubcommand)) {
        throw new Error(`npm subcommand "${npmSubcommand}" is not allowed`);
      }
      // Additional validation for npm run - check if it's a valid script
      if (npmSubcommand === "run" && parts.length < 3) {
        throw new Error("npm run requires a script name");
      }
      break;

    case "node":
      // Only allow specific flags
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        if (part.startsWith("-") && !ALLOWED_NODE_FLAGS.has(part)) {
          throw new Error(`Node flag "${part}" is not allowed`);
        }
        // Disallow any scripts that aren't just syntax checking
        if (!part.startsWith("-") && i === parts.length - 1) {
          // Last argument should be a file to check
          if (!part.endsWith(".js") && !part.endsWith(".ts")) {
            throw new Error("Node can only check .js or .ts files");
          }
        }
      }
      break;

    case "git":
      // Only allow specific git subcommands
      const allowedGitSubcommands = new Set(["status", "diff", "log"]);
      if (parts.length < 2) {
        throw new Error("Git command requires a subcommand");
      }
      const gitSubcommand = parts[1];
      if (!allowedGitSubcommands.has(gitSubcommand)) {
        throw new Error(`Git subcommand "${gitSubcommand}" is not allowed`);
      }
      break;

    default:
      // pwd, ls, find are allowed as-is with no arguments validation for now
      break;
  }

  return {
    command: baseCommand,
    args: parts.slice(1)
  };
}

/**
 * Execute a controlled command
 */
function executeControlledCommand(commandString) {
  const startTime = Date.now();
  const requestId = generateRequestId();

  try {
    const { command, args } = validateCommand(commandString);
    
    // Ensure we're using spawn with proper options
    const child = spawn(command, args, {
      cwd: DROP_ROOT,
      timeout: MAX_EXECUTION_TIME,
      maxBuffer: MAX_OUTPUT_SIZE,
      env: {
        // Minimal environment to avoid leaking secrets
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        // Only pass essential vars
        ...(process.env.NODE_ENV ? { NODE_ENV: process.env.NODE_ENV } : {})
      }
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Handle output with size limits
    child.stdout.on("data", (data) => {
      stdout += data.toString("utf8");
      if (stdout.length > MAX_OUTPUT_SIZE) {
        timedOut = true;
        child.kill();
        stdout = stdout.substring(0, MAX_OUTPUT_SIZE) + "\n[OUTPUT TRUNCATED]";
      }
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString("utf8");
      if (stderr.length > MAX_OUTPUT_SIZE) {
        timedOut = true;
        child.kill();
        stderr = stderr.substring(0, MAX_OUTPUT_SIZE) + "\n[OUTPUT TRUNCATED]";
      }
    });

    return new Promise((resolve, reject) => {
      child.on("close", (code) => {
        const duration = Date.now() - startTime;
        const success = code === 0 && !timedOut;
        
        // Update metrics
        metrics.commandExecutions++;
        if (!success) {
          metrics.commandFailures++;
        }
        
        // Record audit event
        recordAuditEvent(
          "execute",
          commandString,
          success,
          duration,
          !success && code !== null ? `Exit code: ${code}` : timedOut ? "Timeout" : null
        );

        resolve({
          command: commandString,
          exitCode: code,
          stdout,
          stderr,
          duration,
          timedOut,
          success
        });
      });

      child.on("error", (err) => {
        const duration = Date.now() - startTime;
        
        // Update metrics
        metrics.commandExecutions++;
        metrics.commandFailures++;
        
        // Record audit event
        recordAuditEvent(
          "execute",
          commandString,
          false,
          duration,
          err.message
        );

        reject({
          command: commandString,
          error: err.message,
          duration,
          success: false
        });
      });
    });
  } catch (err) {
    const duration = Date.now() - startTime;
    
        // Update metrics
        metrics.commandExecutions++;
        metrics.commandFailures++;
    
    // Record audit event
    recordAuditEvent(
      "execute",
      commandString,
      false,
      duration,
      err.message
    );

    throw err;
  }
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
    
    // Additional checks for writing
    const stats = fs.existsSync(resolvedFile) ? fs.statSync(resolvedFile) : null;
    
    // Prevent writing to directories
    if (stats && stats.isDirectory()) {
      throw new Error("Cannot write to a directory");
    }
    
    // Check content size
    if (Buffer.byteLength(content, "utf8") > MAX_OUTPUT_SIZE) {
      throw new Error(`Content exceeds maximum write size of ${MAX_OUTPUT_SIZE} bytes`);
    }
    
    // Prevent writing symlinks (though validateProjectPath should catch this via traversal)
    if (stats && stats.isSymbolicLink()) {
      throw new Error("Cannot write to a symbolic link");
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
  getProjectTree,
  executeControlledCommand,
  writeProjectFile,
  getAuditEvents,
  getMetrics,
  incrementActiveRequests,
  decrementActiveRequests
};