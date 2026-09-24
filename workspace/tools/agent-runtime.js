const MAX_HISTORY_MESSAGES = 12;

function sanitizeAndBoundHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string" && item.content.trim())
    .map((item) => ({
      role: item.role,
      content: item.content.trim(),
      ...(typeof item.approvalId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.approvalId)
        ? { approvalId: item.approvalId }
        : {})
    }))
    .slice(-MAX_HISTORY_MESSAGES);
}

function findPendingApprovalId(history) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].role !== "assistant") continue;
    if (history[index].approvalId) return history[index].approvalId;
    const match = history[index].content.match(/\bApproval ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
    if (match) return match[1];
  }
  return null;
}

function resolveArgs(step, evidence) {
  if (!step.args || !step.args.pathFrom) return step.args || {};
  const dependency = evidence.find((item) => item.tool === step.args.pathFrom && item.success);
  return dependency && dependency.data && dependency.data.available && dependency.data.path
    ? { path: dependency.data.path }
    : null;
}

async function executePlan(plan, executeTool) {
  const evidence = [];
  for (const step of plan.steps) {
    if (step.candidatePathsFrom) {
      const dependency = evidence.find((item) => item.tool === step.candidatePathsFrom && item.success);
      const treeEvidence = step.candidatePathsAllowedBy
        ? evidence.find((item) => item.tool === step.candidatePathsAllowedBy && item.success)
        : dependency;
      const availablePaths = new Set(treeEvidence?.data?.tree
        ?.filter((entry) => entry && entry.type === "file")
        .map((entry) => entry.path) || []);
      const dependencyPaths = dependency?.data?.matches?.map((match) => match.path) || [];
      const candidates = step.candidatePaths || dependencyPaths;
      const candidatePaths = candidates
        .filter((candidate) => !treeEvidence || availablePaths.has(candidate))
        .filter((candidate) => !step.candidatePathsFrom || dependencyPaths.length === 0 || dependencyPaths.includes(candidate))
        .slice(0, step.maxCandidates || 6);
      for (const candidatePath of candidatePaths) {
        const result = await executeTool(step.tool, { path: candidatePath });
        evidence.push({
          tool: step.tool,
          args: { path: candidatePath },
          success: !!(result && result.success),
          data: result && result.success ? result.data : { error: (result && result.error) || "Tool execution failed" }
        });
      }
      continue;
    }
    const args = resolveArgs(step, evidence);
    if (args === null) {
      evidence.push({ tool: step.tool, args: step.args || {}, success: false, data: { error: `Dependency unavailable: ${step.dependsOn}` } });
      continue;
    }
    const result = await executeTool(step.tool, args);
    evidence.push({
      tool: step.tool,
      args,
      success: !!(result && result.success),
      data: result && result.success ? result.data : { error: (result && result.error) || "Tool execution failed" }
    });
  }
  return evidence;
}

module.exports = { MAX_HISTORY_MESSAGES, sanitizeAndBoundHistory, findPendingApprovalId, executePlan };