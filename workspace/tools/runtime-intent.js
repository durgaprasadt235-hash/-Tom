// Conservative deterministic grammar. Inspection and negation take precedence.
function classify(message) {
  const text = String(message || '').trim().toLowerCase();
  const approval = text.match(/^(approve|reject) execution ([0-9a-f-]{36})[.!]?$/);
  if (approval) return { tool: 'execution.' + approval[1], args: { approvalId: approval[2] } };
  if (/\b(?:do not|don't|dont|never|without|not)\s+(?:\w+\s+)?(?:run|execute|start|restart|stop)\b/.test(text) || /\b(?:what|which|inspect|discover|find|list|show|explain)\b[^.]*\b(?:tests?|scripts?|commands?|package\.json|npm|build|lint)\b/.test(text)) {
    return /\b(?:test|script|command|package\.json|npm|build|lint)/.test(text) ? { tool: 'terminal.discover', args: { cwd: 'web' } } : null;
  }
  const runtime = text.match(/^(?:please\s+)?(start|stop|restart|status|health|logs|port)\s+(?:the\s+)?(?:web\s+)?(?:dev(?:elopment)?\s+)?(?:server|runtime)[.!]?$/);
  if (runtime) return { tool: 'runtime.' + runtime[1], args: { serviceId: 'web' } };
  const command = text.match(/(?:^|[.!]\s*|\band\s+)(?:please\s+)?(?:run|execute|rerun|re-run)\s+(?:(?:the|drop)\s+)*(?:npm\s+(?:run\s+)?)?(tests?(?:\s+suite)?|build|lint)\b/);
  const ensureBuild = /\bmake sure (?:the )?build (?:still )?passes\b/.test(text);
  if (command || ensureBuild) {
    const script = command ? command[1].startsWith('test') ? 'test' : command[1] : 'build';
    return { tool: 'terminal.run', args: { command: script === 'test' ? 'npm test' : 'npm run ' + script, cwd: 'web' } };
  }
  return null;
}
function render(result) {
  if (!result.success) return 'Execution request not performed: ' + result.error;
  if (result.data.status === 'pending_approval') {
    return 'Approval required for consequential execution.\n' + JSON.stringify(result.data.action, null, 2) +
      '\nApproval ID: ' + result.data.approvalId + '\nExpires: ' + result.data.expiresAt +
      '\nReply "approve execution ' + result.data.approvalId + '" or "reject execution ' + result.data.approvalId + '".';
  }
  if (result.data && typeof result.data.command === 'string' && typeof result.data.exitCode !== 'undefined') {
    const status = result.data.exitCode === 0 && !result.data.timedOut ? 'passed' : 'failed';
    return [
      `Verification ${status}: ${result.data.command}`,
      `Exit code: ${result.data.exitCode}`,
      result.data.stdout && result.data.stdout.trim() ? 'Output: ' + result.data.stdout.trim() : null,
      result.data.stderr && result.data.stderr.trim() ? 'Errors: ' + result.data.stderr.trim() : null
    ].filter(Boolean).join('\n');
  }
  return JSON.stringify(result.data, null, 2);
}
module.exports = { classify, render };
