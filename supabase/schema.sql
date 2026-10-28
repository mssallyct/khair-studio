-- K.Hair Studio — Supabase schema
-- 在全新 Supabase project 的 SQL Editor 執行一次。

create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('member','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.appointment_status as enum ('pending','confirmed','completed','cancelled','no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.catalog_kind as enum ('service','product');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.stamp_type as enum ('spending','birthday','referral','redemption','admin_adjustment');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  phone text,
  birthday date,
  referral_code text not null unique default upper(substr(md5(random()::text),1,8)),
  role public.user_role not null default 'member',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stylists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind public.catalog_kind not null default 'service',
  price numeric(10,2) not null check (price >= 0),
  duration_minutes integer not null default 0 check (duration_minutes >= 0 and duration_minutes % 30 = 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id),
  stylist_id uuid not null references public.stylists(id),
  service_id uuid not null references public.catalog(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  status public.appointment_status not null default 'pending',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id),
  appointment_id uuid references public.appointments(id),
  subtotal numeric(10,2) not null check (subtotal >= 0),
  discount numeric(10,2) not null default 0 check (discount >= 0),
  final_amount numeric(10,2) not null check (final_amount >= 0),
  discount_label text not null default '沒有折扣',
  stamp_redeemed integer not null default 0 check (stamp_redeemed in (0,4,8)),
  completed_by uuid not null references public.profiles(id),
  completed_at timestamptz not null default now()
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  kind public.catalog_kind not null,
  name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0)
);

create table if not exists public.stamp_ledger (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id),
  delta integer not null check (delta <> 0),
  type public.stamp_type not null,
  reason text not null check (length(trim(reason)) > 0),
  sale_id uuid references public.sales(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id),
  referred_member_id uuid not null unique references public.profiles(id),
  awarded_at timestamptz,
  created_at timestamptz not null default now(),
  check (referrer_id <> referred_member_id)
);

create table if not exists public.blockouts (
  id uuid primary key default gen_random_uuid(),
  stylist_id uuid references public.stylists(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text not null,
  created_by uuid not null references public.profiles(id),
  check (end_at > start_at)
);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create index if not exists appointments_member_idx on public.appointments(member_id,start_at desc);
create index if not exists appointments_stylist_idx on public.appointments(stylist_id,start_at);
create index if not exists sales_member_idx on public.sales(member_id,completed_at desc);
create index if not exists stamp_ledger_member_idx on public.stamp_ledger(member_id,created_at desc);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin' and active); $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  entered_code text;
  new_referrer uuid;
begin
  insert into public.profiles(id,email,name,phone,birthday,role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1)),
    nullif(new.raw_user_meta_data->>'phone',''),
    nullif(new.raw_user_meta_data->>'birthday','')::date,
    case when lower(new.email) = 'mssallyct@gmail.com' then 'admin'::public.user_role else 'member'::public.user_role end
  );
  entered_code := upper(trim(coalesce(new.raw_user_meta_data->>'referral_code_entered','')));
  if entered_code <> '' then
    select id into new_referrer from public.profiles where referral_code = entered_code and id <> new.id;
    if new_referrer is not null then
      insert into public.referrals(referrer_id,referred_member_id) values(new_referrer,new.id) on conflict do nothing;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  new.updated_at := now();
  if not public.is_admin() then
    new.role := old.role; new.active := old.active; new.email := old.email; new.referral_code := old.referral_code;
  end if;
  return new;
end $$;

drop trigger if exists protect_profile_fields_trigger on public.profiles;
create trigger protect_profile_fields_trigger before update on public.profiles for each row execute function public.protect_profile_fields();

create or replace function public.validate_appointment()
returns trigger language plpgsql security definer set search_path = public
as $$
declare hk_start timestamp; hk_end timestamp;
begin
  hk_start := new.start_at at time zone 'Asia/Hong_Kong';
  hk_end := new.end_at at time zone 'Asia/Hong_Kong';
  if date(hk_start) <> date(hk_end) or hk_start::time < time '11:00' or hk_end::time > time '21:00' or extract(minute from hk_start)::int % 30 <> 0 then
    raise exception '預約必須在11:00至21:00內，以30分鐘為開始時段';
  end if;
  if new.status not in ('cancelled','no_show') and exists(
    select 1 from public.appointments a
    where a.stylist_id = new.stylist_id and a.id <> new.id and a.status not in ('cancelled','no_show')
      and new.start_at < a.end_at and new.end_at > a.start_at
  ) then raise exception '此髮型師在所選時段已有預約'; end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists validate_appointment_trigger on public.appointments;
create trigger validate_appointment_trigger before insert or update on public.appointments for each row execute function public.validate_appointment();

create or replace function public.protect_member_appointment_update()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  if not public.is_admin() then
    if old.member_id <> auth.uid() or new.status <> 'cancelled' or old.status not in ('pending','confirmed') then raise exception '會員只可取消自己的待確認或已確認預約'; end if;
    new.member_id:=old.member_id; new.stylist_id:=old.stylist_id; new.service_id:=old.service_id; new.start_at:=old.start_at; new.end_at:=old.end_at; new.note:=old.note;
  end if;
  return new;
end $$;

drop trigger if exists protect_member_appointment_update_trigger on public.appointments;
create trigger protect_member_appointment_update_trigger before update on public.appointments for each row execute function public.protect_member_appointment_update();

create or replace view public.member_stamp_balances with (security_invoker=on) as
select p.id as member_id, coalesce(sum(l.delta),0)::integer as balance
from public.profiles p left join public.stamp_ledger l on l.member_id=p.id
group by p.id;

create or replace function public.adjust_stamps(p_member_id uuid,p_delta integer,p_reason text)
returns public.stamp_ledger language plpgsql security definer set search_path = public
as $$
declare current_balance integer; result public.stamp_ledger;
begin
  if not public.is_admin() then raise exception '只有管理員可調整印花'; end if;
  if p_delta is null or p_delta = 0 then raise exception '印花調整必須為非零整數'; end if;
  if trim(coalesce(p_reason,'')) = '' then raise exception '必須填寫調整原因'; end if;
  select coalesce(sum(delta),0)::integer into current_balance from public.stamp_ledger where member_id=p_member_id;
  if current_balance + p_delta < 0 then raise exception '印花結餘不足'; end if;
  insert into public.stamp_ledger(member_id,delta,type,reason,created_by)
  values(p_member_id,p_delta,'admin_adjustment',trim(p_reason),auth.uid()) returning * into result;
  return result;
end $$;

create or replace function public.complete_sale(p_member_id uuid,p_appointment_id uuid,p_items jsonb,p_redeem_stamps integer default 0)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_subtotal numeric(10,2); v_product numeric(10,2); v_discount numeric(10,2); v_final numeric(10,2);
  v_balance integer; v_earned integer; v_label text; v_sale public.sales; v_item jsonb;
  v_profile public.profiles; v_year integer; v_ref public.referrals;
begin
  if not public.is_admin() then raise exception '只有管理員可完成消費'; end if;
  if p_redeem_stamps not in (0,4,8) then raise exception '印花兌換只可選0、4或8'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception '消費必須最少有一個項目'; end if;
  select * into v_profile from public.profiles where id=p_member_id and role='member' and active;
  if not found then raise exception '找不到有效會員'; end if;
  select coalesce(sum(delta),0)::integer into v_balance from public.stamp_ledger where member_id=p_member_id;
  if p_redeem_stamps > v_balance then raise exception '印花結餘不足'; end if;
  select round(coalesce(sum((x->>'quantity')::integer*(x->>'unit_price')::numeric),0),2),
         round(coalesce(sum(case when x->>'kind'='product' then (x->>'quantity')::integer*(x->>'unit_price')::numeric else 0 end),0),2)
  into v_subtotal,v_product from jsonb_array_elements(p_items) x;
  if v_subtotal <= 0 then raise exception '實收項目金額必須大於0'; end if;
  if p_redeem_stamps=8 then v_discount:=round(v_subtotal*.15,2);v_label:='8印花・全單85折';
  elsif p_redeem_stamps=4 then v_discount:=round(v_subtotal*.10,2);v_label:='4印花・全單9折';
  elsif v_product>0 then v_discount:=round(v_product*.05,2);v_label:='會員產品95折';
  else v_discount:=0;v_label:='沒有折扣'; end if;
  v_final:=round(v_subtotal-v_discount,2); v_earned:=floor(v_final/600)::integer;
  insert into public.sales(member_id,appointment_id,subtotal,discount,final_amount,discount_label,stamp_redeemed,completed_by)
  values(p_member_id,p_appointment_id,v_subtotal,v_discount,v_final,v_label,p_redeem_stamps,auth.uid()) returning * into v_sale;
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.sale_items(sale_id,kind,name,quantity,unit_price) values(v_sale.id,(v_item->>'kind')::public.catalog_kind,v_item->>'name',(v_item->>'quantity')::integer,(v_item->>'unit_price')::numeric);
  end loop;
  if p_redeem_stamps>0 then insert into public.stamp_ledger(member_id,delta,type,reason,sale_id,created_by) values(p_member_id,-p_redeem_stamps,'redemption',v_label,v_sale.id,auth.uid()); end if;
  if v_earned>0 then insert into public.stamp_ledger(member_id,delta,type,reason,sale_id,created_by) values(p_member_id,v_earned,'spending','消費 HK$'||trim(to_char(v_final,'999999990.00')),v_sale.id,auth.uid()); end if;
  v_year:=extract(year from now() at time zone 'Asia/Hong_Kong');
  if v_profile.birthday is not null and extract(month from v_profile.birthday)=extract(month from now() at time zone 'Asia/Hong_Kong') and not exists(select 1 from public.stamp_ledger where member_id=p_member_id and type='birthday' and extract(year from created_at at time zone 'Asia/Hong_Kong')=v_year) then
    insert into public.stamp_ledger(member_id,delta,type,reason,sale_id,created_by) values(p_member_id,1,'birthday',v_year||' 生日月份獎賞',v_sale.id,auth.uid());
  end if;
  select * into v_ref from public.referrals where referred_member_id=p_member_id and awarded_at is null for update;
  if found then update public.referrals set awarded_at=now() where id=v_ref.id; insert into public.stamp_ledger(member_id,delta,type,reason,sale_id,created_by) values(v_ref.referrer_id,1,'referral','成功介紹 '||v_profile.name,v_sale.id,auth.uid()); end if;
  if p_appointment_id is not null then update public.appointments set status='completed' where id=p_appointment_id and member_id=p_member_id; end if;
  select coalesce(sum(delta),0)::integer into v_balance from public.stamp_ledger where member_id=p_member_id;
  return jsonb_build_object('sale_id',v_sale.id,'subtotal',v_subtotal,'discount',v_discount,'final_amount',v_final,'discount_label',v_label,'redeemed_stamps',p_redeem_stamps,'earned_stamps',v_earned,'balance',v_balance);
end $$;

alter table public.profiles enable row level security;
alter table public.stylists enable row level security;
alter table public.catalog enable row level security;
alter table public.appointments enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.stamp_ledger enable row level security;
alter table public.referrals enable row level security;
alter table public.blockouts enable row level security;
alter table public.settings enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using(id=auth.uid() or public.is_admin()) with check(id=auth.uid() or public.is_admin());

drop policy if exists stylists_read on public.stylists;
create policy stylists_read on public.stylists for select to authenticated using(active or public.is_admin());
drop policy if exists stylists_admin on public.stylists;
create policy stylists_admin on public.stylists for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists catalog_read on public.catalog;
create policy catalog_read on public.catalog for select to authenticated using(active or public.is_admin());
drop policy if exists catalog_admin on public.catalog;
create policy catalog_admin on public.catalog for all to authenticated using(public.is_admin()) with check(public.is_admin());

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments for select to authenticated using(member_id=auth.uid() or public.is_admin());
drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments for insert to authenticated with check(member_id=auth.uid() or public.is_admin());
drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments for update to authenticated using(member_id=auth.uid() or public.is_admin()) with check(member_id=auth.uid() or public.is_admin());

drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales for select to authenticated using(member_id=auth.uid() or public.is_admin());
drop policy if exists sale_items_select on public.sale_items;
create policy sale_items_select on public.sale_items for select to authenticated using(exists(select 1 from public.sales s where s.id=sale_id and (s.member_id=auth.uid() or public.is_admin())));
drop policy if exists stamps_select on public.stamp_ledger;
create policy stamps_select on public.stamp_ledger for select to authenticated using(member_id=auth.uid() or public.is_admin());
drop policy if exists referrals_select on public.referrals;
create policy referrals_select on public.referrals for select to authenticated using(referrer_id=auth.uid() or referred_member_id=auth.uid() or public.is_admin());
drop policy if exists blockouts_read on public.blockouts;
create policy blockouts_read on public.blockouts for select to authenticated using(true);
drop policy if exists blockouts_admin on public.blockouts;
create policy blockouts_admin on public.blockouts for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using(true);
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for all to authenticated using(public.is_admin()) with check(public.is_admin());

grant select on public.member_stamp_balances to authenticated;
grant execute on function public.adjust_stamps(uuid,integer,text) to authenticated;
grant execute on function public.complete_sale(uuid,uuid,jsonb,integer) to authenticated;

insert into public.stylists(name) select x from unnest(array['Hair Stylist A','Hair Stylist B','Hair Stylist C']) x where not exists(select 1 from public.stylists);
insert into public.catalog(name,kind,price,duration_minutes,sort_order)
select * from (values
  ('洗剪吹','service'::public.catalog_kind,280,60,10),('單剪','service',180,30,20),('洗吹造型','service',180,60,30),
  ('染髮','service',780,120,40),('電髮','service',980,150,50),('頭髮護理','service',480,60,60),
  ('專業洗髮水','product',260,0,100)
) v(name,kind,price,duration_minutes,sort_order) where not exists(select 1 from public.catalog);

insert into public.settings(key,value) values
  ('business_hours','{"open":"11:00","close":"21:00","days":[1,2,3,4,5,6,0]}'::jsonb),
  ('stamp_rules','{"threshold":600,"four_stamp_discount":0.10,"eight_stamp_discount":0.15,"product_member_discount":0.05}'::jsonb)
on conflict(key) do nothing;
