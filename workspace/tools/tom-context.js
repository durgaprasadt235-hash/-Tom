#!/usr/bin/env node
// Minimal CLI wrapper for the existing Tom Context Builder.
// Calls the running Tom server (which holds the live VS Code bridge
// session) instead of building context in this separate process.
// Usage: node tools/tom-context.js [relativeFilePath ...]

const TOM_SERVER_URL = "http://localhost:3001/context";

async function main() {
  const paths = process.argv.slice(2);
  const response = await fetch(TOM_SERVER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths })
  });
  const context = await response.json();
  if (!response.ok) {
    throw new Error(context.error || `Tom server returned HTTP ${response.status}`);
  }
  console.log(JSON.stringify(context, null, 2));
}

main().catch((error) => {
  console.error("tom-context failed:", error.message || "Unknown error");
  process.exit(1);
});
