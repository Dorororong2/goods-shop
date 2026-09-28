-- ============================================================
-- 굿즈 판매 사이트 - 초기 데이터베이스 설계
-- ============================================================
-- 이 파일 하나를 Supabase SQL Editor에 붙여넣고 실행하면
-- 테이블 / 보안규칙 / 함수 / 샘플 상품이 한 번에 만들어집니다.
-- 여러 번 실행해도 안전하도록 작성했습니다.
-- ============================================================


-- ------------------------------------------------------------
-- 1. products : 판매할 굿즈 목록
-- ------------------------------------------------------------
create table if not exists public.products (
  id          bigint generated always as identity primary key,
  name        text        not null,
  description text        not null default '',
  price       integer     not null check (price >= 0),  -- 단위: 원
  emoji       text        not null default '🎁',        -- 이미지 대신 쓰는 아이콘
  color       text        not null default '#6366f1',   -- 상품 카드 배경색
  stock       integer     not null default 100 check (stock >= 0),
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);


-- ------------------------------------------------------------
-- 2. profiles : 회원 정보 (로그인 계정과 1:1로 짝지어짐)
-- ------------------------------------------------------------
-- Supabase는 로그인 계정을 auth.users 라는 내부 테이블에 보관합니다.
-- 그 테이블은 우리가 직접 수정할 수 없어서, 역할(role) 같은 추가 정보를
-- 담아둘 우리 소유의 테이블을 따로 만듭니다.
create table if not exists public.profiles (
  id         uuid        primary key references auth.users(id) on delete cascade,
  email      text        not null,
  role       text        not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);


-- ------------------------------------------------------------
-- 3. orders : 주문 / 결제 내역
-- ------------------------------------------------------------
-- user_id 가 auth.users 가 아니라 profiles 를 가리키는 이유:
-- 관리자 페이지에서 "주문 + 주문한 사람의 이메일"을 한 번에 조회하려면
-- 두 테이블 사이에 직접적인 연결고리(외래키)가 있어야 합니다.
-- profiles.id 자체가 auth.users.id 를 그대로 따라가므로 값은 동일합니다.
create table if not exists public.orders (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  order_code  text        not null unique,     -- 토스에 보내는 주문번호
  product_id  bigint      not null references public.products(id),
  product_name text       not null,            -- 주문 당시 상품명 (나중에 바뀌어도 기록 보존)
  quantity    integer     not null check (quantity > 0),
  amount      integer     not null check (amount >= 0),
  status      text        not null default 'PENDING'
                          check (status in ('PENDING', 'DONE', 'FAILED', 'CANCELED')),
  payment_key text,                            -- 토스가 발급하는 결제 식별자
  method      text,                            -- 카드 / 간편결제 등
  fail_reason text,
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  raw         jsonb                            -- 토스 응답 원본 (디버깅용)
);

create index if not exists orders_user_id_created_at_idx
  on public.orders (user_id, created_at desc);
create index if not exists orders_created_at_idx
  on public.orders (created_at desc);


-- ============================================================
-- 함수
-- ============================================================

-- ------------------------------------------------------------
-- is_admin() : 지금 로그인한 사람이 관리자인가?
-- ------------------------------------------------------------
-- security definer = "이 함수는 만든 사람(관리자) 권한으로 실행된다"
-- 덕분에 profiles 테이블의 보안규칙(RLS)을 건너뛰고 조회할 수 있습니다.
-- 이게 없으면 "profiles를 보려면 관리자여야 하는데, 관리자인지 알려면
-- profiles를 봐야 한다"는 무한 반복에 빠집니다.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;


-- ------------------------------------------------------------
-- handle_new_user() : 회원가입하면 profiles 행을 자동 생성
-- ------------------------------------------------------------
-- admin@admin.com 으로 가입하면 자동으로 관리자 권한을 부여합니다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case when new.email = 'admin@admin.com' then 'admin' else 'user' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ------------------------------------------------------------
-- create_order(product_id, quantity) : 주문 생성
-- ------------------------------------------------------------
-- ★ 이 프로젝트에서 가장 중요한 보안 장치입니다. ★
--
-- 브라우저는 "몇 번 상품을 몇 개" 만 보냅니다. 금액은 보내지 않습니다.
-- 가격은 이 함수가 products 테이블에서 직접 읽어서 계산합니다.
-- 그래서 사용자가 개발자도구로 금액을 100원으로 바꿔 보내도 소용이 없습니다.
create or replace function public.create_order(
  p_product_id bigint,
  p_quantity   integer
)
returns table (order_code text, amount integer, product_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid    := auth.uid();
  v_price      integer;
  v_name       text;
  v_stock      integer;
  v_amount     integer;
  v_order_code text;
begin
  if v_user_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 10 then
    raise exception '수량은 1개에서 10개 사이여야 합니다.';
  end if;

  select p.price, p.name, p.stock
    into v_price, v_name, v_stock
    from public.products p
   where p.id = p_product_id and p.is_active = true;

  if not found then
    raise exception '판매 중인 상품이 아닙니다.';
  end if;

  if v_stock < p_quantity then
    raise exception '재고가 부족합니다. (남은 수량: %)', v_stock;
  end if;

  v_amount := v_price * p_quantity;

  -- 주문번호: 토스 규격(6~64자)에 맞는 고유 문자열
  v_order_code := 'ORD-' || to_char(now(), 'YYYYMMDDHH24MISS')
                         || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  insert into public.orders (user_id, order_code, product_id, product_name, quantity, amount)
  values (v_user_id, v_order_code, p_product_id, v_name, p_quantity, v_amount);

  return query select v_order_code, v_amount, v_name;
end;
$$;


-- ============================================================
-- 보안 규칙 (RLS - Row Level Security)
-- ============================================================
-- "누가 어떤 행을 볼 수 있는가"를 데이터베이스가 직접 강제합니다.
-- 브라우저 JS를 아무리 조작해도 이 규칙은 뚫리지 않습니다.

alter table public.products enable row level security;
alter table public.profiles enable row level security;
alter table public.orders   enable row level security;

-- products : 로그인하지 않아도 누구나 볼 수 있음 (상품은 공개돼야 하니까)
drop policy if exists "상품은 누구나 조회 가능" on public.products;
create policy "상품은 누구나 조회 가능"
  on public.products for select
  using (is_active = true);

-- profiles : 본인 것만. 관리자는 전체
drop policy if exists "본인 프로필 조회" on public.profiles;
create policy "본인 프로필 조회"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

-- orders : 본인 주문만. 관리자는 전체 (← 관리자 페이지의 핵심)
drop policy if exists "본인 주문 조회" on public.orders;
create policy "본인 주문 조회"
  on public.orders for select
  using (user_id = auth.uid() or public.is_admin());

-- 주문 생성/수정은 브라우저에서 직접 못 합니다.
-- 생성은 create_order() 함수가, 결제 승인 후 수정은 Edge Function이 담당합니다.
-- (INSERT / UPDATE / DELETE 정책을 아예 만들지 않으면 전부 차단됩니다.)


-- ============================================================
-- 샘플 상품 넣기
-- ============================================================
insert into public.products (name, description, price, emoji, color)
select * from (values
  ('로고 머그컵',      '매일 쓰는 320ml 세라믹 머그컵',        12000, '☕', '#f59e0b'),
  ('코딩 티셔츠',      '순면 100%, 오버핏 반팔 티셔츠',        24000, '👕', '#3b82f6'),
  ('스티커 팩',        '노트북에 붙이는 방수 스티커 12종',      6000, '✨', '#ec4899'),
  ('에코백',           '두꺼운 캔버스 원단 숄더 에코백',        18000, '👜', '#10b981'),
  ('키캡 세트',        '기계식 키보드용 PBT 키캡 4개',         32000, '⌨️', '#8b5cf6'),
  ('후드집업',         '기모 안감 데일리 후드집업',            58000, '🧥', '#ef4444')
) as v(name, description, price, emoji, color)
where not exists (select 1 from public.products);
