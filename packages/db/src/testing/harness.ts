import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { createDatabase, type Database, type DbHandles } from '../client.js';

/**
 * 통합 테스트용 DB 하네스.
 *
 * DB 를 스텁하지 않는다(test_agent 규칙). 오버부킹 방지는 Postgres 의 행 잠금이
 * 실제로 직렬화해주기 때문에 성립하는 것이라, 가짜 DB 로는 아무것도 증명하지 못한다.
 *
 * 로컬 스택: `supabase start` 후 TEST_DATABASE_URL 을 넘긴다.
 */

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
export const hasTestDatabase = TEST_DATABASE_URL !== '';

/**
 * CI 에서는 DB 가 반드시 있어야 한다. 없으면 조용히 건너뛰는 대신 실패시킨다 —
 * 불변식 테스트가 스킵된 채로 초록불이 뜨는 것이 가장 위험하다.
 */
export function assertDatabaseAvailableInCi(): void {
  if (!hasTestDatabase && process.env.CI === 'true') {
    throw new Error(
      'CI 환경에 TEST_DATABASE_URL 이 없습니다. INV-1 동시성 테스트를 건너뛸 수 없습니다.',
    );
  }
}

export interface Fixture {
  readonly tenantId: string;
  readonly productId: string;
  readonly optionId: string;
  readonly unitId: string;
}

export function openTestDatabase(): DbHandles {
  return createDatabase({ primaryUrl: TEST_DATABASE_URL, poolMax: 30 });
}

/** 테넌트 → 상품 → 옵션 → 유닛 최소 계보를 만든다. */
export async function seedFixture(db: Database): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);

  const tenant = await db.execute<{ id: string }>(sql`
    insert into tenant (name, timezone) values (${'테스트 시설사 ' + suffix}, 'Asia/Seoul')
    returning id
  `);
  const tenantId = required(tenant.rows[0]?.id, 'tenant');

  const product = await db.execute<{ id: string }>(sql`
    insert into product (tenant_id, category, title, timezone, availability_type, status)
    values (${tenantId}::uuid, 'C4', ${'난타 ' + suffix}, 'Asia/Seoul', 'START_TIME', 'ACTIVE')
    returning id
  `);
  const productId = required(product.rows[0]?.id, 'product');

  const option = await db.execute<{ id: string }>(sql`
    insert into product_option (tenant_id, product_id, title, cutoff_minutes)
    values (${tenantId}::uuid, ${productId}::uuid, 'S석 20:00 회차', 120)
    returning id
  `);
  const optionId = required(option.rows[0]?.id, 'product_option');

  const unit = await db.execute<{ id: string }>(sql`
    insert into unit (tenant_id, option_id, type) values (${tenantId}::uuid, ${optionId}::uuid, 'ADULT')
    returning id
  `);
  const unitId = required(unit.rows[0]?.id, 'unit');

  return { tenantId, productId, optionId, unitId };
}

/** `capacity: null` 이면 FREESALE(무제한) 슬롯이 된다. */
export async function seedSlot(
  db: Database,
  fixture: Fixture,
  capacity: number | null,
  localDate = '2026-09-01',
  localStartTime: string | null = '20:00',
): Promise<string> {
  const slot = await db.execute<{ id: string }>(sql`
    insert into availability_slot (tenant_id, option_id, local_date, local_start_time, capacity)
    values (
      ${fixture.tenantId}::uuid, ${fixture.optionId}::uuid,
      ${localDate}::date, ${localStartTime}::time, ${capacity}
    )
    returning id
  `);
  return required(slot.rows[0]?.id, 'availability_slot');
}

export interface SlotCounts {
  readonly capacity: number | null;
  readonly bookedCount: number;
  readonly heldCount: number;
}

export async function readSlot(db: Database, slotId: string): Promise<SlotCounts> {
  const result = await db.execute<{
    capacity: number | null;
    booked_count: number;
    held_count: number;
  }>(
    sql`select capacity, booked_count, held_count from availability_slot where id = ${slotId}::uuid`,
  );

  const row = result.rows[0];
  if (!row) throw new Error(`슬롯을 찾을 수 없습니다: ${slotId}`);
  return { capacity: row.capacity, bookedCount: row.booked_count, heldCount: row.held_count };
}

/** 테넌트 삭제로 하위 데이터가 cascade 정리된다. */
export async function cleanupTenant(db: Database, tenantId: string): Promise<void> {
  await db.execute(sql`delete from tenant where id = ${tenantId}::uuid`);
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} 생성 실패 — 반환 행이 없습니다`);
  return value;
}
