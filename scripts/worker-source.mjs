// Builds the Worker module source: shared workspace logic from dist/ (rules, scheduling)
// followed by the worker files, concatenated into one module.
import {readFile} from 'node:fs/promises';
const shared=['dist/model.js','dist/workspace.js'];
const files=['live-sms.js','accounts.js','platform.js','billing.js','store.js','jobs.js','email.js','ai.js','trust.js','index.js'];
export const workerFiles=[...shared,...files.map(name=>'worker/'+name)];
export async function workerSource(root='.'){
  const parts=[];
  for(const file of shared){
    const text=await readFile(`${root}/${file}`,'utf8');
    parts.push(`// ---- ${file}\n`+text.replace(/^import .*$/gm,'').replace(/^export (const|function|async function|let) /gm,'$1 '));
  }
  for(const name of files)parts.push(`// ---- worker/${name}\n`+await readFile(`${root}/worker/${name}`,'utf8'));
  return parts.join('\n');
}
