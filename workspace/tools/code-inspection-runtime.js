const MAX_CITATION_RANGE_LINES = 80;

function sourceLines(content) {
  return String(content).split(/\r?\n/);
}

function numberSourceLines(content) {
  return sourceLines(content)
    .map((line, index) => `${index + 1} | ${line}`)
    .join("\n");
}

function buildInspectionEvidence(path, content, diagnostics) {
  const lines = sourceLines(content);
  const filteredDiagnostics = Array.isArray(diagnostics)
    ? diagnostics.filter((item) => item && item.file === path).map((item) => ({
        severity: item.severity,
        message: item.message,
        file: item.file,
        line: item.line,
        source: item.source
      }))
    : [];
  return {
    file: { path, content: String(content), lineCount: lines.length },
    diagnostics: filteredDiagnostics,
    codeFacts: []
  };
}

function parseInspectionAnalysis(rawText, content) {
  let parsed;
  try {
    parsed = JSON.parse(String(rawText || "").trim());
  } catch {
    return { codeFacts: [], architecturalSuggestions: [] };
  }

  const lines = sourceLines(content);
  const validCitation = (item) =>
    item &&
    Number.isInteger(item.lineStart) &&
    Number.isInteger(item.lineEnd) &&
    item.lineStart >= 1 &&
    item.lineEnd <= lines.length &&
    item.lineStart <= item.lineEnd &&
    item.lineEnd - item.lineStart + 1 <= MAX_CITATION_RANGE_LINES;

  const sourceFor = (item) => lines.slice(item.lineStart - 1, item.lineEnd).join("\n");

  const codeFacts = Array.isArray(parsed.codeFacts)
    ? parsed.codeFacts
        .filter((item) =>
          validCitation(item) &&
          typeof item.fact === "string" &&
          item.fact.trim() &&
          !/\b(may|might|could|should|recommend|consider|potential(?:ly)?)\b/i.test(item.fact)
        )
        .slice(0, 6)
        .map((item) => ({
          lineStart: item.lineStart,
          lineEnd: item.lineEnd,
          fact: item.fact.trim(),
          source: sourceFor(item)
        }))
    : [];
  const architecturalSuggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions
        .filter((item) =>
          validCitation(item) &&
          typeof item.suggestion === "string" && item.suggestion.trim() &&
          typeof item.reason === "string" && item.reason.trim()
        )
        .slice(0, 6)
        .map((item) => ({
          lineStart: item.lineStart,
          lineEnd: item.lineEnd,
          suggestion: item.suggestion.trim(),
          reason: item.reason.trim(),
          source: sourceFor(item)
        }))
    : [];

  return { codeFacts, architecturalSuggestions };
}

function renderInspectionResponse(evidence, analysis) {
  const rangeLabel = (item) => item.lineStart === item.lineEnd
    ? `Line ${item.lineStart}`
    : `Lines ${item.lineStart}-${item.lineEnd}`;
  const diagnostics = evidence.diagnostics.length
    ? evidence.diagnostics.map((item) =>
        `- [${item.severity}] ${item.file}:${item.line || "unknown"} — ${item.message}` +
        (item.source ? ` (source: ${item.source})` : "")
      ).join("\n")
    : "No diagnostics were reported by VS Code for this file.";
  const codeFacts = analysis.codeFacts.length
    ? analysis.codeFacts.map((item) =>
        `- ${rangeLabel(item)}: ${item.fact}\n  Source: ${item.source}`
      ).join("\n")
    : "No additional code facts were selected.";
  const suggestions = analysis.architecturalSuggestions.length
    ? analysis.architecturalSuggestions.map((item) =>
        `- ${rangeLabel(item)}: ${item.suggestion}\n  Reason: ${item.reason}\n  Source: ${item.source}`
      ).join("\n")
    : "No architectural suggestions were generated.";

  return [
    "## Confirmed compiler/diagnostic issues",
    diagnostics,
    "",
    "## Confirmed code facts",
    codeFacts,
    "",
    "## Architectural suggestions",
    suggestions
  ].join("\n");
}

module.exports = {
  MAX_CITATION_RANGE_LINES,
  numberSourceLines,
  buildInspectionEvidence,
  parseInspectionAnalysis,
  renderInspectionResponse
};