import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distTypesDir = path.join(rootDir, 'dist', 'types');

/**
 * Declaration files are generated in isolated batches (separate tsc processes)
 * instead of one monolithic `tsc -p tsconfig.build.json` run. Each batch only
 * needs to hold its own dependency closure in memory, and the process exits
 * (freeing all heap) between batches, which keeps peak RSS bounded and avoids
 * the OOM crashes a single full-project declaration build was hitting.
 *
 * Batches are ordered from the fewest internal dependencies to the most, so
 * that if one still OOMs it's easy to see which area of the codebase is the
 * heavy one and split it further.
 */
const BATCHES = [
  { name: 'foundation', config: 'tsconfig.types.foundation.json', heapMb: 4096 },
  { name: 'llm', config: 'tsconfig.types.llm.json', heapMb: 6144 },
  { name: 'messages', config: 'tsconfig.types.messages.json', heapMb: 4096 },
  // The 4 tools/* files below each use heavy Zod/LangChain tool-wrapper
  // generics. Individually they're slow (up to ~3.5min) but fine; combined
  // into a single tsc program their generic-instantiation caches compound
  // and reliably OOM even at an 8GB heap. Each gets its own process.
  { name: 'tools:calculator', config: 'tsconfig.types.tools.calculator.json', heapMb: 4096 },
  { name: 'tools:codeexecutor', config: 'tsconfig.types.tools.codeexecutor.json', heapMb: 6144 },
  { name: 'tools:programmatic', config: 'tsconfig.types.tools.ptc.json', heapMb: 6144 },
  { name: 'tools:searchregex', config: 'tsconfig.types.tools.searchregex.json', heapMb: 6144 },
  { name: 'tools:searchtool', config: 'tsconfig.types.tools.searchtool.json', heapMb: 8192 },
  { name: 'core', config: 'tsconfig.types.core.json', heapMb: 8192 },
];

/**
 * TypeScript's default `noEmitOnError` is false: even when a batch reports
 * type errors, it still writes out whatever .d.ts files it managed to
 * produce. Pre-existing type errors (duplicate @anthropic-ai/sdk versions,
 * one legitimately-too-deep generic in utils/schema.ts, etc.) are unrelated
 * to the OOM problem this script exists to solve, so batches are allowed to
 * "fail" (non-zero exit) without aborting the whole run — we only care
 * whether the process crashed (OOM/signal) vs. finished and emitted output.
 */
let hadTypeErrors = false;

/** Hand-written barrel: mirrors src/index.ts, re-exporting already-emitted
 * sibling declaration files. Compiling src/index.ts directly with tsc would
 * re-trigger a full-program pass (it re-exports everything with `export *`),
 * which defeats the whole point of batching, so we assemble it by hand
 * instead of invoking tsc a 6th time. */
const INDEX_DTS_SOURCE = path.join(rootDir, 'src', 'index.ts');
const INDEX_DTS_TARGET = path.join(distTypesDir, 'index.d.ts');

function runBatch({ name, config, heapMb }) {
  console.log(`\n[build-types] ▶ batch "${name}" (${config}, heap ${heapMb}MB)`);
  const started = Date.now();
  const result = spawnSync('npx', ['tsc', '-p', config], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: `--max-old-space-size=${heapMb}`,
    },
  });
  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  if (result.signal) {
    // Killed by a signal (e.g. SIGKILL/SIGABRT from an OOM) — this is the
    // one failure mode we can't recover from, so stop the whole run here.
    console.error(
      `[build-types] ✖ batch "${name}" was killed by signal ${result.signal} after ${elapsedSec}s (likely OOM) — aborting`,
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    console.warn(
      `[build-types] ⚠ batch "${name}" reported type errors (exit ${result.status}) after ${elapsedSec}s — declaration files for unaffected modules were still emitted, continuing`,
    );
    hadTypeErrors = true;
  } else {
    console.log(`[build-types] ✔ batch "${name}" done in ${elapsedSec}s`);
  }
}

/** Recursively collect .ts source files under `dir`, skipping tests/scripts/specs. */
function collectSourceFiles(dir) {
  const skipDirs = new Set(['__tests__', 'scripts', 'specs', 'proto', 'test']);
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      results.push(...collectSourceFiles(path.join(dir, entry.name)));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) continue;
    // Ad-hoc scratch scripts (e.g. tools/search/test.ts) that aren't part of
    // the public API and aren't reachable from src/index.ts.
    if (entry.name === 'test.ts') continue;
    results.push(path.join(dir, entry.name));
  }
  return results;
}

/** Verify every non-test source file has a matching emitted .d.ts; report any gaps. */
function verifyCompleteness() {
  const srcDir = path.join(rootDir, 'src');
  const sourceFiles = collectSourceFiles(srcDir);
  const missing = [];
  for (const file of sourceFiles) {
    const relative = path.relative(srcDir, file).replace(/\.ts$/, '.d.ts');
    const expected = path.join(distTypesDir, relative);
    if (!fs.existsSync(expected)) {
      missing.push(path.relative(rootDir, file));
    }
  }
  if (missing.length > 0) {
    console.warn(`\n[build-types] ⚠ ${missing.length} source file(s) have no emitted declaration:`);
    for (const file of missing) {
      console.warn(`  - ${file}`);
    }
  } else {
    console.log('\n[build-types] ✔ every non-test source file has a matching .d.ts');
  }
  return missing;
}

function writeIndexDeclaration() {
  if (!fs.existsSync(INDEX_DTS_SOURCE)) {
    console.warn('[build-types] src/index.ts not found, skipping dist/types/index.d.ts generation');
    return;
  }
  const source = fs.readFileSync(INDEX_DTS_SOURCE, 'utf8');
  fs.mkdirSync(distTypesDir, { recursive: true });
  fs.writeFileSync(
    INDEX_DTS_TARGET,
    `// Auto-generated by config/build-types.js — mirrors src/index.ts.\n// Do not hand-edit; re-run \`npm run build:types\` instead.\n${source}`,
  );
  console.log(`[build-types] ✔ wrote ${path.relative(rootDir, INDEX_DTS_TARGET)}`);
}

function main() {
  fs.rmSync(distTypesDir, { recursive: true, force: true });
  fs.mkdirSync(distTypesDir, { recursive: true });

  for (const batch of BATCHES) {
    runBatch(batch);
  }

  writeIndexDeclaration();
  const missing = verifyCompleteness();

  if (missing.length > 0) {
    console.error(
      `\n[build-types] ✖ dist/types is incomplete (${missing.length} file(s) missing). Add the missing paths to one of the tsconfig.types.*.json "include" lists.`,
    );
    process.exit(1);
  }

  if (hadTypeErrors) {
    console.warn(
      '\n[build-types] Done with pre-existing type errors reported above (unrelated to memory) — dist/types was still fully emitted.',
    );
  } else {
    console.log('\n[build-types] All batches complete, no type errors. dist/types is ready.');
  }
}

main();
