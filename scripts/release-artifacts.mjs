import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signingMode } from './desktop-signing.cjs';

export const targets = ['win-x64', 'mac-x64', 'mac-arm64'];

export function packageNames(version, target) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid release version');
  if (!targets.includes(target)) throw new Error('Invalid release target');
  return target === 'win-x64'
    ? [`ConvLens-${version}-Setup-x64.exe`, `ConvLens-${version}-Portable-x64.exe`]
    : [`ConvLens-${version}-${target}.dmg`, `ConvLens-${version}-${target}.zip`];
}

export async function fileHash(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size === 0) throw new Error(`Expected nonempty regular file: ${path}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function checkPackageSet(directory, expected) {
  const actual = (await readdir(directory)).filter(name => /\.(exe|dmg|zip)$/i.test(name)).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(`Unexpected package set: ${actual.join(', ')}`);
  }
}

export async function collect(directory, version, target, mode) {
  signingMode({ CONVLENS_SIGNING_MODE: mode });
  const names = packageNames(version, target);
  await checkPackageSet(directory, names);
  const files = [];
  for (const name of names) files.push({ name, sha256: await fileHash(join(directory, name)) });
  const report = { version, target, mode, files };
  await writeFile(join(directory, `security-${target}.json`), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export async function combine(directory, version, mode) {
  signingMode({ CONVLENS_SIGNING_MODE: mode });
  const expected = targets.flatMap(target => packageNames(version, target));
  await checkPackageSet(directory, expected);
  const reports = [];
  for (const target of targets) {
    const report = JSON.parse(await readFile(join(directory, `security-${target}.json`), 'utf8'));
    if (report.version !== version || report.target !== target || report.mode !== mode) {
      throw new Error(`Inconsistent security report: ${target}`);
    }
    const names = packageNames(version, target);
    if (!Array.isArray(report.files) || report.files.length !== names.length ||
        new Set(report.files.map(file => file.name)).size !== names.length) throw new Error(`Invalid file report: ${target}`);
    for (const file of report.files) {
      if (!names.includes(file.name) || file.sha256 !== await fileHash(join(directory, file.name))) {
        throw new Error(`Package hash mismatch: ${file.name}`);
      }
    }
    reports.push(report);
  }
  const files = reports.flatMap(report => report.files).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  await writeFile(join(directory, 'SHA256SUMS.txt'), files.map(file => `${file.sha256}  ${file.name}\n`).join(''));
  await verifyChecksums(directory, version);
  const status = mode === 'signed'
    ? 'CI 已验证 Windows Authenticode 签名、发布者与时间戳；已验证两个 macOS 架构的 Developer ID 签名、Hardened Runtime、Gatekeeper 及应用内附加的公证票据（包括从 DMG / ZIP 解出的应用）。'
    : '本次构建未使用开发者证书签名，也未经过 Apple 公证；首次运行可能被系统拦截或显示安全提示。';
  await writeFile(join(directory, 'SECURITY-VERIFICATION.json'), `${JSON.stringify({ version, mode, reports }, null, 2)}\n`);
  const notes = (await readFile(new URL('../docs/release-notes.md', import.meta.url), 'utf8')).replaceAll('<版本>', version);
  await writeFile(join(directory, 'release-notes.md'), `## 桌面应用安全状态\n\n${status}\n\nSHA256SUMS.txt 用于核对下载完整性；它本身不能证明发布者身份。\n\n${notes}`);
}

export async function verifyChecksums(directory, version) {
  const expected = targets.flatMap(target => packageNames(version, target)).sort();
  await checkPackageSet(directory, expected);
  const text = await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8');
  const lines = text.trimEnd().split('\n');
  const names = [];
  for (const line of lines) {
    const match = /^([a-f\d]{64})  (ConvLens-[A-Za-z\d.-]+)$/.exec(line);
    if (!match || !expected.includes(match[2])) throw new Error('Invalid checksum entry');
    const [, hash, name] = match;
    if (names.includes(name) || await fileHash(join(directory, name)) !== hash) throw new Error(`Checksum mismatch: ${name}`);
    names.push(name);
  }
  if (JSON.stringify(names.sort()) !== JSON.stringify(expected)) throw new Error('Incomplete checksums');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, directory = 'release', target] = process.argv.slice(2);
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const mode = signingMode();
  if (command === 'collect') await collect(directory, version, target, mode);
  else if (command === 'combine') await combine(directory, version, mode);
  else if (command === 'verify') await verifyChecksums(directory, version);
  else throw new Error('Expected collect, combine or verify');
}
