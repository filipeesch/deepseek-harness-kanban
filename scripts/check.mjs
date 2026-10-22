import { execFileSync } from 'node:child_process';
for(const args of [['node_modules/typescript/bin/tsc','-p','tsconfig.host.json','--noEmit'],['node_modules/typescript/bin/tsc','-p','tsconfig.client.json','--noEmit'],['node_modules/vitest/vitest.mjs','run'],['scripts/build.mjs']])execFileSync(process.execPath,args,{stdio:'inherit'});
