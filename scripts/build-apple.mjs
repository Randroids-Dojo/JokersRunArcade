import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
// This directory contains only generated copies of dist, never source files.
rmSync('apple/Game', { recursive: true, force: true });
mkdirSync('apple/Game', { recursive: true });
cpSync('dist', 'apple/Game', { recursive: true });
const index = readFileSync('apple/Game/index.html', 'utf8');
const policy = "default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
writeFileSync('apple/Game/index.html', index.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`));
execFileSync('xcodegen', ['generate', '--spec', 'apple/project.yml'], { stdio: 'inherit' });
console.log('Open apple/JokersRun.xcodeproj. Organization signing is configured after Apple verifies Randroid LLC.');
