import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { signingConfig, signingMode } from '../scripts/desktop-signing.cjs';
import { targets, packageNames, collect, combine, verifyChecksums } from '../scripts/release-artifacts.mjs';
import { ensureNewRelease } from '../scripts/ensure-new-release.mjs';

const require = createRequire(import.meta.url);
const { validateConfiguration } = require('app-builder-lib/out/util/config/config.js');
const { build } = require('../package.json');
const version = '1.2.3';
const winEnv = { CONVLENS_SIGNING_MODE: 'signed', WIN_CSC_LINK: 'private-certificate-data',
  WIN_CSC_KEY_PASSWORD: 'private-password', WIN_CERT_SHA1: 'A'.repeat(40) };
const macEnv = { CONVLENS_SIGNING_MODE: 'signed', CSC_LINK: 'private-certificate-data', CSC_KEY_PASSWORD: 'private-password',
  APPLE_API_KEY: '/temporary/AuthKey.p8', APPLE_API_KEY_ID: 'key-id', APPLE_API_ISSUER: 'issuer-id', APPLE_TEAM_ID: 'ABCDE12345' };
const azureEnv = { CONVLENS_SIGNING_MODE: 'signed', WINDOWS_SIGNING_PROVIDER: 'azure', AZURE_TENANT_ID: 'tenant',
  AZURE_CLIENT_ID: 'client', AZURE_CLIENT_SECRET: 'private-client-secret', AZURE_SIGNING_ENDPOINT: 'https://example.codesigning.azure.net/',
  AZURE_SIGNING_ACCOUNT: 'account', AZURE_SIGNING_PROFILE: 'profile', WIN_PUBLISHER_NAME: 'Publisher' };

test('unsigned default explicitly disables signing; unknown modes fail', () => {
  const config = signingConfig({}, 'darwin');
  assert.equal(config.mac.identity, null);
  assert.equal(config.mac.notarize, false);
  assert.equal(config.mac.hardenedRuntime, false);
  assert.equal(config.win.signExecutable, false);
  assert.equal(config.forceCodeSigning, false);
  assert.throws(() => signingMode({ CONVLENS_SIGNING_MODE: 'singed' }), /must be/);
});

test('signed mode fails for every missing required credential without printing values', () => {
  for (const [env, platform] of [[winEnv, 'win32'], [macEnv, 'darwin'], [azureEnv, 'win32']]) {
    for (const name of Object.keys(env).filter(name => !['CONVLENS_SIGNING_MODE', 'WINDOWS_SIGNING_PROVIDER'].includes(name))) {
      assert.throws(() => signingConfig({ ...env, [name]: '' }, platform), error => {
        assert.match(error.message, new RegExp(name));
        assert.doesNotMatch(error.message, /private-certificate-data|private-password|private-client-secret/);
        return true;
      });
    }
  }
  assert.throws(() => signingConfig({ CONVLENS_SIGNING_MODE: 'signed' }, 'linux'), /host/);
  assert.throws(() => signingConfig({ ...winEnv, WINDOWS_SIGNING_PROVIDER: 'typo' }, 'win32'), /provider/i);
  assert.throws(() => signingConfig({ ...winEnv, WIN_CERT_SHA1: 'bad' }, 'win32'), /thumbprint/);
  assert.throws(() => signingConfig({ ...macEnv, APPLE_TEAM_ID: 'bad' }, 'darwin'), /Team ID/);
  assert.throws(() => signingConfig({ ...macEnv, APPLE_ID: 'conflicting-auth' }, 'darwin'), /only API key/);
});

test('Windows signing uses SHA256 timestamps and never serializes private credentials', () => {
  const pfx = signingConfig(winEnv, 'win32');
  assert.equal(pfx.forceCodeSigning, true);
  assert.deepEqual(pfx.win.signtoolOptions.signingHashAlgorithms, ['sha256']);
  assert.ok(pfx.win.signtoolOptions.rfc3161TimeStampServer);
  const azure = signingConfig(azureEnv, 'win32');
  assert.equal(azure.win.azureSignOptions.publisherName, 'Publisher');
  assert.equal(azure.win.azureSignOptions.timestampDigest, 'SHA256');
  for (const config of [pfx, azure, signingConfig(macEnv, 'darwin')]) {
    assert.doesNotMatch(JSON.stringify(config), /private-certificate-data|private-password|private-client-secret/);
  }
});

test('all supported signing configurations pass the locked electron-builder schema', async () => {
  for (const [env, platform] of [[{}, 'win32'], [{}, 'darwin'], [winEnv, 'win32'], [macEnv, 'darwin'], [azureEnv, 'win32']]) {
    const signing = signingConfig(env, platform);
    const config = { ...build, ...signing, win: { ...build.win, ...signing.win }, mac: { ...build.mac, ...signing.mac } };
    await validateConfiguration(config);
    assert.equal(config.nsis.artifactName, 'ConvLens-${version}-Setup-${arch}.${ext}');
    assert.equal(config.portable.artifactName, 'ConvLens-${version}-Portable-${arch}.${ext}');
    assert.equal(config.mac.artifactName, 'ConvLens-${version}-mac-${arch}.${ext}');
  }
});

async function fixture(t, mode = 'unsigned') {
  const root = await mkdtemp(join(tmpdir(), 'convlens-release-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'merged');
  await mkdir(directory);
  for (const target of targets) {
    const platformDir = join(root, target);
    await mkdir(platformDir);
    const names = packageNames(version, target);
    for (const name of names) await writeFile(join(platformDir, name), `fixture for ${name}`);
    await collect(platformDir, version, target, mode);
    for (const name of [...names, `security-${target}.json`]) await copyFile(join(platformDir, name), join(directory, name));
  }
  return directory;
}

test('six platform packages produce deterministic checksums and accurate unsigned notes', async t => {
  const directory = await fixture(t);
  await combine(directory, version, 'unsigned');
  await verifyChecksums(directory, version);
  const checksums = await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8');
  assert.equal(checksums.trim().split('\n').length, 6);
  const notes = await readFile(join(directory, 'release-notes.md'), 'utf8');
  assert.match(notes, /未使用开发者证书签名/);
  assert.doesNotMatch(notes, /CI 已验证|<版本>/);
  assert.ok(notes.includes(`ConvLens-${version}-Setup-x64.exe`));
  await combine(directory, version, 'unsigned');
  assert.equal(await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8'), checksums);
});

test('signed reports cannot be mixed with unsigned reports', async t => {
  const directory = await fixture(t);
  await assert.rejects(combine(directory, version, 'signed'), /Inconsistent/);
  await assert.rejects(combine(directory, '9.9.9', 'unsigned'), /package set/);
});

test('signed notes describe CI checks only for a complete signed report set', async t => {
  const directory = await fixture(t, 'signed');
  await combine(directory, version, 'signed');
  assert.match(await readFile(join(directory, 'release-notes.md'), 'utf8'), /CI 已验证/);
});

test('missing, empty, extra or renamed packages block release', async t => {
  const directory = await fixture(t);
  const first = join(directory, packageNames(version, 'win-x64')[0]);
  await writeFile(join(directory, 'stale.exe'), 'stale');
  await assert.rejects(combine(directory, version, 'unsigned'), /package set/);
  await rm(join(directory, 'stale.exe'));
  await writeFile(first, '');
  await assert.rejects(combine(directory, version, 'unsigned'), /nonempty/);
  await rm(first);
  await assert.rejects(combine(directory, version, 'unsigned'), /package set/);
});

test('tampering after platform verification or checksum creation blocks release', async t => {
  const directory = await fixture(t);
  await combine(directory, version, 'unsigned');
  await writeFile(join(directory, packageNames(version, 'mac-arm64')[0]), 'tampered');
  await assert.rejects(combine(directory, version, 'unsigned'), /hash mismatch/);
  await assert.rejects(verifyChecksums(directory, version), /Checksum mismatch/);
});

test('duplicate reports, checksum traversal and incomplete checksums are rejected', async t => {
  const directory = await fixture(t);
  await combine(directory, version, 'unsigned');
  const reportPath = join(directory, 'security-win-x64.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  report.files[1] = report.files[0];
  await writeFile(reportPath, JSON.stringify(report));
  await assert.rejects(combine(directory, version, 'unsigned'), /Invalid file report/);
  const sums = await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8');
  await writeFile(join(directory, 'SHA256SUMS.txt'), sums.split('\n').slice(1).join('\n'));
  await assert.rejects(verifyChecksums(directory, version), /Incomplete/);
  await writeFile(join(directory, 'SHA256SUMS.txt'), `${'0'.repeat(64)}  ../outside.exe\n`);
  await assert.rejects(verifyChecksums(directory, version), /Invalid checksum entry/);
});

test('symbolic links cannot stand in for packages', { skip: process.platform === 'win32' }, async t => {
  const directory = await fixture(t);
  const first = join(directory, packageNames(version, 'win-x64')[0]);
  await rm(first);
  await symlink(join(directory, packageNames(version, 'win-x64')[1]), first);
  await assert.rejects(combine(directory, version, 'unsigned'), /regular file/);
});

test('release guard refuses existing releases, mismatched tags and API failures', async () => {
  const args = { repository: 'SohriCarryU/ConvLens', tag: 'v1.2.3', version, token: 'test-token' };
  await ensureNewRelease({ ...args, request: async () => ({ status: 404, ok: false }) });
  await assert.rejects(ensureNewRelease({ ...args, request: async () => ({ status: 200, ok: true }) }), /already exists/);
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(ensureNewRelease({ ...args, request: async () => ({ status, ok: false }) }), /refusing to publish/);
  }
  await assert.rejects(ensureNewRelease({ ...args, tag: 'v0.1.2' }), /differ/);
  await assert.rejects(ensureNewRelease({ ...args, token: '' }), /required/);
  await assert.rejects(ensureNewRelease({ ...args, request: async () => { throw new Error('offline'); } }), /offline/);
});

test('native verification scripts parse on their target operating systems', () => {
  if (process.platform !== 'win32') execFileSync('bash', ['-n', 'scripts/verify-mac-signatures.sh']);
  if (process.platform === 'darwin') execFileSync('plutil', ['-lint', 'build/entitlements.mac.plist']);
  if (process.platform === 'win32') {
    execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
      "$e=$null; $t=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path scripts/verify-windows-signatures.ps1), [ref]$t, [ref]$e) > $null; if ($e.Count) { throw $e }"]);
  }
});
