import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database, DbHandles } from './client.js';
import {
  BundleSoldOutError,
  confirmHold,
  holdBundle,
  holdSlot,
  releaseBooked,
  releaseHold,
} from './inventory.repository.js';
import {
  assertDatabaseAvailableInCi,
  cleanupTenant,
  hasTestDatabase,
  openTestDatabase,
  readSlot,
  seedFixture,
  seedSlot,
  type Fixture,
} from './testing/harness.js';

assertDatabaseAvailableInCi();

/**
 * 재고 정합성 통합 테스트 — 실제 Postgres 에 대해 실행한다.
 *
 * INV-1 은 "코드가 조건을 잘 쓴다"가 아니라 "DB 가 경합을 직렬화한다"에 기대는
 * 규칙이라, 목(mock)으로는 증명되지 않는다. 로컬 Supabase 스택이 필요하다.
 *
 *   supabase start
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test
 */
describe.skipIf(!hasTestDatabase)('재고 차감 정합성 (INV-1)', () => {
  let handles: DbHandles;
  let db: Database;
  let fixture: Fixture;

  beforeAll(async () => {
    handles = openTestDatabase();
    db = handles.primaryDb;
    fixture = await seedFixture(db);
  });

  afterAll(async () => {
    await cleanupTenant(db, fixture.tenantId);
    await handles.close();
  });

  it('should_sell_exactly_one_when_many_requests_race_for_last_seat', async () => {
    // 이 프로젝트에서 가장 중요한 테스트.
    // 잔여 1석에 20개 요청을 동시에 던진다. 정확히 1건만 성공해야 한다.
    const slotId = await seedSlot(db, fixture, 1, '2026-09-02');

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => holdSlot(db, slotId, fixture.tenantId, 1)),
    );

    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok)).toHaveLength(19);

    const after = await readSlot(db, slotId);
    expect(after.heldCount).toBe(1);
    expect(after.bookedCount).toBe(0);
  });

  it('should_not_oversell_when_quantities_vary', async () => {
    // 잔여 10석에 3석씩 6건 동시 요청 → 최대 3건(9석)만 성공 가능
    const slotId = await seedSlot(db, fixture, 10, '2026-09-03');

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => holdSlot(db, slotId, fixture.tenantId, 3)),
    );

    const succeeded = outcomes.filter((o) => o.ok).length;
    expect(succeeded).toBe(3);

    const after = await readSlot(db, slotId);
    expect(after.heldCount).toBe(9);
    // 어떤 경우에도 정원을 넘지 않는다
    expect(after.heldCount + after.bookedCount).toBeLessThanOrEqual(10);
  });

  it('should_never_sell_out_a_freesale_slot', async () => {
    // docs/07 §T1 에버랜드 — capacity NULL 은 무제한.
    // 조건절에서 NULL 분기를 빼면 여기서 전량 실패한다.
    const slotId = await seedSlot(db, fixture, null, '2026-09-04');

    const outcomes = await Promise.all(
      Array.from({ length: 30 }, () => holdSlot(db, slotId, fixture.tenantId, 100)),
    );

    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect((await readSlot(db, slotId)).heldCount).toBe(3000);
  });

  it('should_reject_hold_on_closed_slot', async () => {
    // 블록아웃은 잔여와 무관하게 판매를 막는다 (docs/07 §T1 재고 2)
    const slotId = await seedSlot(db, fixture, 10, '2026-09-05');
    await db.execute(
      sql`update availability_slot set status = 'CLOSED' where id = ${slotId}::uuid`,
    );

    expect(await holdSlot(db, slotId, fixture.tenantId, 1)).toEqual({
      ok: false,
      reason: 'SOLD_OUT',
    });
  });

  it('should_isolate_holds_across_tenants', async () => {
    // INV-5: 다른 테넌트의 tenant_id 로는 남의 슬롯을 차감할 수 없다.
    const slotId = await seedSlot(db, fixture, 5, '2026-09-06');
    const other = await seedFixture(db);

    const outcome = await holdSlot(db, slotId, other.tenantId, 1);
    expect(outcome).toEqual({ ok: false, reason: 'SOLD_OUT' });
    expect((await readSlot(db, slotId)).heldCount).toBe(0);

    await cleanupTenant(db, other.tenantId);
  });

  it('should_reject_invalid_quantity', async () => {
    const slotId = await seedSlot(db, fixture, 5, '2026-09-07');
    await expect(holdSlot(db, slotId, fixture.tenantId, 0)).rejects.toThrow(RangeError);
    await expect(holdSlot(db, slotId, fixture.tenantId, 1.5)).rejects.toThrow(RangeError);
  });
});

describe.skipIf(!hasTestDatabase)('홀드 → 확정 → 복원 (docs/03 §3.2)', () => {
  let handles: DbHandles;
  let db: Database;
  let fixture: Fixture;

  beforeAll(async () => {
    handles = openTestDatabase();
    db = handles.primaryDb;
    fixture = await seedFixture(db);
  });

  afterAll(async () => {
    await cleanupTenant(db, fixture.tenantId);
    await handles.close();
  });

  it('should_move_held_to_booked_atomically', async () => {
    const slotId = await seedSlot(db, fixture, 10, '2026-10-01');
    await holdSlot(db, slotId, fixture.tenantId, 3);

    expect(await confirmHold(db, slotId, fixture.tenantId, 3)).toEqual({ ok: true });

    const after = await readSlot(db, slotId);
    expect(after.heldCount).toBe(0);
    expect(after.bookedCount).toBe(3);
  });

  it('should_reject_confirming_more_than_held', async () => {
    // 홀드 없이 확정하는 경로가 열리면 재고가 이중 계상된다.
    const slotId = await seedSlot(db, fixture, 10, '2026-10-02');
    await holdSlot(db, slotId, fixture.tenantId, 2);

    expect(await confirmHold(db, slotId, fixture.tenantId, 3)).toEqual({
      ok: false,
      reason: 'HOLD_NOT_FOUND',
    });
    expect((await readSlot(db, slotId)).heldCount).toBe(2);
  });

  it('should_restore_capacity_on_hold_release', async () => {
    // 만료 배치가 홀드를 회수하지 못하면 재고가 영구 점유된다.
    const slotId = await seedSlot(db, fixture, 10, '2026-10-03');
    await holdSlot(db, slotId, fixture.tenantId, 4);

    expect(await releaseHold(db, slotId, fixture.tenantId, 4)).toEqual({ ok: true });
    expect((await readSlot(db, slotId)).heldCount).toBe(0);
  });

  it('should_restore_capacity_on_booking_cancellation', async () => {
    const slotId = await seedSlot(db, fixture, 10, '2026-10-04');
    await holdSlot(db, slotId, fixture.tenantId, 2);
    await confirmHold(db, slotId, fixture.tenantId, 2);

    expect(await releaseBooked(db, slotId, fixture.tenantId, 2)).toEqual({ ok: true });
    expect((await readSlot(db, slotId)).bookedCount).toBe(0);
  });

  it('should_reject_releasing_more_than_held', async () => {
    // 음수 회수를 0 으로 뭉개면 회계가 어긋난 사실이 숨는다.
    const slotId = await seedSlot(db, fixture, 10, '2026-10-05');
    expect(await releaseHold(db, slotId, fixture.tenantId, 1)).toEqual({
      ok: false,
      reason: 'HOLD_NOT_FOUND',
    });
  });
});

describe.skipIf(!hasTestDatabase)('번들 — 단일 트랜잭션 (INV-9)', () => {
  let handles: DbHandles;
  let db: Database;
  let fixture: Fixture;

  beforeAll(async () => {
    handles = openTestDatabase();
    db = handles.primaryDb;
    fixture = await seedFixture(db);
  });

  afterAll(async () => {
    await cleanupTenant(db, fixture.tenantId);
    await handles.close();
  });

  it('should_hold_every_component_together', async () => {
    const a = await seedSlot(db, fixture, 10, '2026-11-01');
    const b = await seedSlot(db, fixture, 10, '2026-11-02');

    await holdBundle(db, fixture.tenantId, [
      { slotId: a, quantity: 2 },
      { slotId: b, quantity: 2 },
    ]);

    expect((await readSlot(db, a)).heldCount).toBe(2);
    expect((await readSlot(db, b)).heldCount).toBe(2);
  });

  it('should_roll_back_first_component_when_second_is_sold_out', async () => {
    // 부분 성공을 허용하면 팔리지 않은 예약이 재고만 점유한 채 남는다.
    const plenty = await seedSlot(db, fixture, 10, '2026-11-03');
    const scarce = await seedSlot(db, fixture, 1, '2026-11-04');

    await expect(
      holdBundle(db, fixture.tenantId, [
        { slotId: plenty, quantity: 2 },
        { slotId: scarce, quantity: 2 },
      ]),
    ).rejects.toThrow(BundleSoldOutError);

    // 첫 구성품 차감이 되돌아가 있어야 한다
    expect((await readSlot(db, plenty)).heldCount).toBe(0);
    expect((await readSlot(db, scarce)).heldCount).toBe(0);
  });
});
