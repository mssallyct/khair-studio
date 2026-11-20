// Trusted, commit-pinned deployment task. No HTTP provisioning endpoint.
// Credentials are supplied as a temporary Production Secret and never printed.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { ACCOUNT_NAMES } from '../js/access-policy.js';
import { databaseOptions } from '../server/runtime.mjs';
import { initializeBusinessState, provisionAdmin } from '../server/setup.mjs';
import { verifyPassword } from '../server/credentials.mjs';
import { PostgresRepository } from '../server/postgres-repository.mjs';
import { createAuth } from '../server/auth.mjs';
import { createGateway } from '../server/gateway.mjs';

export function provisioningInput(env) {
  if(!env.KHAIR_BOOTSTRAP_PASSWORDS)return null;
  if(env.VERCEL_ENV!=='production' || !/^[a-f0-9]{40}$/.test(env.KHAIR_BOOTSTRAP_COMMIT || '') || env.KHAIR_BOOTSTRAP_COMMIT!==env.VERCEL_GIT_COMMIT_SHA)throw new Error('Provisioning requires the approved production commit.');
  const accounts=JSON.parse(env.KHAIR_BOOTSTRAP_PASSWORDS);
  if(!accounts || Array.isArray(accounts) || Object.keys(accounts).sort().join(',')!==[...ACCOUNT_NAMES].sort().join(','))throw new Error('Exactly seven approved accounts are required.');
  for(const password of Object.values(accounts))if(typeof password!=='string' || password.length<8 || Buffer.byteLength(password)>256)throw new Error('Invalid account input.');
  const url=env.DATABASE_URL || env.POSTGRES_URL;
  if(!url || !env.KHAIR_ALLOWED_ORIGINS)throw new Error('Production database/origins missing.');
  const origins=env.KHAIR_ALLOWED_ORIGINS.split(',').map(s=>s.trim());
  if(origins.some(s=>new URL(s).protocol!=='https:' || new URL(s).origin!==s))throw new Error('Invalid origin.');
  return {accounts,url,origins};
}

export async function provision(env=process.env) {
  const input=provisioningInput(env);if(!input){console.log('No one-time provisioning requested.');return;}
  const pool=new Pool({...databaseOptions(input.url,env.DATABASE_SSL_CA),max:1});
  let phase='connect';
  try {
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(19761120, 882363)");
      phase='schema';
      const schema=await readFile(new URL('../server/schema.sql',import.meta.url),'utf8');
      await client.query(schema.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));
      phase='accounts';
      for(const username of ACCOUNT_NAMES){
        const existing=(await client.query('SELECT password_hash,active FROM khair_private.admin_accounts WHERE username=$1',[username])).rows[0];
        if(existing){if(!existing.active || !await verifyPassword(input.accounts[username],existing.password_hash))throw new Error('Existing account differs; no overwrite.');}
        else await provisionAdmin(client,{username,password:input.accounts[username]});
      }
      phase='business-state';
      await initializeBusinessState(client);
      // Populate only a newly initialized member-free state; never reset records.
      const row=(await client.query('SELECT document FROM khair_private.business_state WHERE singleton=true FOR UPDATE')).rows[0];
      const data=row.document;
      if(!data.profiles.length && !data.sales.length && !data.appointments.length){
        data.profiles=(await client.query('SELECT id,username,name,active FROM khair_private.admin_accounts ORDER BY username')).rows.map(a=>({...a,role:'admin'}));
        data.auditLog.push({id:'production-initialized',actor_id:'system-setup',actor_username:'system-setup',action:'system.initialized',summary:'建立正式系統及七個管理員；未匯入測試或舊會員資料',created_at:new Date().toISOString()});
        await client.query('UPDATE khair_private.business_state SET document=$1::jsonb WHERE singleton=true',[JSON.stringify(data)]);
      }
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
    phase='login-and-permissions';
    const repository=new PostgresRepository(pool),auth=createAuth({repository}),gateway=createGateway({repository,auth,allowedOrigins:input.origins});
    for(const username of ACCOUNT_NAMES){
      const login=await auth.login(new Request('https://verification.invalid/api/login'),{username,password:input.accounts[username]});
      const headers={Authorization:`Bearer ${login.accessToken}`};
      try{
        const owner=['howood','sally'].includes(username);
        for(const [path,expected] of [['/members',200],['/settings',owner?200:403],['/audit',owner?200:403],['/export',owner?200:403]]){
          const r=await gateway(new Request(`https://verification.invalid/api${path}`,{headers}));if(r.status!==expected)throw new Error('Permission verification failed.');
        }
        const home=await (await gateway(new Request('https://verification.invalid/api/home',{headers}))).json();
        if(!owner && ('revenue' in home || 'expiry' in home))throw new Error('Staff home scope failed.');
      }finally{await auth.logout(new Request('https://verification.invalid/api/logout',{headers}));}
    }
    console.log('PROVISION_OK: seven logins, role restrictions and persistent database verified; no customer/test data imported.');
  }catch(error){
    // Driver messages can contain connection details: output only bounded codes.
    const code=/^[A-Z0-9_]{2,50}$/.test(error.code||'')?error.code:'FAILED';
    throw new Error(`Production setup stopped at ${phase} (${code}); no secret details logged.`);
  }finally{await pool.end();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)provision().catch(error=>{console.error(error.message);process.exitCode=1;});
