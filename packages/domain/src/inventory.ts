import { toInstant, type LocalDate, type LocalTime, type TimeZone } from './localtime.js';

/**
 * 재고 슬롯 규칙 — INV-1 / docs/03 §2.3·§3.2 / docs/07 §9
 *
 * ⚠ 이 모듈은 **판정하지 않는다.** 홀드 성공 여부의 유일한 진실은
 * DB 의 원자적 조건부 UPDATE 가 돌려주는 영향 행 수다.
 *
 *   UPDATE availability_slot SET held_count = held_count + :qty
 *    WHERE id = :slot_id AND status = 'OPEN'
 *      AND (capacity IS NULL OR capacity - booked_count - held_count >= :qty);
 *   -- rowCount === 0  →  SOLD_OUT
 *
 * 여기 있는 함수들은 캘린더 표시와 사전 안내(UX)를 위한 **자문(advisory)** 이다.
 * 조회 결과를 보고 애플리케이션에서 차감 여부를 결정하는 순간 INV-1 이 깨진다
 * (조회와 갱신 사이의 경합 = 오버부킹). 읽기 복제본·캐시를 경유했다면 더더욱이다(INV-12).
 */

export type AvailabilityType = 'START_TIME' | 'OPENING_HOURS' | 'FREESALE';

/** docs/03 §2.3 — CLOSED 는 블록아웃(공급자 판매 중지) */
export type SlotStatus = 'OPEN' | 'CLOSED' | 'SOLD_OUT';

export interface SlotState {
  /** null = 무제한(FREESALE). 0 과 혼동하면 무한재고 상품이 전량 매진된다 — INV-1 */
  readonly capacity: number | null;
  readonly bookedCount: number;
  readonly heldCount: number;
  readonly status: SlotStatus;
}

/**
 * 잔여 = capacity − booked − held. 저장하지 않고 계산한다(docs/03 §2.3).
 * 무제한 슬롯은 `null` 을 반환한다 — 호출부에서 `?? 0` 으로 뭉개지 말 것.
 */
export function vacancy(slot: SlotState): number | null {
  if (slot.capacity === null) return null;
  return slot.capacity - slot.bookedCount - slot.heldCount;
}

/** 무제한 슬롯은 결코 매진되지 않는다. */
export function isSoldOut(slot: SlotState): boolean {
  const remaining = vacancy(slot);
  return remaining !== null && remaining <= 0;
}

export type HoldRejectionReason =
  | 'INVALID_QUANTITY'
  | 'SLOT_CLOSED'
  | 'SOLD_OUT'
  | 'CUTOFF_PASSED'
  | 'BELOW_MIN_UNITS'
  | 'ABOVE_MAX_UNITS';

export type HoldPrecheck =
  { readonly ok: true } | { readonly ok: false; readonly reason: HoldRejectionReason };

export interface HoldPrecheckInput {
  readonly slot: SlotState;
  readonly quantity: number;
  /** Option 의 예약당 최소/최대 수량 (docs/03 §2.2 min_units/max_units) */
  readonly minUnits?: number;
  readonly maxUnits?: number;
  /** 컷오프 판정에 필요한 정보. 생략하면 컷오프를 검사하지 않는다. */
  readonly cutoff?: CutoffInput;
}

/**
 * 홀드 사전 점검 (자문용).
 *
 * 통과했다고 홀드가 성공한다는 뜻이 아니다. 실패 사유를 사용자에게 먼저 보여주고
 * 불필요한 DB 왕복을 줄이기 위한 것이며, 최종 판정은 언제나 조건부 UPDATE 다.
 */
export function precheckHold(input: HoldPrecheckInput): HoldPrecheck {
  const { slot, quantity, minUnits, maxUnits, cutoff } = input;

  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return { ok: false, reason: 'INVALID_QUANTITY' };
  }
  if (minUnits !== undefined && quantity < minUnits) {
    return { ok: false, reason: 'BELOW_MIN_UNITS' };
  }
  if (maxUnits !== undefined && quantity > maxUnits) {
    return { ok: false, reason: 'ABOVE_MAX_UNITS' };
  }
  // 블록아웃은 잔여와 무관하게 판매를 막는다 (docs/07 §T1 재고 로직 2)
  if (slot.status !== 'OPEN') {
    return { ok: false, reason: 'SLOT_CLOSED' };
  }
  if (cutoff && isCutoffPassed(cutoff)) {
    return { ok: false, reason: 'CUTOFF_PASSED' };
  }

  const remaining = vacancy(slot);
  // remaining === null → 무제한. 잔여 검증을 건너뛴다 (docs/07 §9 재고 1)
  if (remaining !== null && remaining < quantity) {
    return { ok: false, reason: 'SOLD_OUT' };
  }

  return { ok: true };
}

export interface CutoffInput {
  readonly localDate: LocalDate;
  /** 시각 없는 슬롯(OPENING_HOURS·FREESALE)은 null → 이용일 00:00 기준 */
  readonly localStartTime: LocalTime | null;
  readonly timeZone: TimeZone;
  /** 이용 시작 N분 전에 판매를 마감 (docs/03 §2.2 cutoff_minutes) */
  readonly cutoffMinutes: number;
  readonly now: Date;
}

/**
 * 컷오프 경과 여부 — 시설 타임존의 이용 시작 시각 기준(docs/03 §3.3).
 *
 * 서버 로컬 시간이나 UTC 로 계산하면 서머타임이 있는 목적지에서 한 시간씩 어긋나
 * 마감이 일찍 걸리거나 지난 회차가 팔린다. 그래서 시설 타임존을 반드시 경유한다(INV-8).
 */
export function isCutoffPassed(input: CutoffInput): boolean {
  const startInstant = toInstant(input.localDate, input.localStartTime, input.timeZone);
  const deadline = startInstant.getTime() - input.cutoffMinutes * 60_000;
  return input.now.getTime() >= deadline;
}

/**
 * 번들 가용성 — 가용성 = min(구성품), 컷오프 = max(구성품) (INV-9 / docs/07 §B1).
 *
 * 실제 차감은 단일 트랜잭션에서 전 구성품을 처리하고 하나라도 실패하면 전체 롤백한다.
 * 이 함수는 그 앞단의 표시·안내용 계산이다.
 */
export function bundleVacancy(components: readonly SlotState[]): number | null {
  const finite = components.map(vacancy).filter((v): v is number => v !== null);
  // 전 구성품이 무제한이면 번들도 무제한이다.
  if (finite.length === 0) return null;
  return Math.min(...finite);
}

/** 번들 컷오프는 가장 빨리 닫히는 구성품을 따른다 = 컷오프 분(minutes)의 최댓값. */
export function bundleCutoffMinutes(componentCutoffMinutes: readonly number[]): number {
  if (componentCutoffMinutes.length === 0) return 0;
  return Math.max(...componentCutoffMinutes);
}
