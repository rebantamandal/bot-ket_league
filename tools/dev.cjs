'use strict';
// Rebuild index.html whenever src/ changes. Open index.html in a browser and reload after each build.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const python = ['python3', 'python'].find(cmd => spawnSync(cmd, ['--version']).status === 0);
if (!python) throw Error('Python 3 is required to build.');

let timer = null;
function build() {
  const started = Date.now();
  const result = spawnSync(python, [path.join(root, 'build.py')], { encoding: 'utf8' });
  const stamp = new Date().toLocaleTimeString();
  if (result.status === 0) console.log(`[${stamp}] built in ${Date.now() - started} ms`);
  else console.error(`[${stamp}] build failed\n${result.stderr}`);
}

build();
fs.watch(path.join(root, 'src'), () => {
  clearTimeout(timer);
  timer = setTimeout(build, 80);
});
console.log('Watching src/ for changes. Reload index.html after each build.');
