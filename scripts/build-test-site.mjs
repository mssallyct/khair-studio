// Build only public test data, and preserve the pinned legacy app at the root.
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,dirname} from 'node:path';
const root=process.cwd(),dist=join(root,'dist'),test=join(dist,'test'),ref=process.env.KHAIR_STABLE_REF||'2469ba7';
const files=execFileSync('git',['ls-tree','-r','--name-only',ref],{encoding:'utf8'}).trim().split('\n').filter(p=>/^(index.html|styles.css|config.example.js|manifest.webmanifest|sw.js)$/.test(p)||/^(assets|js)\//.test(p));
await mkdir(test,{recursive:true});
for(const p of ['index.html','styles.css','manifest.webmanifest','assets','js'])await cp(join(root,p),join(test,p),{recursive:true});
await writeFile(join(test,'config.js'),'window.KHAIR_CONFIG = {testingMode:true};\n');
let html=await readFile(join(test,'index.html'),'utf8');
await writeFile(join(test,'index.html'),html.replace('<title>K.Hair Studio</title>','<title>K.Hair Studio・功能測試版</title>').replace(/  <link rel="manifest"[^>]+>\n/,''));
await mkdir(join(test,'server'),{recursive:true});
let gateway=await readFile(join(root,'server/gateway.mjs'),'utf8');
// Public role-picker sandbox must never bundle credential code or accept passwords.
gateway=gateway.replace('import { newAdmin } from "./admin-management.mjs";',`function newAdmin(){throw new Error('測試版不可管理正式帳戶。');}`);
gateway=gateway.replace('import { importMemberRows } from "./member-import.mjs";',`function importMemberRows(){throw new Error('測試版不可匯入真實會員。');}`);
gateway=gateway.replace('import { handleMemberCleanup } from "./member-cleanup.mjs";',`function handleMemberCleanup(){throw new Error('測試版不可清理正式會員。');}`);
gateway=gateway.replace('import { randomUUID, createHash } from "node:crypto";',`const randomUUID=()=>crypto.randomUUID();\nasync function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}`);
const before=gateway;
gateway=gateway.replace(/createHash\("sha256"\)\.update\((JSON\.stringify\(\[body\.memberId[^\n]+?\]\))\)\.digest\("hex"\)/,'await digest($1)');
gateway=gateway.replace(/createHash\("sha256"\)\.update\((JSON\.stringify\(\{actor:[^\n]+?\}\))\)\.digest\("hex"\)/,'await digest($1)');
if(gateway===before||gateway.includes('node:')||gateway.includes('createHash'))throw new Error('Sandbox gateway conversion failed');
await writeFile(join(test,'server/gateway.mjs'),gateway);
const migration=await readFile(join(root,'server/migration.mjs'),'utf8');
await writeFile(join(test,'server/migration.mjs'),`import {createRewardWallet,membershipYear} from '../js/loyalty-v2.js';\nexport function prepareLegacyImport(){throw new Error('測試版禁止匯入真實資料');}\n${migration.slice(migration.indexOf('export function reviewedOpening'))}`);
for(const p of files){await mkdir(dirname(join(dist,p)),{recursive:true});await writeFile(join(dist,p),execFileSync('git',['show',`${ref}:${p}`]));}
await cp(join(dist,'config.example.js'),join(dist,'config.js'));
const original=await readFile(join(dist,'index.html'),'utf8');
await writeFile(join(dist,'index.html'),original.replace('<body>','<body>\n  <aside style="padding:12px;background:#e2f1ed;text-align:center"><a href="./test/">開啟新版功能測試（獨立示例資料，不影響原有紀錄）</a></aside>'));
await cp(join(root,'sw.js'),join(dist,'sw.js'));
console.log('Stable v19 at /; isolated v20 sandbox at /test/.');
