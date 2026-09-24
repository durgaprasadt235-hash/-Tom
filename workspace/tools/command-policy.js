const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const COMMANDS = Object.freeze({ 'npm test': 'test', 'npm run build': 'build', 'npm run lint': 'lint', 'npm run dev': 'dev' });
const within = (root, target) => target === root || target.startsWith(root + path.sep);
function resolveCwd(root, relative = 'web') {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..') || relative.includes('\0')) throw new Error('cwd must be project-relative without traversal');
  const canonicalRoot = fs.realpathSync(root);
  const lexical = path.resolve(root, relative);
  if (!within(path.resolve(root), lexical)) throw new Error('cwd outside authorized project');
  const real = fs.realpathSync(lexical);
  if (!within(canonicalRoot, real)) throw new Error('cwd symlink outside authorized project');
  if (!fs.statSync(real).isDirectory()) throw new Error('cwd is not a directory');
  return real;
}
function inspect(root, relative = 'web') {
  const cwd = resolveCwd(root, relative);
  const file = fs.realpathSync(path.join(cwd, 'package.json'));
  if (!within(fs.realpathSync(root), file)) throw new Error('package.json outside authorized project');
  if (fs.statSync(file).size > 256 * 1024) throw new Error('package.json exceeds size limit');
  const source = fs.readFileSync(file, 'utf8');
  const pkg = JSON.parse(source);
  const scripts = Object.create(null);
  for (const script of ['test', 'build', 'lint', 'dev']) {
    if (Object.hasOwn(pkg.scripts || {}, script) && typeof pkg.scripts[script] === 'string' && pkg.scripts[script].trim()) {
      scripts[script] = pkg.scripts[script];
    }
  }
  return { cwd, scripts, packageHash: crypto.createHash('sha256').update(source).digest('hex') };
}
function command(root, relative, value, runtime = false) {
  if (typeof value !== 'string' || !Object.hasOwn(COMMANDS, value) || (!runtime && value === 'npm run dev')) throw new Error('Command is not allowlisted');
  const info = inspect(root, relative);
  const script = COMMANDS[value];
  if (!Object.hasOwn(info.scripts, script)) throw new Error(`Package does not define script: ${script}`);
  return { ...info, command: value, script, args: script === 'test' ? ['test'] : ['run', script] };
}
function plainArgs(args, allowed) {
  if (!args || Object.getPrototypeOf(args) !== Object.prototype || Object.keys(args).some(key => !allowed.includes(key))) throw new Error('Invalid or unexpected tool arguments');
}
module.exports = { resolveCwd, inspect, command, plainArgs };
