// jest.config.mjs
import { pathsToModuleNameMapper } from 'ts-jest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const tsconfig = require('./tsconfig.json');

const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.test.ts', '**/src/**/*.spec.ts'],
  moduleNameMapper: pathsToModuleNameMapper(tsconfig.compilerOptions.paths, {
    prefix: '<rootDir>/'
  }),
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        // Do NOT use global diagnostics.warnOnly — that would let new type
        // errors in test/source files slip through the Jest gate.
        //
        // These two paths have pre-existing type errors from duplicate
        // @anthropic-ai/sdk package versions between the monorepo root and
        // agents-because/node_modules (see config/build-types.js). Excluding
        // them from *Jest* type-checking lets Graph/ToolNode integration
        // tests load; the real type gate remains `npm run build:types`
        // (batched tsc), which CI must keep as a required step.
        diagnostics: {
          exclude: [
            '**/src/llm/anthropic/**',
            '**/src/run.ts',
          ],
        },
      },
    ],
  },
  modulePaths: [
    '<rootDir>'
  ],
  verbose: true,
  // setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironmentOptions: {
    env: {
      NODE_ENV: 'test'
    }
  },
  // Limit concurrent test execution to avoid rate limits
  maxWorkers: 7,  // Number of worker processes
  maxConcurrency: 1,  // Number of tests that can run in each worker
  // Alternative: use percentage of available CPUs
  // maxWorkers: '50%',
  
  // Optional: increase timeout for network requests
  testTimeout: 30000,  // 30 seconds (default is 5 seconds)
  
  // Optional: run tests serially (one at a time) - uncomment if needed
  // runInBand: true,
};

export default config;