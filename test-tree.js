const { getProjectTree, readProjectFile, listProjectFiles, DROP_ROOT } = require('./agent');

console.log('=== TEST A: getProjectTree ===');
const treeResult = getProjectTree(DROP_ROOT);
console.log('Total entries:', treeResult.tree.length);
console.log('Truncated:', treeResult.truncated);
console.log('First 30 paths:');
treeResult.tree.slice(0, 30).forEach(e => console.log('  ', e.path, '(' + e.type + ')'));

console.log('\n=== TEST B: Disallowed paths ===');
const disallowed = ['.env', '.git', '.vercel', 'node_modules', '.next', 'dist', 'build', 'coverage'];
const matches = treeResult.tree.filter(e => {
  const parts = e.path.split('/');
  return parts.some(p => disallowed.includes(p));
});
console.log('Matching disallowed paths:', JSON.stringify(matches, null, 2));
console.log('Expected: []');
console.log('Result:', matches.length === 0 ? 'PASS' : 'FAIL');

console.log('\n=== TEST C: readProjectFile(".env.local") ===');
try {
  const content = readProjectFile('.env.local');
  console.log('UNEXPECTED SUCCESS');
} catch (e) {
  console.log('Error:', e.message);
}

console.log('\n=== TEST D: readProjectFile("../../../etc/passwd") ===');
try {
  const content = readProjectFile('../../../etc/passwd');
  console.log('UNEXPECTED SUCCESS');
} catch (e) {
  console.log('Error:', e.message);
}

console.log('\n=== TEST E: Read a real source file ===');
// Find a real .js/.jsx/.ts/.tsx/.json/.py file from the tree (excluding blocked)
const validExtensions = ['.js', '.jsx', '.ts', '.tsx', '.json', '.py'];
const candidates = treeResult.tree.filter(e => {
  if (e.type !== 'file') return false;
  const ext = e.path.split('.').pop();
  return validExtensions.includes('.' + ext);
}).filter(e => !e.path.startsWith('.git') && !e.path.includes('node_modules'));

if (candidates.length > 0) {
  const testPath = candidates[0].path;
  try {
    const content = readProjectFile(testPath);
    console.log('Path:', testPath);
    console.log('SUCCESS');
    console.log('Character count:', content.length);
  } catch (e) {
    console.log('Path:', testPath);
    console.log('FAILED:', e.message);
  }
} else {
  console.log('No suitable test file found');
}