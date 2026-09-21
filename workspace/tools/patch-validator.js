// Deterministic structured-patch validator for Tom's controlled write POC.
//
// Model output must be ONLY JSON of the form {"edits":[{"oldText","newText"}]}.
// No prose, no fallback to full-file replacement. Every edit is validated
// against the current file content before it is ever eligible for approval.

const MAX_EDITS = 20;
const MAX_EDIT_TEXT_LENGTH = 20000;

// Strict JSON-only parse: any surrounding prose or malformed JSON fails closed.
function parseModelEdits(rawText) {
  const text = String(rawText || "").trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error("Proposed patch could not be safely validated.");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.edits)) {
    throw new Error("Proposed patch could not be safely validated.");
  }
  return parsed.edits;
}

// Validates a list of {oldText,newText} edits against currentContent and
// returns the resulting content plus a concise change summary. Throws with
// a safe message on any violation; never partially applies edits.
function validateEdits(currentContent, edits) {
  if (typeof currentContent !== "string") {
    throw new Error("Current file content is required");
  }
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error("At least one edit is required");
  }
  if (edits.length > MAX_EDITS) {
    throw new Error(`Too many edits: max ${MAX_EDITS} allowed`);
  }

  const ranges = [];
  for (const edit of edits) {
    if (!edit || typeof edit !== "object") {
      throw new Error("Each edit must be an object");
    }
    const { oldText, newText } = edit;
    if (typeof oldText !== "string" || oldText.length === 0) {
      throw new Error("Each edit's oldText must be a non-empty string");
    }
    if (typeof newText !== "string") {
      throw new Error("Each edit's newText must be a string");
    }
    if (oldText.length > MAX_EDIT_TEXT_LENGTH || newText.length > MAX_EDIT_TEXT_LENGTH) {
      throw new Error("Edit text exceeds the maximum allowed size");
    }
    if (oldText === newText) {
      throw new Error("Edit is a no-op (oldText and newText are identical)");
    }

    const firstIndex = currentContent.indexOf(oldText);
    if (firstIndex === -1) {
      throw new Error("oldText was not found in the current file content");
    }
    const secondIndex = currentContent.indexOf(oldText, firstIndex + 1);
    if (secondIndex !== -1) {
      throw new Error("oldText must occur exactly once in the current file content");
    }

    ranges.push({ start: firstIndex, end: firstIndex + oldText.length, oldText, newText });
  }

  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start < ranges[i - 1].end) {
      throw new Error("Edits overlap and cannot be applied safely");
    }
  }

  // Apply from the end so earlier ranges' offsets stay valid.
  let result = currentContent;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i];
    result = result.slice(0, r.start) + r.newText + result.slice(r.end);
  }

  if (result.length === 0) {
    throw new Error("Resulting file content must not be empty");
  }

  const summary = ranges.map((r) => ({ removed: r.oldText, added: r.newText }));

  return { content: result, summary };
}

module.exports = { parseModelEdits, validateEdits, MAX_EDITS, MAX_EDIT_TEXT_LENGTH };
