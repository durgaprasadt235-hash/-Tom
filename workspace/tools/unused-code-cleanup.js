const UNUSED_SYMBOL_PATTERNS = [
  /^'([^']+)' is declared but its value is never read\.?$/i,
  /^'([^']+)' is defined but never used\.?$/i,
  /^'([^']+)' is assigned a value but never used\.?$/i
];

function unusedSymbol(message) {
  const text = String(message || "").trim();
  for (const pattern of UNUSED_SYMBOL_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function sourceLines(content) {
  const records = [];
  const pattern = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let match;
  while ((match = pattern.exec(String(content))) && match[0]) {
    records.push({ text: match[1], full: match[0] });
  }
  return records;
}

function insideNamedImport(lines, index) {
  for (let current = index - 1; current >= 0; current -= 1) {
    if (/^\s*import\s+(?:type\s+)?\{/.test(lines[current].text)) return true;
    if (/;\s*$/.test(lines[current].text)) return false;
  }
  return false;
}

function createUnusedImportEdits(content, diagnostics) {
  const source = String(content);
  const lines = sourceLines(source);
  const edits = [];
  const skipped = [];
  const seen = new Set();

  for (const diagnostic of Array.isArray(diagnostics) ? diagnostics : []) {
    const symbol = unusedSymbol(diagnostic && diagnostic.message);
    const lineNumber = diagnostic && diagnostic.line;
    if (!symbol || !Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lines.length) continue;

    const index = lineNumber - 1;
    const line = lines[index].text;
    const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const standaloneSpecifier = new RegExp(`^\\s*${escapedSymbol}(?:\\s+as\\s+[A-Za-z_$][\\w$]*)?\\s*,?\\s*$`);
    const defaultImport = new RegExp(`^\\s*import\\s+(?:type\\s+)?${escapedSymbol}\\s+from\\s+['\"][^'\"]+['\"]\\s*;?\\s*$`);
    const singleNamedImport = new RegExp(`^\\s*import\\s+(?:type\\s+)?\\{\\s*${escapedSymbol}\\s*\\}\\s+from\\s+['\"][^'\"]+['\"]\\s*;?\\s*$`);
    const safelyRemovable =
      defaultImport.test(line) ||
      singleNamedImport.test(line) ||
      (standaloneSpecifier.test(line) && insideNamedImport(lines, index));

    if (!safelyRemovable) {
      skipped.push({ symbol, line: lineNumber, reason: "unused declaration is not a standalone import" });
      continue;
    }

    const oldText = lines[index].full;
    if (seen.has(oldText) || source.indexOf(oldText) !== source.lastIndexOf(oldText)) {
      skipped.push({ symbol, line: lineNumber, reason: "source line is not unique" });
      continue;
    }
    seen.add(oldText);
    edits.push({ oldText, newText: "" });
  }

  return { edits, skipped };
}

module.exports = { unusedSymbol, createUnusedImportEdits };