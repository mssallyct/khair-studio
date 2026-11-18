import { createHash } from "node:crypto";

// Supply an ordinary PostgreSQL pool from the chosen hosting environment.
// No database URL, key, password or driver is bundled into the public frontend.
export class PostgresRepository {
  constructor(pool){if(!pool?.query || !pool?.connect)throw new Error("PostgreSQL連線尚未設定。");this.pool=pool;}
  async read(){const r=await this.pool.query("SELECT document, revision FROM khair_private.business_state WHERE singleton = true");if(!r.rows[0])throw new Error("資料庫尚未初始化。");return {...r.rows[0].document,__revision:String(r.rows[0].revision)};}
  async transaction(fn){
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const r=await client.query("SELECT document FROM khair_private.business_state WHERE singleton = true FOR UPDATE");
      if(!r.rows[0])throw new Error("資料庫尚未初始化。");
      const data=structuredClone(r.rows[0].document),result=await fn(data);
      await client.query("UPDATE khair_private.business_state SET document = $1::jsonb, revision = revision + 1, updated_at = now() WHERE singleton = true",[JSON.stringify(data)]);
      await client.query("COMMIT");return result;
    }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
  }
  async accountByUsername(name){return (await this.pool.query("SELECT id, username, name, password_hash, active FROM khair_private.admin_accounts WHERE username = $1",[name])).rows[0] || null;}
  async accountById(id){return (await this.pool.query("SELECT id, username, name, active FROM khair_private.admin_accounts WHERE id = $1",[id])).rows[0] || null;}
  async putSession({tokenHash,accountId,expiresAt}){await this.pool.query("INSERT INTO khair_private.sessions(token_hash, account_id, expires_at) VALUES ($1,$2,$3)",[tokenHash,accountId,expiresAt]);}
  async sessionByHash(hash){return (await this.pool.query("SELECT account_id, expires_at, revoked_at FROM khair_private.sessions WHERE token_hash = $1",[hash])).rows[0] || null;}
  async removeSession(hash){await this.pool.query("DELETE FROM khair_private.sessions WHERE token_hash = $1",[hash]);}
  async attemptLogin(username,peer,now){
    const bucket=Math.floor(now.getTime()/900000);let allowed=true;
    for(const [type,value,limit] of [["peer",peer,30],["account",username,10]]){
      const key=createHash("sha256").update(`${type}:${String(value).slice(0,256)}`).digest("hex");
      const r=await this.pool.query("INSERT INTO khair_private.login_attempts(key, bucket, attempts) VALUES ($1,$2,1) ON CONFLICT (key,bucket) DO UPDATE SET attempts = khair_private.login_attempts.attempts + 1 RETURNING attempts",[key,bucket]);
      if(r.rows[0].attempts>limit)return false;
    }
    return allowed;
  }
}
