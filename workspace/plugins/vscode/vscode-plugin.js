const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const MAC_APP = "/Applications/Visual Studio Code.app";
const MAC_CLI = path.join(MAC_APP, "Contents", "Resources", "app", "bin", "code");

function execFixed(file, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, maxBuffer: 256 * 1024 }, (error, stdout) => {
      resolve(error ? "" : String(stdout || "").trim());
    });
  });
}

async function detectVSCode() {
  const applicationPath = fs.existsSync(MAC_APP) ? MAC_APP : null;
  const bundledCli = fs.existsSync(MAC_CLI) ? MAC_CLI : null;
  const pathCli = await execFixed("/usr/bin/which", ["code"]);
  const cliPath = pathCli || bundledCli;
  const versionOutput = cliPath ? await execFixed(cliPath, ["--version"]) : "";
  const processOutput = await execFixed("/usr/bin/pgrep", ["-f", MAC_APP]);

  return {
    installedLocally: Boolean(applicationPath || pathCli),
    cliAvailable: Boolean(pathCli),
    bundledCliAvailable: Boolean(bundledCli),
    running: Boolean(processOutput),
    version: versionOutput.split("\n")[0] || null,
    status: applicationPath || pathCli ? "detected" : "not_detected"
  };
}

module.exports = { detectVSCode };
