import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle 스키마 — `supabase/migrations/` SQL 의 타입 반영본.
 *
 * 스키마의 진실은 마이그레이션 SQL 이다(Rule #11). 이 파일은 그것을 타입으로
 * 다시 표현할 뿐이며, 여기서 스키마를 "정의"해 마이그레이션을 생성하지 않는다.
 * RLS 정책과 부분 인덱스처럼 Drizzle 이 표현하지 못하는 것들이 SQL 에 있기 때문이다.
 */

export const tenantStatus = pgEnum('tenant_status', [
  'PENDING_REVIEW',
  'APPROVED',
  'SUSPENDED',
  'REJECTED',
]);

export const productCategory = pgEnum('product_category', [
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C7',
  'C8',
]);

export const availabilityType = pgEnum('availability_type', [
  'START_TIME',
  'OPENING_HOURS',
  'FREESALE',
]);

export const confirmationType = pgEnum('confirmation_type', ['INSTANT', 'ON_REQUEST']);

export const productStatus = pgEnum('product_status', [
  'DRAFT',
  'IN_REVIEW',
  'ACTIVE',
  'PAUSED',
  'ARCHIVED',
]);

export const unitType = pgEnum('unit_type', [
  'ADULT',
  'CHILD',
  'YOUTH',
  'INFANT',
  'SENIOR',
  'STUDENT',
  'GROUP',
  'OTHER',
]);

export const saleUnitType = pgEnum('sale_unit_type', [
  'PERSON',
  'GROUP',
  'VEHICLE',
  'ROOM',
  'DAY',
  'PIECE',
]);

export const priceScope = pgEnum('price_scope', [
  'SPECIFIC_DATE',
  'TIME_BAND',
  'CHANNEL_DOW',
  'DOW',
  'SEASON',
  'BASE',
]);

export const slotStatus = pgEnum('slot_status', ['OPEN', 'CLOSED', 'SOLD_OUT']);

export const bookingStatus = pgEnum('booking_status', [
  'ON_HOLD',
  'PENDING',
  'CONFIRMED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'REDEEMED',
  'NO_SHOW',
]);

export const actorType = pgEnum('actor_type', ['USER', 'CHANNEL_API', 'SYSTEM_BATCH']);

export const tenant = pgTable('tenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  legalName: text('legal_name'),
  businessRegNo: text('business_reg_no'),
  status: tenantStatus('status').notNull().default('PENDING_REVIEW'),
  defaultCurrency: char('default_currency', { length: 3 }).notNull().default('KRW'),
  timezone: text('timezone').notNull().default('Asia/Seoul'),
  contactEmail: text('contact_email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const moduleCatalog = pgTable('module_catalog', {
  code: text('code').primaryKey(),
  category: text('category').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenantEntitlement = pgTable(
  'tenant_entitlement',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    moduleCode: text('module_code')
      .notNull()
      .references(() => moduleCatalog.code),
    enabled: boolean('enabled').notNull().default(true),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.moduleCode] })],
);

export const product = pgTable(
  'product',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    category: productCategory('category').notNull(),
    title: text('title').notNull(),
    /** INV-8: 상품 운영 타임존 */
    timezone: text('timezone').notNull(),
    availabilityType: availabilityType('availability_type').notNull(),
    confirmationType: confirmationType('confirmation_type').notNull().default('INSTANT'),
    status: productStatus('status').notNull().default('DRAFT'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('product_tenant_status_idx').on(t.tenantId, t.status)],
);

export const productOption = pgTable(
  'product_option',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    cutoffMinutes: integer('cutoff_minutes').notNull().default(0),
    minUnits: integer('min_units'),
    maxUnits: integer('max_units'),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('option_tenant_product_idx').on(t.tenantId, t.productId)],
);

export const unit = pgTable(
  'unit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    optionId: uuid('option_id')
      .notNull()
      .references(() => productOption.id, { onDelete: 'cascade' }),
    type: unitType('type').notNull(),
    saleUnitType: saleUnitType('sale_unit_type').notNull().default('PERSON'),
    paxCount: integer('pax_count').notNull().default(1),
    ageFrom: integer('age_from'),
    ageTo: integer('age_to'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('unit_tenant_option_idx').on(t.tenantId, t.optionId)],
);

export const priceRule = pgTable(
  'price_rule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => unit.id, { onDelete: 'cascade' }),
    scope: priceScope('scope').notNull(),
    channelId: uuid('channel_id'),
    dateFrom: date('date_from'),
    dateTo: date('date_to'),
    daysOfWeek: smallint('days_of_week').array(),
    timeFrom: time('time_from'),
    timeTo: time('time_to'),
    tierMin: integer('tier_min'),
    tierMax: integer('tier_max'),
    /** INV-10: 정수 minor unit */
    retailAmount: integer('retail_amount').notNull(),
    netAmount: integer('net_amount'),
    currency: char('currency', { length: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('price_rule_tenant_unit_idx').on(t.tenantId, t.unitId, t.scope)],
);

export const availabilitySlot = pgTable(
  'availability_slot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    optionId: uuid('option_id')
      .notNull()
      .references(() => productOption.id, { onDelete: 'cascade' }),
    /** INV-8: 시설 로컬 날짜·시각 */
    localDate: date('local_date').notNull(),
    localStartTime: time('local_start_time'),
    /** INV-1: null = 무제한(FREESALE) */
    capacity: integer('capacity'),
    bookedCount: integer('booked_count').notNull().default(0),
    heldCount: integer('held_count').notNull().default(0),
    status: slotStatus('status').notNull().default('OPEN'),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('slot_tenant_option_date_idx').on(t.tenantId, t.optionId, t.localDate),
    unique('slot_unique_per_option').on(t.optionId, t.localDate, t.localStartTime),
  ],
);

export const booking = pgTable(
  'booking',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    bookingNo: text('booking_no').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id),
    optionId: uuid('option_id')
      .notNull()
      .references(() => productOption.id),
    slotId: uuid('slot_id').references(() => availabilitySlot.id),
    channelId: uuid('channel_id'),
    channelBookingRef: text('channel_booking_ref'),
    /** INV-2: 테넌트 안에서 유일 */
    idempotencyKey: text('idempotency_key').notNull(),
    status: bookingStatus('status').notNull().default('ON_HOLD'),
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
    confirmDueAt: timestamp('confirm_due_at', { withTimezone: true }),
    /** INV-3·10 */
    totalRetail: integer('total_retail').notNull(),
    totalNet: integer('total_net'),
    currency: char('currency', { length: 3 }).notNull(),
    priceSnapshot: jsonb('price_snapshot').notNull(),
    customer: jsonb('customer'),
    serviceDate: date('service_date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('booking_idempotency_unique').on(t.tenantId, t.idempotencyKey),
    unique('booking_no_unique').on(t.tenantId, t.bookingNo),
    index('booking_tenant_status_service_idx').on(t.tenantId, t.status, t.serviceDate),
  ],
);

export const bookingItem = pgTable(
  'booking_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => booking.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => unit.id),
    quantity: integer('quantity').notNull(),
    unitRetail: integer('unit_retail').notNull(),
    unitNet: integer('unit_net'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('booking_item_booking_idx').on(t.bookingId)],
);

/** INV-7: 상태 전이 감사 이력 — append-only */
export const bookingLog = pgTable(
  'booking_log',
  {
    id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => booking.id, { onDelete: 'cascade' }),
    fromStatus: bookingStatus('from_status'),
    toStatus: bookingStatus('to_status').notNull(),
    actorType: actorType('actor_type').notNull(),
    actorId: text('actor_id'),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('booking_log_booking_idx').on(t.bookingId, t.occurredAt)],
);
