import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const source = fileURLToPath(new URL('../../apps/model-editor/dist/', import.meta.url));
const target = fileURLToPath(new URL('../../apps/web/public/model-editor/', import.meta.url));
await readdir(source); // Fail before touching the current assets if the build is missing.
await mkdir(target, { recursive: true });
for (const name of await readdir(target)) await rm(`${target}/${name}`, { recursive: true, force: true });
await cp(source, target, { recursive: true });
console.log('Synced model editor assets');
