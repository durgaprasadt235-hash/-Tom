// Deterministic chat-response sanitizer (no LLM call).
//
// Some models occasionally leak internal reasoning into the visible reply:
// literal <think>/<analysis> blocks, a "**Analyze User Input**:" style
// heading, numbered planning steps, or reasoning-preamble sentences like
// "We need to..." / "The user wants...". This module strips only those
// structural/internal-reasoning patterns and never touches ordinary prose
// that merely contains words like "analysis" or "the user".

// --------------------------------------------------
// 1) Strip complete/unclosed reasoning tag blocks.
// --------------------------------------------------

const REASONING_TAGS = ["think", "analysis", "reasoning", "scratchpad"];

function stripReasoningTags(text) {
  let result = text;
  for (const tag of REASONING_TAGS) {
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    let lower = result.toLowerCase();
    while (lower.includes(open)) {
      const start = lower.indexOf(open);
      const end = lower.indexOf(close, start);
      if (end === -1) {
        // Unclosed tag: everything after it is untrusted, drop it.
        result = result.slice(0, start);
      } else {
        result = result.slice(0, start) + result.slice(end + close.length);
      }
      lower = result.toLowerCase();
    }
  }
  return result;
}

// --------------------------------------------------
// 2) Strip leading reasoning paragraphs (headings, numbered
//    planning steps, or reasoning-preamble sentences).
// --------------------------------------------------

// Anchored to the START of a paragraph only, so ordinary prose that merely
// mentions "analysis" or "the user" mid-sentence is never matched.
const REASONING_PARAGRAPH_PATTERNS = [
  // Bold/markdown reasoning headings, e.g. "**Analyze User Input**:", "**Analysis**:"
  /^\**\s*(analyz(?:e|ing) user input|analysis|thinking|reasoning|internal reasoning|scratchpad|chain of thought|thought process|identify key requirements|key requirements|examine (?:the )?(?:provided )?(?:file )?content)\s*\**\s*:/i,
  // Numbered planning steps, e.g. "2.  **Identify Key Requirements**:"
  /^\d+\.\s*\**/,
  // Reasoning-preamble sentences about the request itself, not the user's domain.
  /^\s*(we need to|i need to|let'?s (?:think|analyze|break this down)|first,? i (?:will|need to|should)|okay,?\s*(?:so|let))\b/i,
  /^\s*the user('?s question is|\s+(?:wants|is asking|requested))\b/i
];

function isReasoningParagraph(paragraph) {
  const trimmed = paragraph.trim();
  return REASONING_PARAGRAPH_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function stripLeadingReasoningParagraphs(text) {
  const paragraphs = text.split(/\n{2,}/);
  let start = 0;
  // Always keep at least the final paragraph so a genuine answer is never
  // fully erased, even if the model's whole response looked like reasoning.
  while (start < paragraphs.length - 1 && isReasoningParagraph(paragraphs[start])) {
    start += 1;
  }
  return paragraphs.slice(start).join("\n\n");
}

function stripChainOfThought(reply) {
  let text = String(reply || "");
  text = stripReasoningTags(text);
  text = stripLeadingReasoningParagraphs(text);
  return text.trim();
}

module.exports = { stripChainOfThought };
