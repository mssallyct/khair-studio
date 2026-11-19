import test from 'node:test';
import assert from 'node:assert/strict';
import {expiryNoticeView} from '../js/reward-views.js';
import {createRewardWallet} from '../js/loyalty-v2.js';
test('到期通知包含剩餘印花或未用優惠，用盡則顯示零人而非消失',()=>{
  const at=new Date('2026-11-19T04:00:00Z'),m={id:'m',name:'測試到期',active:true,joined_date:'2025-11-29'},wallet=createRewardWallet(m,at);
  wallet.stampProgress=1;
  const before=JSON.stringify(wallet);
  assert.match(expiryNoticeView([m],{m:wallet},at,{showEmpty:true}),/10天後到期/);assert.equal(JSON.stringify(wallet),before);
  wallet.stampProgress=0;
  assert.match(expiryNoticeView([m],{m:wallet},at,{showEmpty:true}),/0 位會員/);
  wallet.coupons=[{id:'c',kind:'stamp4',rate:.1,expiresAt:'2026-11-29T00:00:00+08:00'}];
  assert.match(expiryNoticeView([m],{m:wallet},at,{showEmpty:true}),/1 位會員/);
  wallet.coupons[0].usedAt=at.toISOString();assert.match(expiryNoticeView([m],{m:wallet},at,{showEmpty:true}),/0 位會員/);
});
