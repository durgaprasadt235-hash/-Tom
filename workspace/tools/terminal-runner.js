const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { DROP_ROOT } = require("../agent");

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const ALLOWED_COMMANDS = new Map([
  ["npm run build", { executable: "npm", args: ["run", "build"] }],
  ["npm test", { executable: "npm", args: ["test"] }],
  ["npm run lint", { executable: "npm", args: ["run", "lint"] }]
]);

function resolveCwd(relativeCwd = ".") {
  if (typeof relativeCwd !== "string" || !relativeCwd.trim() || path.isAbsolute(relativeCwd)) {
    throw new Error("Terminal cwd must be a project-relative directory");
  }
  const root = path.resolve(DROP_ROOT);
  const resolved = path.resolve(root, relativeCwd);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Terminal cwd outside the authorized project is blocked");
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error("Terminal cwd does not exist or is not a directory");
  }
  const realRoot = fs.realpathSync(root);
  const realCwd = fs.realpathSync(resolved);
  if (realCwd !== realRoot && !realCwd.startsWith(realRoot + path.sep)) {
    throw new Error("Terminal cwd symlink outside the authorized project is blocked");
  }
  return realCwd;
}

function validateCommand(command) {
  if (typeof command !== "string" || !ALLOWED_COMMANDS.has(command)) {
    throw new Error("Terminal command is not allowlisted");
  }
  return ALLOWED_COMMANDS.get(command);
}

function truncateOutput(value, maxBytes) {
  const buffer = Buffer.from(String(value || ""));
  if (buffer.length <= maxBytes) return buffer.toString();
  return buffer.subarray(0, maxBytes).toString() + "\n... (truncated)";
}

function run(command, relativeCwd = "web", options = {}) {
  const definition = validateCommand(command);
  const cwd = resolveCwd(relativeCwd);
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = Number.isInteger(options.maxOutputBytes) ? options.maxOutputBytes : DEFAULT_MAX_OUTPUT_BYTES;
  const execFileImpl = options.execFileImpl || execFile;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    execFileImpl(
      definition.executable,
      definition.args,
      { cwd, timeout: timeoutMs, maxBuffer: maxOutputBytes, shell: false },
      (error, stdout = "", stderr = "") => {
        const timedOut = !!(error && (error.killed || error.code === "ETIMEDOUT"));
        const exitCode = error
          ? (Number.isInteger(error.code) ? error.code : timedOut ? null : 1)
          : 0;
        resolve({
          command,
          cwd,
          exitCode,
          stdout: truncateOutput(stdout, maxOutputBytes),
          stderr: truncateOutput(stderr, maxOutputBytes),
          timedOut,
          durationMs: Date.now() - startedAt
        });
      }
    );
  });
}

module.exports = {
  ALLOWED_COMMANDS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  resolveCwd,
  validateCommand,
  truncateOutput,
  run
};