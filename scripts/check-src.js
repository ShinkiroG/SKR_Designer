// Verifica a sintaxe de todos os scripts da interface (npm run check).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

for (const file of walk(path.join(__dirname, '..', 'src'))) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
console.log('ok');
