import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const javaFile = path.join(root, 'server/drivers/gaussdb-jdbc/GaussJdbcQuery.java');
const classFile = path.join(root, 'server/drivers/gaussdb-jdbc/GaussJdbcQuery.class');
const jar = path.join(root, 'server/drivers/lib/gsjdbc4-1.0.jar');

if (!fs.existsSync(javaFile)) {
  console.warn('[Schema] GaussJdbcQuery.java not found, skip compile');
  process.exit(0);
}
if (!fs.existsSync(jar)) {
  console.warn('[Schema] gsjdbc4-1.0.jar not found — place it under server/drivers/lib/');
  process.exit(0);
}

const javacBin = process.env.JAVAC_BIN || 'javac';
const javacCheck = spawnSync(javacBin, ['-version'], { encoding: 'utf8' });
if (javacCheck.error || javacCheck.status !== 0) {
  console.warn('[Schema] Java runtime not found — run manually after installing JRE:');
  console.warn(`  javac -encoding UTF-8 -cp ${jar} -d server/drivers/gaussdb-jdbc server/drivers/gaussdb-jdbc/GaussJdbcQuery.java`);
  process.exit(0);
}

const result = spawnSync(
  javacBin,
  ['-encoding', 'UTF-8', '-cp', jar, '-d', path.dirname(javaFile), javaFile],
  { encoding: 'utf8', cwd: root },
);

if (result.status !== 0) {
  console.warn('[Schema] javac failed:', result.stderr || result.stdout);
  process.exit(0);
}

if (fs.existsSync(classFile)) {
  console.log('[Schema] GaussJdbcQuery.class ready');
}
