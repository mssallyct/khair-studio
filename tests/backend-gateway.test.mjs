import test from "node:test";
import assert from "node:assert/strict";
import { createGateway } from "../server/gateway.mjs";
import { createRewardWallet } from "../js/loyalty-v2.js";
import { hashPassword, verifyPassword, newSessionToken, tokenDigest } from "../server/credentials.mjs";
const now=new Date("2026-11-19T04:00:00Z"),origin="https://mssallyct.github.io";
const actor=username=>({id:`admin-${username}`,username,name:username,role:"admin",active:true});
function fixture(){
  const member={id:"m1",role:"member",name:"會員A",phone:"9123 4567",active:true,joined_date:"2026-01-01",created_at:"2025-01-01T00:00:00Z"};
  return {profiles:[member],catalog:[{id:"color",name:"染髮",price:600,kind:"service",active:true}],stylists:[{id:"sty-a",name:"髮型師",active:true}],assistants:[],sales:[],saleItems:[],stampLedger:[],referrals:[],appointments:[{id:"apt1",member_id:"m1",start_at:now.toISOString(),status:"pending",note:"聯絡 91234567"}],auditLog:[{id:"old",summary:"舊電話 9234 5678",created_at:now.toISOString()}],rewardWallets:{m1:createRewardWallet(member,now)}};
}
function harness(username="howood"){
  let data=fixture();let reads=0,writes=0;let queue=Promise.resolve();
  const repository={read:async()=>{reads++;return structuredClone(data);},transaction:fn=>{
    const job=queue.then(async()=>{const next=structuredClone(data);const result=await fn(next);data=next;writes++;return result;});queue=job.catch(()=>{});return job;
  }};
  const handler=createGateway({repository,authenticate:async request=>request.headers.get("authorization")==="Bearer test-session" ? actor(username) : null,allowedOrigins:[origin],clock:()=>now});
  const call=(path,body,options={})=>handler(new Request(`https://backend.test/api${path}`,{method:body?"POST":"GET",headers:{Origin:origin,Authorization:"Bearer test-session",...options.headers},...(body?{body:JSON.stringify(body)}:{})}));
  return {call,data:()=>data,counts:()=>({reads,writes}),replace:value=>data=value};
}

test('backend stores month-only and full birthdays without inventing or rewriting old dates',async()=>{
  const h=harness(),before=JSON.stringify(h.data().profiles[0]);
  for(const [birthday,phone] of [['11','21234567'],['02-29','21234568'],[null,'21234569']]){
    const response=await h.call('/members',{name:'月份測試',phone,birthday,joinedDate:'2026-11-01'});
    assert.equal(response.status,200);assert.equal(h.data().profiles.at(-1).birthday,birthday);
  }
  assert.equal(JSON.stringify(h.data().profiles[0]),before);
  const count=h.data().profiles.length;
  assert.equal((await h.call('/members',{name:'invalid',phone:'21234560',birthday:'13',joinedDate:'2026-11-01'})).status,400);
  assert.equal(h.data().profiles.length,count);
});

test('所有管理員可按電話搜尋，只有Howood的結果包含電話；搜尋不更改資料',async()=>{
  for(const name of ['howood','sally','admin135','admin268','admin567','admin889','admin233']){
    const h=harness(name),before=JSON.stringify(h.data());
    const response=await h.call('/members/search',{query:'+852 9123 4567'});assert.equal(response.status,200);
    const rows=await response.json();assert.equal(rows.length,1);assert.equal(rows[0].id,'m1');
    assert.equal(Object.hasOwn(rows[0],'phone'),name==='howood');
    assert.deepEqual(await (await h.call('/members/search',{query:'91'})).json(),[]);
    assert.equal((await h.call('/members/search',{query:'91234567'},{headers:{Authorization:''}})).status,401);
    assert.equal(JSON.stringify(h.data()),before);assert.equal(h.counts().writes,0);
  }
});

test("缺少後端設定一律503、不退回本機資料；無登入401、未授權來源403",async()=>{
  const offline=createGateway();assert.equal((await offline(new Request("https://backend.test/api/members"))).status,503);
  const h=harness();assert.equal((await h.call("/members",null,{headers:{Authorization:""}})).status,401);
  assert.equal((await h.call("/members",null,{headers:{Origin:"https://evil.test"}})).status,403);
  assert.deepEqual(h.counts(),{reads:0,writes:0});
});

test("Sally API及匯出無電話；Howood可見；新管理員直呼敏感API亦被拒",async()=>{
  for(const username of ["sally","howood","admin135","admin268","admin567","admin889","admin233"]){
    const h=harness(username);const result=await h.call("/members");assert.equal(result.status,200);
    const text=await result.text();assert.equal(text.includes("9123"),username==="howood");
    if(username.startsWith("admin")){
      for(const route of ["/settings","/audit","/export"])assert.equal((await h.call(route)).status,403);
      const home=await (await h.call("/home")).json();assert.deepEqual(Object.keys(home),["pending","today"]);assert.ok(!JSON.stringify(home).includes("9123"));
      assert.equal((await h.call("/members/joined-date",{memberId:"m1",joinedDate:"2026-02-01",username:"howood",role:"admin"})).status,403);
    }else{
      const exportText=await (await h.call("/export")).text();assert.equal(exportText.includes("9123"),username==="howood");assert.equal(exportText.includes("9234"),username==="howood");
    }
  }
});

test("伺服器按正式項目重算價格、記實際操作者、重複提交只收一次",async()=>{
  const h=harness("admin135"),body={requestId:"checkout-request-001",memberId:"m1",stylistId:"sty-a",adminId:"admin-howood",items:[{catalogId:"color",quantity:1,unitPrice:1,name:"單剪",reward_group:"hair_visit"}]};
  const results=await Promise.all([h.call("/sales",body),h.call("/sales",body)]);
  for(const response of results){assert.equal(response.status,200);const json=await response.json();assert.equal(json.receipt.finalAmount,600);assert.equal(json.receipt.earnedStamps,1);}
  assert.equal(h.data().sales.length,1);assert.equal(h.data().saleItems[0].unit_price,600);assert.equal(h.data().auditLog.at(-1).actor_username,"admin135");
  assert.equal(h.data().rewardWallets.m1.stampProgress,1);
  const before=JSON.stringify(h.data());assert.equal((await h.call("/sales",{...body,items:[{catalogId:"color",quantity:2}]})).status,409);assert.equal(JSON.stringify(h.data()),before);
});

test("過期／錯誤優惠或未核對會員，整宗交易不寫入；舊交易逐字保留",async()=>{
  const h=harness();h.data().sales.push({id:"old",member_id:"m1",subtotal:280,final_amount:252,completed_at:"2020-01-01T00:00:00Z"});
  const body={requestId:"checkout-request-002",memberId:"m1",stylistId:"sty-a",items:[{catalogId:"color",quantity:1}]};
  const before=JSON.stringify(h.data());assert.equal((await h.call("/sales",{...body,couponId:"missing"})).status,400);assert.equal(JSON.stringify(h.data()),before);
  delete h.data().rewardWallets.m1;const unreviewed=JSON.stringify(h.data());assert.equal((await h.call("/sales",body)).status,409);assert.equal(JSON.stringify(h.data()),unreviewed);
});

test("入會日期獨立於建立時間；改期不更改原消費及原印花",async()=>{
  const h=harness();const created=h.data().profiles[0].created_at,stamps=JSON.stringify(h.data().stampLedger);
  const response=await h.call("/members/joined-date",{memberId:"m1",joinedDate:"2026-02-01"});assert.equal(response.status,200);
  assert.equal(h.data().profiles[0].created_at,created);assert.equal(h.data().profiles[0].joined_date,"2026-02-01");assert.equal(JSON.stringify(h.data().stampLedger),stamps);
  const before=JSON.stringify(h.data());assert.equal((await h.call("/members/joined-date",{memberId:"m1",joinedDate:"2026-02-30"})).status,400);assert.equal(JSON.stringify(h.data()),before);
});

test("設定寫入只能由兩個主管操作，伺服器直接呼叫亦受限並記錄操作者",async()=>{
  for(const name of ["howood","sally","admin135","admin268","admin567","admin889","admin233"]){
    const h=harness(name),before=JSON.stringify(h.data());
    const response=await h.call("/actions/createCatalogItem",{args:[{name:"新項目",kind:"service",price:400,durationMinutes:60,adminId:"howood"}]});
    if(["howood","sally"].includes(name)){assert.equal(response.status,200);assert.equal(h.data().auditLog.at(-1).actor_username,name);}else{assert.equal(response.status,403);assert.equal(JSON.stringify(h.data()),before);}
  }
});

test("生日獎賞及介紹獎賞只由合資格服務觸發，一次性且不疊加重試",async()=>{
  const h=harness();h.data().profiles[0].birthday="11-01";
  h.data().profiles.push({id:"referrer",role:"member",name:"介紹人",active:true,joined_date:"2026-01-01"});
  h.data().rewardWallets.referrer=createRewardWallet(h.data().profiles[1],now);
  h.data().referrals.push({id:"r1",referrer_id:"referrer",referred_member_id:"m1",awarded_at:null});
  const body={requestId:"bonus-checkout-001",memberId:"m1",stylistId:"sty-a",items:[{catalogId:"color",quantity:1}]};
  const first=await(await h.call("/sales",body)).json();assert.equal(first.receipt.bonusStamps,1);assert.equal(h.data().rewardWallets.referrer.stampProgress,1);
  await h.call("/sales",body);assert.equal(h.data().stampLedger.filter(s=>s.type==="birthday").length,1);assert.equal(h.data().stampLedger.filter(s=>s.type==="referral").length,1);
  const second=await(await h.call("/sales",{...body,requestId:"bonus-checkout-002"})).json();assert.equal(second.receipt.bonusStamps,0);assert.equal(h.data().rewardWallets.referrer.stampProgress,1);
});

test("售價變動拒絕結帳，未知提交結果不聲稱未寫入",async()=>{
  const h=harness(),before=JSON.stringify(h.data());
  const body={requestId:"mismatch-checkout-1",memberId:"m1",stylistId:"sty-a",items:[{catalogId:"color",quantity:1}],expectedFinalAmount:1};
  assert.equal((await h.call("/sales",body)).status,409);assert.equal(JSON.stringify(h.data()),before);
  const handler=createGateway({repository:{read:async()=>{throw new Error("database unreachable");},transaction:async()=>{}},authenticate:async()=>actor("howood")});
  const response=await handler(new Request("https://backend.test/api/members"));assert.equal(response.status,500);assert.match((await response.json()).error,/未能確認操作結果/);
});

test("後端密碼雜湊有隨機鹽、不保存明文；驗證及256位隨機session",async()=>{
  const sample="synthetic-test-only";
  const first=await hashPassword(sample),second=await hashPassword(sample);
  assert.notEqual(first,second);assert.ok(!first.includes(sample));
  assert.equal(await verifyPassword(sample,first),true);assert.equal(await verifyPassword("wrong",first),false);
  assert.equal(await verifyPassword(sample,"broken"),false);
  const a=newSessionToken(),b=newSessionToken();assert.notEqual(a,b);assert.equal(a.length,43);assert.equal(tokenDigest(a).length,64);assert.notEqual(tokenDigest(a),a);
});
