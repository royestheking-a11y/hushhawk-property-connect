// Vercel build: bundles the Worker code and the drizzle/ migrations into api/_worker.mjs,
// which api/index.mjs runs as a Node function. Static files are served from dist/.
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {workerSource} from './worker-source.mjs';

const migrations=[];
for(const file of (await readdir('drizzle')).filter(name=>name.endsWith('.sql')).sort())
  migrations.push({tag:file,sql:(await readFile('drizzle/'+file,'utf8')).replaceAll('--> statement-breakpoint','')});
await writeFile('api/_worker.mjs','const assets={};\n'+await workerSource('.')+'\nexport const migrations='+JSON.stringify(migrations)+';\n');
console.log(`Bundled worker with ${migrations.length} migrations into api/_worker.mjs`);
