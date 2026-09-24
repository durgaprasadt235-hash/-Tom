// Compatibility surface: execution is exclusively requested/approved through Action Gateway.
const policy = require('./command-policy');
function run() { throw new Error('Direct execution disabled; use Action Gateway terminal.run and execution.approve'); }
function resolveCwd(relative = 'web') { return policy.resolveCwd(require('../agent').DROP_ROOT, relative); }
function validateCommand(command, relative = 'web') { return policy.command(require('../agent').DROP_ROOT, relative, command); }
module.exports = { run, resolveCwd, validateCommand };
