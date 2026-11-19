// PUBLIC functional sandbox, not authentication. Never enter real customer data.
import { BackendApi } from './backend-api.js';
import { ACCOUNT_NAMES } from './access-policy.js';
import { buildServiceCatalog } from './service-catalog.js';
import { createRewardWallet } from './loyalty-v2.js';
import { hongKongDateKey, toHongKongIso } from './rules.js';
export const TEST_KEY='khair-acceptance-v20-only';
export function sampleData(now=new Date()){
  const today=hongKongDateKey(now),near=new Date(`${today}T00:00:00Z`);near.setUTCDate(near.getUTCDate()+10);near.setUTCFullYear(near.getUTCFullYear()-1);
  const profiles=ACCOUNT_NAMES.map(username=>({id:`admin-${username}`,username,name:username,role:'admin',active:true}));
  const data={profiles,catalog:buildServiceCatalog([],{createdAt:now.toISOString()}),stylists:[{id:'test-stylist',name:'測試髮型師',active:true}],assistants:[{id:'test-assistant',name:'測試助理',active:true}],appointments:[],sales:[],saleItems:[],stampLedger:[],referrals:[],auditLog:[],rewardWallets:{},checkoutRequests:{},__revision:0};
  data.catalog.push({id:'test-product',name:'測試產品',kind:'product',price:200,active:true,duration_minutes:0});
  ['剪吹已9次','印花已3個','印花已7個・10天內到期'].forEach((name,i)=>{
    const member={id:`test-member-${i}`,name:`測試會員・${name}`,phone:`9000000${i+1}`,birthday:'01-01',role:'member',active:true,joined_date:i===2?near.toISOString().slice(0,10):today,created_at:now.toISOString()};
    profiles.push(member);const wallet=createRewardWallet(member,now);wallet.hairVisits=i===0?9:0;wallet.stampProgress=[0,3,7][i];data.rewardWallets[member.id]=wallet;
  });
  data.appointments.push({id:'test-booking',member_id:'test-member-0',stylist_id:'test-stylist',service_id:data.catalog[0].id,start_at:toHongKongIso(today,'11:00'),end_at:toHongKongIso(today,'12:00'),status:'pending',note:'純測試預約'});
  return data;
}
export async function createTestingApi({storage=globalThis.localStorage,clock=()=>new Date()}={}){
  const {createGateway}=await import('../server/gateway.mjs');
  let raw=storage.getItem(TEST_KEY),data=raw===null?sampleData(clock()):JSON.parse(raw),principal=null,queue=Promise.resolve();
  if(!Array.isArray(data.profiles)||!data.rewardWallets)throw new Error('測試資料格式錯誤，原有資料未有讀寫。');
  const repository={read:async()=>structuredClone(data),transaction(fn){const task=queue.then(async()=>{
    if(storage.getItem(TEST_KEY)!==raw)throw new Error('另一測試分頁已更新，請重新整理。');
    const next=structuredClone(data),result=await fn(next);next.__revision=Number(next.__revision||0)+1;
    const nextRaw=JSON.stringify(next);storage.setItem(TEST_KEY,nextRaw);raw=nextRaw;data=next;return result;
  });queue=task.catch(()=>{});return task;}};
  const gateway=createGateway({repository,clock,authenticate:async()=>principal});
  const api=new BackendApi({backendUrl:'https://sandbox.invalid/api'});api.testingMode=true;
  api.request=async(path,{method='GET',body}={})=>{
    if(path.startsWith('/migration'))throw new Error('測試版禁止匯入真實資料。');
    const response=await gateway(new Request(`https://sandbox.invalid/api${path}`,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
    const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
  };
  api.signIn=async username=>{const name=String(username).toLowerCase();if(!ACCOUNT_NAMES.includes(name))throw new Error('請選擇測試角色。');principal=data.profiles.find(p=>p.username===name);api.profile=principal;api.token='TEST-ONLY';return {user:{id:principal.id}};};
  api.signOut=async()=>{principal=null;api.profile=null;api.token=null;};
  return api;
}
