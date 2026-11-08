import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist-samsung');
const out = join(root, 'release-artifacts/samsung');
mkdirSync(out, { recursive: true });
if (!existsSync(join(dist, 'index.html'))) throw new Error('Run npm run build:samsung first.');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

// A dependency-free PNG of the game's red diamond, used by the installed TV launcher.
function icon() {
  const crc = buffer => {
    let c = 0xffffffff;
    for (const b of buffer) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (name, data) => {
    const type = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(128); header.writeUInt32BE(128, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc(128 * (128 * 3 + 1));
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const inside = Math.abs(x - 63.5) / 43 + Math.abs(y - 63.5) / 53 < 1;
    const i = y * 385 + 1 + x * 3;
    rows.set(inside ? [192, 40, 45] : [5, 8, 12], i);
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

copyFileSync(join(root, 'tv/config.xml'), join(dist, 'config.xml'));
writeFileSync(join(dist, 'icon.png'), icon());
let html = readFileSync(join(dist, 'index.html'), 'utf8');
html = html.replace(/\s*<link[^>]+rel="(?:manifest|apple-touch-icon)"[^>]*>/g, '')
  .replace(/<link rel="icon"[^>]*>/, '<link rel="icon" href="./icon.png" />');
// webapis.js is supplied by the TV platform. It is not a network dependency.
if (!html.includes('$WEBAPIS/webapis/webapis.js')) html = html.replace('</head>', '    <script src="$WEBAPIS/webapis/webapis.js"></script>\n  </head>');
writeFileSync(join(dist, 'index.html'), html);
const policy = readFileSync(join(root, 'tv/privacy-content.html'), 'utf8');
writeFileSync(join(dist, 'privacy.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Joker's Run privacy policy</title><style>body{max-width:900px;margin:48px auto;padding:24px;font:22px/1.6 sans-serif;background:#05080c;color:#f5f2ea}</style>${policy}</html>`);

function files(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const relative = prefix + item.name;
    return item.isDirectory() ? files(join(dir, item.name), relative + '/') : [relative];
  }).sort();
}

const inputs = files(dist);
const manifest = inputs.map(name => {
  const data = readFileSync(join(dist, name));
  return { path: name, size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
});
writeFileSync(join(out, 'content-manifest.json'), JSON.stringify({ version: '1.0.0', target: 'Samsung TV / Tizen 8.0+ (2024-2026)', files: manifest }, null, 2) + '\n');

if (process.argv.includes('--sign')) {
  const profile = process.env.SAMSUNG_CERT_PROFILE;
  if (!profile) throw new Error('SAMSUNG_CERT_PROFILE must name an existing Samsung author/distributor signing profile. No self-signed fallback is permitted.');
  const cli = process.env.TIZEN_CLI ?? 'tizen';
  run(cli, ['package', '-t', 'wgt', '-s', profile, '-o', out, '--', dist]);
  const packages = readdirSync(out).filter(name => name.endsWith('.wgt') && !name.includes('unsigned'));
  if (packages.length !== 1) throw new Error('Expected exactly one signed WGT. Inspect the output directory.');
  const artifact = join(out, packages[0]);
  writeFileSync(join(out, 'signed-package.json'), JSON.stringify({ path: artifact, size: readFileSync(artifact).length, sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex'), profile, samsungCertificateValidation: 'Required in Seller Office; local packaging alone does not establish store acceptance.' }, null, 2) + '\n');
  console.log(`Signed package: ${artifact}`);
} else {
  // Unsigned is explicit in the filename and receipt. This is not an uploadable release.
  const artifact = join(out, 'JokersRun-1.0.0.unsigned.wgt');
  if (existsSync(artifact)) run('zip', ['-q', '-FS', artifact, ...inputs], { cwd: dist });
  else run('zip', ['-q', artifact, ...inputs], { cwd: dist });
  writeFileSync(join(out, 'package-status.json'), JSON.stringify({ path: artifact, signed: false, installable: false, uploadReady: false, sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex'), blocker: 'Samsung-issued author and distributor certificates are required.' }, null, 2) + '\n');
  console.log(`Unsigned package (requires Samsung signing): ${artifact}`);
}
