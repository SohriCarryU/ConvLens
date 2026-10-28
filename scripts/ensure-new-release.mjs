import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function ensureNewRelease({ repository, tag, version, token, request = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Invalid repository');
  if (tag !== `v${version}`) throw new Error('Tag and package version differ');
  if (!token) throw new Error('GITHUB_TOKEN is required');
  const result = await request(`https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (result.status === 404) return;
  if (result.ok) throw new Error(`Release ${tag} already exists; refusing to modify it`);
  throw new Error(`Cannot check existing release (HTTP ${result.status}); refusing to publish`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  await ensureNewRelease({ repository: process.env.GITHUB_REPOSITORY, tag: process.env.GITHUB_REF_NAME,
    version, token: process.env.GITHUB_TOKEN });
}
