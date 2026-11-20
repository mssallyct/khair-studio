import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { databaseOptions } from "../server/runtime.mjs";

export function migrationEnabled(env){
  return env.VERCEL_ENV==="production" && env.KHAIR_BACKEND_ENABLED==="true";
}
export async function migrateAdminPolicy(env=process.env){
  if(!migrationEnabled(env)){console.log("Admin policy migration skipped outside enabled production.");return;}
  const url=env.DATABASE_URL || env.POSTGRES_URL;
  if(!url)throw new Error("Production database not configured.");
  const pool=new Pool({...databaseOptions(url,env.DATABASE_SSL_CA),max:1});
  try{
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout='10s'");
      await client.query("SELECT pg_advisory_xact_lock(19761120,882363)");
      await client.query(await readFile(new URL("../server/admin-policy-migration.sql",import.meta.url),"utf8"));
      await client.query("COMMIT");
      console.log("ADMIN_POLICY_OK: dynamic usernames enabled; existing records preserved.");
    }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
  }catch{throw new Error("Admin policy migration failed; deployment stopped. No connection details logged.");}
  finally{await pool.end();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)migrateAdminPolicy().catch(error=>{console.error(error.message);process.exitCode=1;});
