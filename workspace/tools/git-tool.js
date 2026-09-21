// Git Tool - Safe, read-only Git operations for the authorized Drop repository.
// Uses execFile with fixed, validated argument arrays; no shell, no client paths.
//
// Repository is FIXED to DROP_ROOT exported by agent.js (single source of truth).
// The client cannot provide filesystem or repository paths.

const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const { DROP_ROOT } = require("../agent");

// Validate that DROP_ROOT exists and is a git repository.
function validateDropRepository() {
  if (!fs.existsSync(DROP_ROOT)) {
    throw new Error("Drop repository not found");
  }

  if (!fs.existsSync(path.join(DROP_ROOT, ".git"))) {
    throw new Error("Not a git repository");
  }

  return true;
}

// Execute git with a fixed argument array. No shell is used,
// so arguments cannot be interpreted as shell commands.
function executeGitCommand(args) {
  validateDropRepository();

  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: DROP_ROOT,
        maxBuffer: 1024 * 1024, // 1MB max output
        timeout: 5000 // 5 second timeout
      },
      (error, stdout, stderr) => {
        if (error) {
          // Do not expose internal paths or env details.
          reject(new Error("Git command failed"));
          return;
        }

        if (stderr && stderr.trim()) {
          reject(new Error("Git command error"));
          return;
        }

        resolve(stdout.trim());
      }
    );
  });
}

// Git tool implementations - all read-only operations.
// Each takes no arguments; the repository is always DROP_ROOT.
const gitTool = {
  /**
   * Get repository status (porcelain, unstaged + staged summary).
   * @returns {Promise<string>} Git status output
   */
  status: async () => {
    return executeGitCommand(["status", "--porcelain"]);
  },

  /**
   * List local branches.
   * @returns {Promise<string>} Git branch output
   */
  branch: async () => {
    return executeGitCommand(["branch", "--list"]);
  },

  /**
   * Get recent commit history.
   * @returns {Promise<string>} Git log output (limited to recent commits)
   */
  log: async () => {
    return executeGitCommand(["log", "--oneline", "-10"]);
  },

  /**
   * Show unstaged differences.
   * @returns {Promise<string>} Git diff output
   */
  diff: async () => {
    return executeGitCommand(["diff", "--no-color"]);
  }
};

module.exports = gitTool;