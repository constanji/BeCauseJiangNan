// rollup.config.js
import path from 'path';
import { fileURLToPath } from 'url';
import alias from '@rollup/plugin-alias';
import commonjs from '@rollup/plugin-commonjs';
import { cleandir } from 'rollup-plugin-cleandir';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import json from '@rollup/plugin-json';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';
const enableSourcemap = process.env.DISABLE_SOURCEMAP !== 'true';
const cjsOnly = process.env.CJS_ONLY === 'true';

const excludedDirsInProd = [
  'src/scripts/',
  'src/specs/',
  'src/proto/',
  'routes/',
  'config/',
];

function filterProdFiles(id) {
  if (isProduction) {
    return !excludedDirsInProd.some((dir) => id.includes(dir));
  }
  return true;
}

/**
 * Pure-transpile TS/TSX -> JS via esbuild, one file at a time.
 *
 * Why not @rollup/plugin-typescript: it drives the real TypeScript compiler,
 * which — even with declaration/checking nominally "off" via plugin options —
 * still builds one full ts.Program over every reachable file to do the
 * transpile correctly. A handful of files under src/tools/ (Calculator,
 * CodeExecutor, ProgrammaticToolCalling, ToolSearchRegex, search tools) wrap
 * heavy Zod schemas in LangChain's generic tool helpers; once enough of them
 * sit in the same Program, generic-instantiation caching blows up and the
 * process OOMs at an 8GB heap after several minutes (exit code 134) — the
 * exact same root cause diagnosed for `build:types` (see config/build-types.js),
 * just hit here via Rollup instead of a bare `tsc` invocation.
 *
 * esbuild's transformSync has no such failure mode: it never builds a
 * type-checking Program at all, so there is no generic-instantiation state to
 * accumulate across files. It only strips types and downlevels syntax
 * per-file, in isolation — exactly what a "pure transpile" runtime build
 * needs. Real type checking already runs separately (and safely, in batches)
 * via `npm run build:types`; this build is not the place that needs to catch
 * type errors.
 */
function esbuildTranspile() {
  return {
    name: 'esbuild-transpile',
    transform(code, id) {
      if (!/\.tsx?$/.test(id) || id.includes('node_modules')) {
        return null;
      }
      const result = esbuild.transformSync(code, {
        loader: id.endsWith('.tsx') ? 'tsx' : 'ts',
        format: 'esm',
        target: 'node18',
        sourcefile: id,
        sourcemap: enableSourcemap ? 'external' : false,
      });
      return {
        code: result.code,
        map: result.map ? JSON.parse(result.map) : null,
      };
    },
  };
}

const outputs = [];
if (!cjsOnly) {
  outputs.push({
    dir: 'dist/esm',
    format: 'es',
    entryFileNames: '[name].mjs',
    sourcemap: enableSourcemap,
    preserveModules: true,
    preserveModulesRoot: 'src',
  });
}
outputs.push({
  dir: 'dist/cjs',
  format: 'cjs',
  entryFileNames: '[name].cjs',
  sourcemap: enableSourcemap,
  preserveModules: true,
  preserveModulesRoot: 'src',
  exports: 'named',
});

export default {
  input: {
    main: './src/index.ts',
  },
  output: outputs,
  plugins: [
    // Only wipe JS outputs; keep dist/types so a failed/OOM tsc does not leave the package typeless
    cleandir(cjsOnly ? ['dist/cjs'] : ['dist/cjs', 'dist/esm']),
    {
      name: 'filter-prod-files',
      resolveId(source, importer) {
        if (importer && !filterProdFiles(source)) {
          return false;
        }
      },
    },
    alias({
      entries: [{ find: '@', replacement: path.resolve(__dirname, 'src') }],
    }),
    nodeResolve({
      preferBuiltins: true,
      extensions: ['.mjs', '.js', '.json', '.node', '.ts'],
    }),
    commonjs({
      esmExternals: true,
      requireReturnsDefault: 'auto',
    }),
    json(),
    esbuildTranspile(),
    /* Disable terser/obfuscator for now */
    // isProduction && terser(),
    // isProduction && obfuscator({
    //   exclude: [
    //     'node_modules/**',
    //     '**/*.spec.ts',
    //     'tsconfig-paths-bootstrap.mjs',
    //     'src/proto/**',
    //     'src/scripts/**',
    //     'dist/**',
    //     'config/**',
    //     'routes/**'
    //   ]
    // })
  ].filter(Boolean),
  external: [/node_modules/],
};
