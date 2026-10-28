import {readFile,writeFile} from 'node:fs/promises';
import {generateSQLiteDrizzleJson} from 'drizzle-kit/api';
import * as schema from '../db/schema.ts';
const previous=JSON.parse(await readFile('drizzle/meta/0006_snapshot.json','utf8'));
await writeFile('drizzle/meta/0007_snapshot.json',JSON.stringify(await generateSQLiteDrizzleJson(schema,previous.id),null,2)+'\n');
const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));
if(!journal.entries.some(e=>e.tag==='0007_community_recovery'))journal.entries.push({idx:7,version:'6',when:Date.now(),tag:'0007_community_recovery',breakpoints:true});
await writeFile('drizzle/meta/_journal.json',JSON.stringify(journal,null,2)+'\n');
