import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const root=process.cwd();
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
const refs=[...app.matchAll(/\$\("([^"]+)"\)/g)].map(m=>m[1]);
const missing=[...new Set(refs.filter(id=>!ids.has(id)))];
if(missing.length) throw new Error(`Frontend references missing HTML IDs: ${missing.join(', ')}`);

for(const file of ['public/delivery.html']){
  const text=fs.readFileSync(path.join(root,file),'utf8');
  const scripts=[...text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  for(let i=0;i<scripts.length;i++){
    const f=path.join(os.tmpdir(),`rp-static-${i}.js`);
    fs.writeFileSync(f,scripts[i]);
    const check=spawnSync(process.execPath,['--check',f],{encoding:'utf8'});
    if(check.status!==0) throw new Error(`${file}: embedded JS syntax failed\n${check.stderr}`);
  }
}

const forbidden=['BlobNotFound','TODO_PRODUCTION','FAKE_SALE'];
for(const term of forbidden){
  for(const file of ['public/index.html','public/app.js','src/server.mjs']){
    const text=fs.readFileSync(path.join(root,file),'utf8');
    if(text.includes(term)) throw new Error(`${file}: forbidden marker ${term}`);
  }
}
console.log(`Static QA passed. ${ids.size} HTML ids verified, ${refs.length} frontend references checked.`);
