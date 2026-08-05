import { sql } from 'drizzle-orm';

import type { Database } from './client.js';

/**
 * 재고 차감 — INV-1
 *
 * 이 파일이 이 프로젝트에서 가장 조심해야 할 코드다.
 *
 * 잔여를 SELECT 로 확인한 뒤 UPDATE 하는 2단계 패턴은 절대 쓰지 않는다.
 * 두 문장 사이에 다른 트랜잭션이 끼어들면 둘 다 "잔여 있음"을 보고 둘 다 차감해
 * 오버부킹이 된다. 대신 **조건을 UPDATE 문 안에 넣고**, 영향 행 수로 성공을 판정한다.
 * Postgres 가 행 잠금으로 직렬화해주므로 경합이 있어도 정확히 한 쪽만 성공한다.
 *
 * `capacity IS NULL` 은 무제한(FREESALE)이다. 이 분기를 빼면 에버랜드 종일권 같은
 * 무한재고 상품이 전량 매진된다.
 *
 * 읽기 복제본을 넘기면 안 된다 — 복제 지연은 곧 오버부킹이다 (INV-12).
 */

export type HoldOutcome =
  | { readonly ok: true; readonly slotId: string; readonly heldCount: number }
  | { readonly ok: false; readonly reason: 'SOLD_OUT' };

/** 홀드 생성: held_count 증가. 잔여가 모자라거나 슬롯이 닫혀 있으면 실패한다. */
export async function holdSlot(
  db: Database,
  slotId: string,
  tenantId: string,
  quantity: number,
): Promise<HoldOutcome> {
  assertPositiveInteger(quantity);

  // INV-1: 조건부 UPDATE 단일 문장. rowCount 가 유일한 판정 근거다.
  const result = await db.execute<{ held_count: number }>(sql`
    update availability_slot
       set held_count = held_count + ${quantity},
           version    = version + 1
     where id = ${slotId}::uuid
       and tenant_id = ${tenantId}::uuid
       and status = 'OPEN'
       and (capacity is null or capacity - booked_count - held_count >= ${quantity})
    returning held_count
  `);

  const row = result.rows[0];
  if (!row) return { ok: false, reason: 'SOLD_OUT' };
  return { ok: true, slotId, heldCount: row.held_count };
}

export type ConfirmOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: 'HOLD_NOT_FOUND' };

/**
 * 홀드 → 확정: held_count 감소 + booked_count 증가를 **한 문장**으로.
 *
 * 두 문장으로 나누면 사이에서 실패했을 때 재고가 증발하거나 이중 계상된다.
 * `held_count >= quantity` 조건이 없으면 홀드 없이 확정하는 경로가 열린다.
 */
export async function confirmHold(
  db: Database,
  slotId: string,
  tenantId: string,
  quantity: number,
): Promise<ConfirmOutcome> {
  assertPositiveInteger(quantity);

  const result = await db.execute(sql`
    update availability_slot
       set held_count   = held_count - ${quantity},
           booked_count = booked_count + ${quantity},
           version      = version + 1
     where id = ${slotId}::uuid
       and tenant_id = ${tenantId}::uuid
       and held_count >= ${quantity}
    returning id
  `);

  return result.rows.length > 0 ? { ok: true } : { ok: false, reason: 'HOLD_NOT_FOUND' };
}

/**
 * 홀드 해제 (만료 배치·release·취소): held_count 복원.
 *
 * `greatest(held_count - qty, 0)` 를 쓰지 않는다. 음수가 될 상황이면 회계가 이미
 * 어긋난 것이므로 조용히 0 으로 뭉개지 말고 실패를 드러내야 한다.
 */
export async function releaseHold(
  db: Database,
  slotId: string,
  tenantId: string,
  quantity: number,
): Promise<ConfirmOutcome> {
  assertPositiveInteger(quantity);

  const result = await db.execute(sql`
    update availability_slot
       set held_count = held_count - ${quantity},
           version    = version + 1
     where id = ${slotId}::uuid
       and tenant_id = ${tenantId}::uuid
       and held_count >= ${quantity}
    returning id
  `);

  return result.rows.length > 0 ? { ok: true } : { ok: false, reason: 'HOLD_NOT_FOUND' };
}

/**
 * 확정 취소: booked_count 복원. 취소 시 채널에 재고 재개를 통보해야 한다(docs/03 §3.2).
 */
export async function releaseBooked(
  db: Database,
  slotId: string,
  tenantId: string,
  quantity: number,
): Promise<ConfirmOutcome> {
  assertPositiveInteger(quantity);

  const result = await db.execute(sql`
    update availability_slot
       set booked_count = booked_count - ${quantity},
           version      = version + 1
     where id = ${slotId}::uuid
       and tenant_id = ${tenantId}::uuid
       and booked_count >= ${quantity}
    returning id
  `);

  return result.rows.length > 0 ? { ok: true } : { ok: false, reason: 'HOLD_NOT_FOUND' };
}

export interface BundleComponent {
  readonly slotId: string;
  readonly quantity: number;
}

/**
 * 번들 차감 — INV-9
 *
 * 전 구성품을 한 트랜잭션에서 처리한다. 하나라도 실패하면 예외를 던져 전체를
 * 롤백시킨다. 부분 성공을 허용하면 팔리지 않은 예약이 재고만 점유한 채 남는다.
 *
 * 구성품을 slotId 순으로 정렬해 잠금 순서를 고정한다 — 두 예약이 같은 구성품
 * 집합을 반대 순서로 잠그면 데드락이 난다.
 */
export async function holdBundle(
  db: Database,
  tenantId: string,
  components: readonly BundleComponent[],
): Promise<void> {
  const ordered = [...components].sort((a, b) => (a.slotId < b.slotId ? -1 : 1));

  await db.transaction(async (tx) => {
    for (const component of ordered) {
      const outcome = await holdSlot(tx, component.slotId, tenantId, component.quantity);
      if (!outcome.ok) {
        // 예외를 던져 트랜잭션 전체를 되돌린다 (INV-9).
        throw new BundleSoldOutError(component.slotId);
      }
    }
  });
}

export class BundleSoldOutError extends Error {
  readonly code = 'BUNDLE_SOLD_OUT';

  constructor(readonly slotId: string) {
    super(`번들 구성품 재고 부족으로 전체 롤백: slot=${slotId} — INV-9`);
    this.name = 'BundleSoldOutError';
  }
}

function assertPositiveInteger(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new RangeError(`수량은 양의 정수여야 합니다: ${String(quantity)}`);
  }
}
