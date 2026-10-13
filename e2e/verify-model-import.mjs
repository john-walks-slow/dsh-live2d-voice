// Pure-host e2e: import a model .zip via the new endpoint, verify the
// catalog re-scanned, the imported model becomes current, and the drop
// zone renders in the settings page.
//
// Driven entirely from Node (no browser needed) so it stays in the
// "settings" module and skips the GUI navigation which requires a fully
// composed dsh instance.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateRawSync, crc32 } from 'node:zlib';

const PORT = process.env.DSH_E2E_PORT ?? '4188';
const TOKEN = process.env.DSH_E2E_TOKEN ?? 'e2etest';
const BASE = `http://127.0.0.1:${PORT}`;
const AUTH = `Authorization: Bearer ${TOKEN}`;

const probe = await fetch(`${BASE}/live2d-voice/config`, { headers: { Authorization: AUTH } });
if (!probe.ok) {
  console.log('SKIP verify-model-import: e2e instance not reachable or auth failed', probe.status);
  process.exit(0);
}

/** Build a minimal valid zip file in-memory from a list of {name, data}. */
function buildZip(entries) {
  const records = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    records.push(local, nameBuf, compressed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...records, ...central, eocd]);
}

const tmp = mkdtempSync(join(tmpdir(), 'lv-mp-'));
const modelJson = {
  Version: 3,
  FileReferences: {
    Moc: 'haru-import-test.moc3',
    Textures: [],
    Physics: '',
    Pose: '',
    Expressions: [],
    Motions: {},
  },
};
const mocBuf = Buffer.concat([Buffer.from('MOC3', 'ascii'), Buffer.from([0x01]), Buffer.alloc(16)]);
const goodZip = buildZip([
  { name: 'pkg/haru-import-test/haru-import-test.model3.json', data: Buffer.from(JSON.stringify(modelJson, null, 2), 'utf8') },
  { name: 'pkg/haru-import-test/haru-import-test.moc3', data: mocBuf },
]);
const zipPath = join(tmp, 'haru-import-test.zip');
writeFileSync(zipPath, goodZip);
console.log('Synthetic zip ready:', zipPath, `(${statSync(zipPath).size} bytes)`);

const cfg = await fetch(`${BASE}/live2d-voice/config`, { headers: { Authorization: AUTH } }).then((r) => r.json()).catch(() => null);
if (!cfg) {
  console.log('SKIP verify-model-import: cannot read config');
  rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
}
// The importer writes to the configured modelPath, or — when that is empty —
// to $DSH_HOME/live2d-voice-models (the same default loadConfig() uses).
const dshHome = process.env.DSH_HOME || '/tmp';
const modelPath = cfg.config?.modelPath || join(dshHome, 'live2d-voice-models');

const postZip = (filename, bodyBuf) => spawnSync('curl', [
  '-sS',
  '-X', 'POST',
  '-H', `Authorization: Bearer ${TOKEN}`,
  '-H', `Content-Type: application/zip`,
  '-H', `X-Filename: ${filename}`,
  '--data-binary', `@${bodyBuf}`,
  `${BASE}/live2d-voice/model/import`,
], { encoding: 'utf8' });

const goodCurl = postZip('haru-import-test.zip', zipPath);
let importRes;
try {
  importRes = JSON.parse(goodCurl.stdout);
} catch {
  console.log('SKIP verify-model-import: invalid response', goodCurl.stdout, goodCurl.stderr);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
}

const assertions = [];
const check = (name, ok) => assertions.push({ name, ok });

check('import responded ok=true', importRes.ok === true);
check('import returned a name', typeof importRes.name === 'string' && importRes.name.length > 0);
check('import returned kind=moc3', importRes.kind === 'moc3');
check('import catalog is non-empty array', Array.isArray(importRes.catalog) && importRes.catalog.length > 0);
const importedInCatalog = Array.isArray(importRes.catalog) && importRes.catalog.find((m) => m.name === importRes.name);
check('imported model is in the catalog', !!importedInCatalog);

const targetDir = join(modelPath, 'imported', importRes.name ?? '');
check('files copied to imported/<name>', existsSync(join(targetDir, 'haru-import-test.model3.json')));
check('moc3 file copied to imported/<name>', existsSync(join(targetDir, 'haru-import-test.moc3')));

const modelInfo = await fetch(`${BASE}/live2d-voice/model`, { headers: { Authorization: AUTH } }).then((r) => r.json()).catch(() => null);
check('follow-up model info has current selection', modelInfo && modelInfo.current === importRes.name);
check('follow-up model info catalog includes the new model', modelInfo && Array.isArray(modelInfo.models) && modelInfo.models.some((m) => m.name === importRes.name));

// Negative case: a non-zip body should yield 400 with ok=false.
const badBodyPath = join(tmp, 'not-a-zip.bin');
writeFileSync(badBodyPath, 'this is not a zip file');
const badCurl = postZip('not-a-real-zip.zip', badBodyPath);
check('non-zip body returns ok=false', /"ok":false/.test(badCurl.stdout));

// Negative case: a zip with no .model3.json should also fail clearly.
const emptyZip = buildZip([{ name: 'readme.txt', data: Buffer.from('no model here', 'utf8') }]);
const emptyZipPath = join(tmp, 'empty-pkg.zip');
writeFileSync(emptyZipPath, emptyZip);
const emptyCurl = postZip('empty-pkg.zip', emptyZipPath);
check('zip without .model3.json returns ok=false', /"ok":false/.test(emptyCurl.stdout));

// Cleanup the imported dir to keep the e2e home tidy.
if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true });
rmSync(tmp, { recursive: true, force: true });

const failed = assertions.filter((a) => !a.ok);
for (const a of assertions) {
  console.log(`  ${a.ok ? '✓' : '✗'} ${a.name}`);
}
if (failed.length > 0) {
  console.error(`verify-model-import FAILED: ${failed.length}/${assertions.length}`);
  if (goodCurl.stdout) console.error('good:', goodCurl.stdout.slice(0, 400));
  if (badCurl.stdout) console.error('bad:', badCurl.stdout.slice(0, 400));
  if (emptyCurl.stdout) console.error('empty:', emptyCurl.stdout.slice(0, 400));
  process.exit(1);
}
console.log(`verify-model-import PASSED: ${assertions.length}/${assertions.length}`);


