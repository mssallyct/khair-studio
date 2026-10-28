# K.Hair Studio 會員及電子印花 App

香港 K.Hair Studio 使用的手機優先私人管理 PWA。只有獲授權管理員可以登入；會員由管理員建立，不設會員自行註冊。**不使用 Google Form**。

## 已實作功能

- 管理員新增及搜尋會員（香港 8 位電話格式）
- 管理員處理服務、髮型師、日期及時間預約
- 預約狀態：待確認、已確認、已完成、已取消、沒有出席
- 消費、消費明細及電子印花帳簿
- 每張單實收每滿 HK$600 得 1 印花；不足部分不累積
- 4 個印花兌換全單 9 折；8 個印花兌換全單 85 折
- 未使用印花優惠時，髮型產品享會員 95 折
- 生日月份消費每年額外 1 印花
- 成功介紹朋友並完成首次消費，介紹人獲 1 印花
- 管理員手動加減印花須填原因，並記錄操作人及時間
- 一鍵匯出完整 Excel（會員、預約、消費、印花、介紹記錄、服務及髮型師等工作表）
- PWA 安裝、基本離線殼及手機／桌面響應式介面
- 香港中文、港幣 HKD、Asia/Hong_Kong 時區

## 技術

- 無框架 HTML／CSS／ES Modules，方便 GitHub Pages 發佈
- Supabase Auth、PostgreSQL、管理員專用 Row Level Security 及 RPC
- 未連接 Supabase 時自動使用 Demo Mode，方便先驗收介面
- Node 內置測試；不需要第三方 build dependency

## 本機使用

```bash
npm test
npm run build
npm run serve
```

開啟 `http://127.0.0.1:4173/`。

Demo Mode 登入：

- 管理員：`mssallyct@gmail.com`
- 密碼欄可輸入任何內容（只限 Demo Mode）

## 連接中央資料庫

1. 在 Supabase 建立專案。
2. 在 SQL Editor 執行 `supabase/schema.sql`。
3. 在 Auth → Users 由後台建立 `mssallyct@gmail.com`；資料庫會自動把此電郵設為管理員。
4. 在 Auth 設定關閉新用戶註冊及匿名登入。
5. 複製 `config.example.js` 為 `config.js`，填入 Project URL 及 public anon key，並把 `demoMode` 改為 `false`。

`config.js` 已加入 `.gitignore`，請勿把真實環境設定或任何 service-role key 上傳 GitHub。

## 發佈

Repository 已包括 GitHub Pages workflow。推送至 `main` 後，於 GitHub Settings → Pages 將 Source 設為 **GitHub Actions**。
