import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = resolve(projectRoot, 'scripts/content/page-bridge');
const outputFile = resolve(projectRoot, 'scripts/content/page-bridge.js');

const sourceModules = [
  { file: '00-runtime-core.js', requires: [] },
  { file: '10-question-parser.js', requires: ['00-runtime-core.js'] },
  { file: '20-websocket-hook.js', requires: ['00-runtime-core.js', '10-question-parser.js'] },
  { file: '30-protocol-helpers.js', requires: ['00-runtime-core.js'] },
  { file: '40-dom-helpers.js', requires: ['00-runtime-core.js'] },
  { file: '50-quiz-multiselect.js', requires: ['00-runtime-core.js', '30-protocol-helpers.js'] },
  { file: '60-pin-handler.js', requires: ['00-runtime-core.js', '30-protocol-helpers.js', '40-dom-helpers.js'] },
  { file: '70-jumble-handler.js', requires: ['00-runtime-core.js', '30-protocol-helpers.js', '40-dom-helpers.js'] },
  { file: '80-slider-handler.js', requires: ['00-runtime-core.js', '30-protocol-helpers.js', '40-dom-helpers.js'] },
  { file: '90-open-ended-handler.js', requires: ['00-runtime-core.js', '40-dom-helpers.js'] },
];

function validateModuleOrder() {
  const seen = new Set();
  for (const module of sourceModules) {
    for (const dependency of module.requires) {
      if (!seen.has(dependency)) {
        throw new Error(`${module.file} requires ${dependency} to appear earlier in the bundle`);
      }
    }
    seen.add(module.file);
  }
}

function indentFragment(source) {
  return source.trimEnd().split('\n').map(line => line ? `  ${line}` : '').join('\n');
}

async function buildBundle() {
  validateModuleOrder();

  const fragments = [];
  for (const module of sourceModules) {
    const source = await readFile(resolve(sourceDirectory, module.file), 'utf8');
    fragments.push(indentFragment(source));
  }

  return [
    '',
    '(function () {',
    "  'use strict';",
    '',
    fragments.join('\n\n'),
    '',
    "  log('Injected - listening');",
    '})();',
    '',
  ].join('\n');
}

const mode = process.argv[2] ?? 'build';
if (mode !== 'build' && mode !== '--check') {
  throw new Error(`Unknown mode: ${mode}. Use no argument to build or --check to verify.`);
}

const expected = await buildBundle();
if (mode === '--check') {
  const actual = await readFile(outputFile, 'utf8');
  if (actual !== expected) {
    console.error('scripts/content/page-bridge.js is stale. Run npm run build:page-bridge.');
    process.exitCode = 1;
  } else {
    console.log('Page bridge bundle is up to date.');
  }
} else {
  await writeFile(outputFile, expected);
  console.log(`Built ${outputFile}`);
}
