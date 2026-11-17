// Gate verification for the token-radar-01 entry: checks every rule the sealed scorer checks,
// against a built output directory and the sealed snapshot. Run:
//   node verify.mjs <out-dir> <snapshot.json>
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';

const outDir = process.argv[2] ?? 'out';
const snapFile = process.argv[3] ?? '/home/hatch/workspace/makefun/token-radar-01-kit/input/snapshot.json';
const fails = [];
const passes = [];
function check(name, ok, detail = '') {
  (ok ? passes : fails).push(`${name}${detail ? ` (${detail})` : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const snap = JSON.parse(readFileSync(snapFile, 'utf8'));
const snapSlugs = new Set(snap.protocols.map((p) => p.slug));
const boardRaw = readFileSync(join(outDir, 'board.json'), 'utf8');
const board = JSON.parse(boardRaw);
const rows = Array.isArray(board) ? board : board.rows;
check('board.json is an object with rows', Array.isArray(rows), `${rows.length} rows`);
check('board row count 100..4000', rows.length >= 100 && rows.length <= 4000, String(rows.length));
check('board.json at most 8 MiB', Buffer.byteLength(boardRaw) <= 8 * 1024 * 1024, `${(Buffer.byteLength(boardRaw) / 1024).toFixed(0)} KiB`);
const watchMissing = snap.watchlist.filter((s) => !rows.some((r) => r.slug === s));
check('watchlist fully covered', watchMissing.length === 0, watchMissing.length ? `missing: ${watchMissing.join(', ')}` : '40/40');
const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
check('ranks exactly 1..N once each', ranks.every((r, i) => r === i + 1), `N=${rows.length}`);
const byRank = rows.slice().sort((a, b) => a.rank - b.rank);
check('implied never rises with rank', byRank.every((r, i) => i === 0 || r.implied_value_usd <= byRank[i - 1].implied_value_usd));
check('not all implied identical', new Set(rows.map((r) => r.implied_value_usd)).size > 1, `${new Set(rows.map((r) => r.implied_value_usd)).size} distinct`);
let rowsOk = true;
for (const r of rows) {
  if (!snapSlugs.has(r.slug) || typeof r.name !== 'string' || r.name.length === 0) { rowsOk = false; break; }
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) { rowsOk = false; break; }
  if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) { rowsOk = false; break; }
  if (r.farm_steps.some((s) => typeof s !== 'string' || s.trim().length < 20 || s.trim().length > 600)) { rowsOk = false; break; }
  if (new Set(rows.map((x) => x.slug)).size !== rows.length) { rowsOk = false; break; }
}
check('every row: known slug, name, implied 1..1e14, 3..12 farm steps of 20..600 chars, slugs unique', rowsOk);

// Dashboard files.
const dashDir = join(outDir, 'dashboard');
const dashFiles = readdirSync(dashDir).filter((f) => statSync(join(dashDir, f)).isFile());
check('dashboard has index.html', dashFiles.includes('index.html'));
check('dashboard has a .css', dashFiles.some((f) => f.endsWith('.css')));
check('dashboard has a .js', dashFiles.some((f) => f.endsWith('.js')));
let dashBytes = 0;
let urlOffense = null;
const URL_ATTR = /<(?:[^>]*\s)(?:href|src|action|poster|data|cite|background)\s*=\s*["'][^"']*https?:\/\//i;
const URL_CSS = /https?:\/\//;
const URL_JS_IMPORT = /(?:import|export\s+(?:\*|\{[^}]*\})\s+from|require\s*\(|import\s*\()\s*["']https?:\/\//;
for (const f of dashFiles) {
  const p = join(dashDir, f);
  dashBytes += statSync(p).size;
  const text = readFileSync(p, 'utf8');
  if (f.endsWith('.html') && URL_ATTR.test(text)) urlOffense = `${f}: http(s) in an HTML attribute`;
  if (f.endsWith('.css') && URL_CSS.test(text)) urlOffense = `${f}: http(s) in CSS`;
  if (f.endsWith('.js') && URL_JS_IMPORT.test(text)) urlOffense = `${f}: http(s) in a JS import`;
  if (f.endsWith('.html') && /<style[^>]*>[^<]*https?:\/\//i.test(text)) urlOffense = `${f}: http(s) in an inline style`;
}
check('dashboard at most 400 files / 4 MiB', dashFiles.length <= 400 && dashBytes <= 4 * 1024 * 1024, `${dashFiles.length} files, ${(dashBytes / 1024).toFixed(1)} KiB`);
check('no http(s) address in HTML attributes, CSS, or JS imports', urlOffense === null, urlOffense ?? '');

// Screenshots.
const shotDir = join(outDir, 'screenshots');
const shots = readdirSync(shotDir).filter((f) => !f.startsWith('.') && statSync(join(shotDir, f)).isFile());
check('screenshots: 3..4 images', shots.length >= 3 && shots.length <= 4, `${shots.length}: ${shots.join(', ')}`);
const { execSync } = await import('node:child_process');
for (const f of shots) {
  const p = join(shotDir, f);
  const size = statSync(p).size;
  let dims = '';
  try {
    dims = execSync(`python3 -c "from PIL import Image; im=Image.open('${p}'); print(f'{im.width}x{im.height}')"` , { encoding: 'utf8' }).trim();
  } catch {
    try {
      const buf = readFileSync(p);
      if (buf[0] === 0x89) { dims = `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)} (PNG header)`; }
    } catch { /* ignore */ }
  }
  const [w, h] = dims.split('x').map(Number);
  const longSide = Math.max(w || 0, h || 0);
  const shortSide = Math.min(w || 0, h || 0);
  check(`screenshot ${f} at most 512 KiB`, size <= 524_288, `${(size / 1024).toFixed(0)} KiB`);
  check(`screenshot ${f} long side at most 1440, short side at least 800`, longSide <= 1440 && shortSide >= 800, dims);
}

// Dossier byte-for-byte.
const dossierOnDisk = readFileSync(join(outDir, 'dossier.json'));
const rebuilt = buildDossier(outDir, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } });
check('dossier.json byte-for-byte what buildDossier writes', Buffer.compare(dossierOnDisk, Buffer.from(rebuilt)) === 0, `${(dossierOnDisk.length / 1024).toFixed(0)} KiB on disk`);
check('dossier.json at most 1.5 MiB', dossierOnDisk.length <= 1_572_864, `${(dossierOnDisk.length / 1024).toFixed(0)} KiB`);
const dossier = JSON.parse(dossierOnDisk.toString('utf8'));
check('dossier text at most 65536 bytes', Buffer.byteLength(dossier.text) <= 65_536, `${Buffer.byteLength(dossier.text)} bytes`);

console.log(`\n${passes.length} passed, ${fails.length} failed.`);
if (fails.length > 0) {
  console.log('Failures:');
  for (const f of fails) console.log(` - ${f}`);
  process.exit(1);
}
