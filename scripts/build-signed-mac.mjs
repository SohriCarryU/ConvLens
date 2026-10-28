import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { requireEnv, signingConfig } from './desktop-signing.cjs';

if (process.platform !== 'darwin' || process.env.CONVLENS_SIGNING_MODE !== 'signed') {
  throw new Error('This helper requires signed mode on macOS');
}
const arch = process.argv[2];
if (!['x64', 'arm64'].includes(arch)) throw new Error('Expected x64 or arm64');
requireEnv(process.env, ['MAC_NOTARY_KEY_BASE64']);
const key = Buffer.from(process.env.MAC_NOTARY_KEY_BASE64, 'base64').toString('utf8');
if (!key.startsWith('-----BEGIN PRIVATE KEY-----')) throw new Error('Invalid notarization API key encoding');
const directory = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'convlens-notary-'));
try {
  const keyPath = join(directory, 'AuthKey.p8');
  writeFileSync(keyPath, key, { mode: 0o600 });
  const env = { ...process.env, APPLE_API_KEY: keyPath };
  delete env.MAC_NOTARY_KEY_BASE64;
  signingConfig(env, 'darwin');
  const result = spawnSync('npm', ['run', 'desktop:dist', '--', '--publish', 'never', '--mac', `--${arch}`], {
    stdio: 'inherit', env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Signed macOS build failed (${result.status ?? result.signal})`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
