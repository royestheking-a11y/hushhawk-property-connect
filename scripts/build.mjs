import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import {workerSource} from './worker-source.mjs';
const types={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',png:'image/png',webmanifest:'application/manifest+json'};
const assets={};
for(const name of await readdir('dist')){
  const type=types[name.split('.').at(-1)];
  if(type)assets[name]={type,body:(await readFile('dist/'+name)).toString('base64')};
}
await mkdir('dist/server',{recursive:true});
await writeFile('dist/server/index.js','const assets='+JSON.stringify(assets)+';\n'+await workerSource());
