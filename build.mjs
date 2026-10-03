import { readFile, writeFile, mkdir, copyFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const files = ['index.html','companion.mjs','sync.mjs','platform.mjs','fox-web.glb','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png'];
const copied = new Set();
await rm('dist', { recursive: true, force: true });
await rm('vendor', { recursive: true, force: true });
async function moduleFile(relative) {
  if(copied.has(relative)) return;
  copied.add(relative);
  const source = path.join('node_modules/three',relative), target = path.join('vendor/three',relative);
  await mkdir(path.dirname(target),{recursive:true}); await copyFile(source,target);
  if(!relative.endsWith('.js')) return;
  const code = await readFile(source,'utf8');
  for(const match of code.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
    if(match[1].startsWith('.')) await moduleFile(path.normalize(path.join(path.dirname(relative),match[1])));
  }
}
await moduleFile('build/three.module.js');
for (const file of ['loaders/GLTFLoader.js','loaders/DRACOLoader.js','controls/OrbitControls.js','environments/RoomEnvironment.js']) await moduleFile('examples/jsm/'+file);
for(const file of ['draco_wasm_wrapper.js','draco_decoder.wasm','draco_decoder.js']) await moduleFile('examples/jsm/libs/draco/gltf/'+file);
await mkdir('vendor/three',{recursive:true}); await copyFile('node_modules/three/LICENSE','vendor/three/LICENSE');
async function tree(dir) { const out=[]; for(const entry of await readdir(dir,{withFileTypes:true})) { const file=path.join(dir,entry.name); if(entry.isDirectory()) out.push(...await tree(file)); else out.push(file); } return out; }
files.push(...await tree('vendor'));
const hash = createHash('sha256');
for(const file of [...files,'sw.js']) hash.update(await readFile(file));
const assets = `self.FOXKIN_CACHE='foxkin-${hash.digest('hex').slice(0,12)}';\nself.FOXKIN_ASSETS=${JSON.stringify(['/',...files.map(f=>'/'+f)])};\n`;
await writeFile('offline-assets.js',assets);
for(const file of [...files,'offline-assets.js','sw.js','_headers','_routes.json']) { await mkdir(path.dirname('dist/'+file),{recursive:true}); await copyFile(file,'dist/'+file); }
console.log(`Built ${files.length} offline assets into dist; source preview also ready.`);
