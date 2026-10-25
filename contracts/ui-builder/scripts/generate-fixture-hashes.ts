import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalSha256 } from '../src/canonical-json';

const packageRoot = resolve(__dirname, '..');
const fixtureDirectory = resolve(packageRoot, 'fixtures');
const fixtureNames = [
  'combat-hud.json',
  'exploration-hud.json',
  'inventory-menu.json',
  'boss-overlay.json',
  'vr-wrist-ui.json',
] as const;

async function main(): Promise<void> {
  const hashes: Record<string, string> = {};
  for (const fixtureName of fixtureNames) {
    const raw = await readFile(resolve(fixtureDirectory, fixtureName), 'utf8');
    hashes[fixtureName] = canonicalSha256(JSON.parse(raw) as unknown);
  }
  await writeFile(
    resolve(fixtureDirectory, 'canonical-hashes.json'),
    `${JSON.stringify(hashes, null, 2)}\n`,
    'utf8',
  );
}

void main();
