function filterDiagnostics(result, path) {
  if (!result || !result.success || !result.data || !Array.isArray(result.data.diagnostics)) return [];
  return result.data.diagnostics.filter((item) => item.file === path).map((item) => ({
    severity: item.severity,
    message: item.message,
    file: item.file,
    line: item.line,
    source: item.source
  }));
}

function renderPostEditVerification(evidence, diagnosticsResult, diagnostics, terminalResult) {
  const appliedChanges = evidence.edits.length
    ? evidence.edits.map((edit) => `- Replaced \"${edit.oldText}\" with \"${edit.newText}\"`).join("\n")
    : "- No applied edits were recorded.";
  const diagnosticText = diagnosticsResult.success
    ? diagnostics.length
      ? diagnostics.map((item) =>
          `- [${item.severity}] ${item.file}:${item.line || "unknown"} — ${item.message}` +
          (item.source ? ` (source: ${item.source})` : "")
        ).join("\n")
      : "0 diagnostics reported for this file."
    : "Diagnostics execution failed: " + diagnosticsResult.error;
  const terminal = terminalResult && terminalResult.success ? terminalResult.data : null;
  const buildText = terminal
    ? [
        `Command: ${terminal.command}`,
        `Exit code: ${terminal.exitCode === null ? "none" : terminal.exitCode}`,
        `Timed out: ${terminal.timedOut ? "yes" : "no"}`,
        `Result: ${terminal.exitCode === 0 && !terminal.timedOut ? "PASS" : "FAIL"}`
      ].join("\n")
    : "No trustworthy completed build evidence is stored.";
  const verified = !!(
    evidence.application &&
    evidence.application.verified === true &&
    diagnosticsResult.success &&
    terminal &&
    terminal.exitCode === 0 &&
    !terminal.timedOut
  );

  return [
    "## Applied changes",
    appliedChanges,
    "",
    "## Diagnostics",
    diagnosticText,
    "",
    "## Build",
    buildText,
    "",
    "## Verification",
    verified ? "VERIFIED" : "NOT VERIFIED"
  ].join("\n");
}

module.exports = { filterDiagnostics, renderPostEditVerification };