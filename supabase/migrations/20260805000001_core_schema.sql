-- Phase 1 코어 스키마 — 테넌트 / 모듈 개통 / 상품 / 재고 / 예약
--
-- 근거: docs/03 §2·§3, docs/08 §6.3
-- 불변식: INV-1(원자적 차감) · INV-2(멱등키) · INV-3(가격 스냅샷) · INV-5(RLS 격리)
--         INV-7(상태 전이) · INV-8(로컬 시각) · INV-10(정수 금액)
--
-- 이 파일의 규칙: 테넌트 테이블은 생성과 동시에 RLS 를 켜고 정책까지 작성한다.
-- 나중에 켜기로 미루면 그 사이에 만들어진 코드가 격리 없이 동작한다.

-- ─────────────────────────────────────────────────────────────
-- 확장
-- ─────────────────────────────────────────────────────────────
create extension if not exists pgcrypto; -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────
-- 공통 헬퍼
-- ─────────────────────────────────────────────────────────────

-- 요청자의 테넌트 ID. 서버가 통제하는 app_metadata 에서만 읽는다.
-- user_metadata 는 클라이언트가 수정할 수 있어 격리 근거로 쓸 수 없다 (INV-5).
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id',
    ''
  )::uuid
$$;

-- 마스터 콘솔 역할 여부 (docs/08 §1). 플랫폼 운영자는 테넌트 경계를 넘어 조회한다.
create or replace function public.is_master()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role'
      like 'MASTER\_%',
    false
  )
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 테넌트 / 모듈 개통 (docs/08 §6.3)
-- ─────────────────────────────────────────────────────────────

create type tenant_status as enum ('PENDING_REVIEW', 'APPROVED', 'SUSPENDED', 'REJECTED');

create table tenant (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  legal_name        text,
  business_reg_no   text,
  status            tenant_status not null default 'PENDING_REVIEW',
  -- INV-10: 통화는 코드로만 보관하고 금액은 정수 minor unit 으로 따로 저장한다
  default_currency  char(3) not null default 'KRW',
  -- INV-8: 시설 기준 타임존. 슬롯 시각 해석의 기준점이다
  timezone          text not null default 'Asia/Seoul',
  contact_email     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 모듈 카탈로그는 플랫폼 공용 데이터다 (테넌트 소유가 아님).
create table module_catalog (
  code        text primary key,
  category    text not null,
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

-- INV-6: 개통 상태의 단일 진실 원천. 서버 가드가 이 테이블을 본다.
create table tenant_entitlement (
  tenant_id   uuid not null references tenant (id) on delete cascade,
  module_code text not null references module_catalog (code),
  enabled     boolean not null default true,
  granted_at  timestamptz not null default now(),
  primary key (tenant_id, module_code)
);

-- ─────────────────────────────────────────────────────────────
-- 상품 (docs/03 §2.2)
-- ─────────────────────────────────────────────────────────────

create type product_category as enum ('C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8');
create type availability_type as enum ('START_TIME', 'OPENING_HOURS', 'FREESALE');
create type confirmation_type as enum ('INSTANT', 'ON_REQUEST');
create type product_status as enum ('DRAFT', 'IN_REVIEW', 'ACTIVE', 'PAUSED', 'ARCHIVED');

create table product (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant (id) on delete cascade,
  category          product_category not null,
  title             text not null,
  -- INV-8: 상품 운영 타임존(목적지 기준). 컷오프·리딤 판정이 여기에 걸린다
  timezone          text not null,
  availability_type availability_type not null,
  confirmation_type confirmation_type not null default 'INSTANT',
  status            product_status not null default 'DRAFT',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table product_option (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant (id) on delete cascade,
  product_id     uuid not null references product (id) on delete cascade,
  title          text not null,
  -- 이용 시작 N분 전 판매 마감 (docs/03 §2.2)
  cutoff_minutes integer not null default 0 check (cutoff_minutes >= 0),
  min_units      integer check (min_units is null or min_units > 0),
  max_units      integer check (max_units is null or max_units > 0),
  status         text not null default 'ACTIVE',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint option_units_range check (
    min_units is null or max_units is null or min_units <= max_units
  )
);

create type unit_type as enum (
  'ADULT', 'CHILD', 'YOUTH', 'INFANT', 'SENIOR', 'STUDENT', 'GROUP', 'OTHER'
);
create type sale_unit_type as enum ('PERSON', 'GROUP', 'VEHICLE', 'ROOM', 'DAY', 'PIECE');

create table unit (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant (id) on delete cascade,
  option_id      uuid not null references product_option (id) on delete cascade,
  type           unit_type not null,
  sale_unit_type sale_unit_type not null default 'PERSON',
  -- 그룹·차량 단위가 점유하는 인원 수 (docs/03 §2.2)
  pax_count      integer not null default 1 check (pax_count > 0),
  age_from       integer,
  age_to         integer,
  created_at     timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 가격 룰 (docs/07 §9 — 우선순위 해석은 packages/domain 이 담당)
-- ─────────────────────────────────────────────────────────────

create type price_scope as enum (
  'SPECIFIC_DATE', 'TIME_BAND', 'CHANNEL_DOW', 'DOW', 'SEASON', 'BASE'
);

create table price_rule (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant (id) on delete cascade,
  unit_id       uuid not null references unit (id) on delete cascade,
  scope         price_scope not null,
  channel_id    uuid,
  -- INV-8: 로컬 날짜 그대로 비교한다. timestamptz 로 바꾸면 시즌 경계가 흔들린다
  date_from     date,
  date_to       date,
  days_of_week  smallint[],
  time_from     time,
  time_to       time,
  tier_min      integer,
  tier_max      integer,
  -- INV-10: 금액은 정수 minor unit. numeric/float 금지
  retail_amount integer not null check (retail_amount >= 0),
  net_amount    integer check (net_amount >= 0),
  currency      char(3) not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint price_rule_date_range check (date_from is null or date_to is null or date_from <= date_to),
  constraint price_rule_tier_range check (tier_min is null or tier_max is null or tier_min <= tier_max)
);

-- ─────────────────────────────────────────────────────────────
-- 재고 슬롯 (docs/03 §2.3) — 재고의 단일 진실 원천
-- ─────────────────────────────────────────────────────────────

create type slot_status as enum ('OPEN', 'CLOSED', 'SOLD_OUT');

create table availability_slot (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenant (id) on delete cascade,
  option_id        uuid not null references product_option (id) on delete cascade,
  -- INV-8: 시설 로컬 날짜·시각. UTC 로 변환해 저장하지 않는다
  local_date       date not null,
  local_start_time time,
  -- INV-1: NULL = 무제한(FREESALE). 0 과 다르다 — 혼동하면 무한재고가 매진된다
  capacity         integer check (capacity is null or capacity >= 0),
  booked_count     integer not null default 0 check (booked_count >= 0),
  held_count       integer not null default 0 check (held_count >= 0),
  status           slot_status not null default 'OPEN',
  version          integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- 오버부킹은 조건부 UPDATE 로 막지만, 어떤 경로로도 초과 상태가 남지 않도록
  -- DB 제약으로 한 번 더 잠근다. 무제한 슬롯은 검사 대상이 아니다.
  constraint slot_not_oversold check (
    capacity is null or booked_count + held_count <= capacity
  ),
  -- 같은 옵션·같은 일시에 슬롯이 둘이면 재고가 갈라진다.
  -- local_start_time 이 NULL 인 일자형 슬롯도 하루 1개만 존재해야 한다.
  constraint slot_unique_per_option unique nulls not distinct (option_id, local_date, local_start_time)
);

-- ─────────────────────────────────────────────────────────────
-- 예약 (docs/03 §2.4)
-- ─────────────────────────────────────────────────────────────

create type booking_status as enum (
  'ON_HOLD', 'PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'REDEEMED', 'NO_SHOW'
);
create type actor_type as enum ('USER', 'CHANNEL_API', 'SYSTEM_BATCH');

create table booking (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant (id) on delete cascade,
  booking_no        text not null,
  product_id        uuid not null references product (id),
  option_id         uuid not null references product_option (id),
  -- 오픈데이트형(FREESALE)은 슬롯이 없다
  slot_id           uuid references availability_slot (id),
  channel_id        uuid,
  channel_booking_ref text,
  -- INV-2: 채널 재시도 중복 방어. 애플리케이션 체크만으로는 경합을 못 막는다
  idempotency_key   text not null,
  status            booking_status not null default 'ON_HOLD',
  hold_expires_at   timestamptz,
  confirm_due_at    timestamptz,
  -- INV-3: 예약 시점 확정 금액. PriceRule 이 바뀌어도 재계산하지 않는다
  total_retail      integer not null check (total_retail >= 0),
  total_net         integer check (total_net >= 0),
  currency          char(3) not null,
  -- 적용 룰 ID 까지 포함한다. 금액만 남기면 근거를 재구성할 수 없다
  price_snapshot    jsonb not null,
  customer          jsonb,
  service_date      date not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- INV-2: 테넌트 안에서 멱등키는 유일하다
  constraint booking_idempotency_unique unique (tenant_id, idempotency_key),
  constraint booking_no_unique unique (tenant_id, booking_no)
);

create table booking_item (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant (id) on delete cascade,
  booking_id   uuid not null references booking (id) on delete cascade,
  unit_id      uuid not null references unit (id),
  quantity     integer not null check (quantity > 0),
  -- INV-3·10: 단가 스냅샷도 정수 minor unit
  unit_retail  integer not null check (unit_retail >= 0),
  unit_net     integer check (unit_net >= 0),
  created_at   timestamptz not null default now()
);

-- INV-7: 모든 상태 전이가 여기 남는다. append-only 로 운영한다
create table booking_log (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null references tenant (id) on delete cascade,
  booking_id   uuid not null references booking (id) on delete cascade,
  from_status  booking_status,
  to_status    booking_status not null,
  actor_type   actor_type not null,
  actor_id     text,
  reason       text,
  occurred_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 인덱스
-- RLS 정책이 tenant_id 를 조건으로 쓰므로 인덱스가 없으면 전 테이블 스캔이 된다.
-- ─────────────────────────────────────────────────────────────

create index product_tenant_status_idx on product (tenant_id, status);
create index option_tenant_product_idx on product_option (tenant_id, product_id);
create index unit_tenant_option_idx on unit (tenant_id, option_id);
create index price_rule_tenant_unit_idx on price_rule (tenant_id, unit_id, scope);

-- 가용성 캘린더 조회의 주 경로 (Rule #16 성능 예산)
create index slot_tenant_option_date_idx on availability_slot (tenant_id, option_id, local_date);
-- 잔여 있는 슬롯만 훑는 부분 인덱스 — 매진·블록아웃 행을 건너뛴다
create index slot_open_idx on availability_slot (option_id, local_date)
  where status = 'OPEN';

create index booking_tenant_status_service_idx on booking (tenant_id, status, service_date);
-- 홀드 만료 배치 전용 — 만료 대상만 좁게 훑는다
create index booking_hold_expiry_idx on booking (hold_expires_at)
  where status = 'ON_HOLD';
create index booking_item_booking_idx on booking_item (booking_id);
create index booking_log_booking_idx on booking_log (booking_id, occurred_at desc);
create index entitlement_tenant_idx on tenant_entitlement (tenant_id) where enabled;

-- ─────────────────────────────────────────────────────────────
-- updated_at 트리거
-- ─────────────────────────────────────────────────────────────

create trigger tenant_set_updated_at before update on tenant
  for each row execute function public.set_updated_at();
create trigger product_set_updated_at before update on product
  for each row execute function public.set_updated_at();
create trigger option_set_updated_at before update on product_option
  for each row execute function public.set_updated_at();
create trigger price_rule_set_updated_at before update on price_rule
  for each row execute function public.set_updated_at();
create trigger slot_set_updated_at before update on availability_slot
  for each row execute function public.set_updated_at();
create trigger booking_set_updated_at before update on booking
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- INV-5: RLS — 테넌트 격리
--
-- 애플리케이션도 tenant_id 로 스코프하지만, 그 한 겹만 믿지 않는다.
-- 앱 필터에 버그가 나도 DB 가 막고, RLS 정책에 구멍이 나도 앱이 막는다.
-- service_role 은 RLS 를 우회하므로 서버 코드의 앱 레벨 필터가 필수다.
-- ─────────────────────────────────────────────────────────────

alter table tenant enable row level security;
alter table module_catalog enable row level security;
alter table tenant_entitlement enable row level security;
alter table product enable row level security;
alter table product_option enable row level security;
alter table unit enable row level security;
alter table price_rule enable row level security;
alter table availability_slot enable row level security;
alter table booking enable row level security;
alter table booking_item enable row level security;
alter table booking_log enable row level security;

-- 테넌트 자신의 레코드만. 마스터는 전체 열람 가능.
create policy tenant_self_read on tenant
  for select using (id = public.current_tenant_id() or public.is_master());
create policy tenant_master_write on tenant
  for all using (public.is_master()) with check (public.is_master());

-- 모듈 카탈로그는 읽기 공개(가입 설문에서 필요), 쓰기는 마스터만.
create policy module_catalog_read on module_catalog
  for select using (true);
create policy module_catalog_master_write on module_catalog
  for all using (public.is_master()) with check (public.is_master());

-- 개통 정보는 본인 것만 읽는다. 개통·해지는 마스터 권한 (INV-6).
create policy entitlement_read on tenant_entitlement
  for select using (tenant_id = public.current_tenant_id() or public.is_master());
create policy entitlement_master_write on tenant_entitlement
  for all using (public.is_master()) with check (public.is_master());

-- 테넌트 소유 데이터: 읽기·쓰기 모두 자기 테넌트로 제한한다.
-- WITH CHECK 가 없으면 남의 tenant_id 를 적어 INSERT 하는 우회가 열린다.
do $$
declare
  t text;
begin
  foreach t in array array[
    'product', 'product_option', 'unit', 'price_rule',
    'availability_slot', 'booking', 'booking_item', 'booking_log'
  ]
  loop
    execute format($f$
      create policy tenant_isolation on public.%I
        for all
        using (tenant_id = public.current_tenant_id() or public.is_master())
        with check (tenant_id = public.current_tenant_id() or public.is_master())
    $f$, t);
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 모듈 카탈로그 시드 (docs/08 §2 — Phase 1 범위)
-- ─────────────────────────────────────────────────────────────

insert into module_catalog (code, category, name) values
  ('CORE',          'CORE',  '기본 상품·예약 관리'),
  ('PRICE-SEASON',  'PRICE', '시즌별 가격'),
  ('PRICE-TIMEBAND','PRICE', '시간대별 가격'),
  ('PRICE-CHANNEL', 'PRICE', '채널별 가격'),
  ('PRICE-GROUP',   'PRICE', '인원 구간 계단가'),
  ('INV-DATE',      'INV',   '일자별 재고'),
  ('INV-SLOT',      'INV',   '타임슬롯 재고'),
  ('INV-OPEN',      'INV',   '오픈데이트(무제한) 재고')
on conflict (code) do nothing;
