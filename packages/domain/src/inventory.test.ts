import { describe, expect, it } from 'vitest';

import {
  bundleCutoffMinutes,
  bundleVacancy,
  isCutoffPassed,
  isSoldOut,
  precheckHold,
  vacancy,
  type SlotState,
} from './inventory.js';
import { parseLocalDate, parseLocalTime, parseTimeZone } from './localtime.js';

const SEOUL = parseTimeZone('Asia/Seoul');

const slot = (over: Partial<SlotState> = {}): SlotState => ({
  capacity: 10,
  bookedCount: 0,
  heldCount: 0,
  status: 'OPEN',
  ...over,
});

/** docs/07 §T1 에버랜드 — 무제한 재고 */
const freesaleSlot = (over: Partial<SlotState> = {}): SlotState =>
  slot({ capacity: null, ...over });

describe('vacancy / isSoldOut — capacity NULL 은 무제한 (INV-1)', () => {
  it('should_compute_vacancy_as_capacity_minus_booked_and_held', () => {
    expect(vacancy(slot({ capacity: 10, bookedCount: 3, heldCount: 2 }))).toBe(5);
  });

  it('should_return_null_vacancy_for_unlimited_slot', () => {
    // null 은 "0" 이 아니라 "무제한"이다. 호출부가 ?? 0 으로 뭉개면
    // 에버랜드 종일권 같은 무한재고 상품이 전량 매진된다.
    expect(vacancy(freesaleSlot({ bookedCount: 999_999 }))).toBeNull();
  });

  it('should_never_mark_unlimited_slot_as_sold_out', () => {
    expect(isSoldOut(freesaleSlot({ bookedCount: 10_000_000 }))).toBe(false);
  });

  it('should_mark_sold_out_when_vacancy_reaches_zero', () => {
    expect(isSoldOut(slot({ capacity: 10, bookedCount: 8, heldCount: 2 }))).toBe(true);
    expect(isSoldOut(slot({ capacity: 10, bookedCount: 8, heldCount: 1 }))).toBe(false);
  });

  it('should_treat_oversold_state_as_sold_out', () => {
    // 데이터가 어긋나 음수가 되어도 판매 가능으로 보이면 안 된다.
    expect(isSoldOut(slot({ capacity: 10, bookedCount: 12, heldCount: 0 }))).toBe(true);
  });
});

describe('precheckHold — 자문용 사전 점검 (최종 판정은 DB 조건부 UPDATE)', () => {
  it('should_reject_non_positive_or_fractional_quantity', () => {
    expect(precheckHold({ slot: slot(), quantity: 0 })).toEqual({
      ok: false,
      reason: 'INVALID_QUANTITY',
    });
    expect(precheckHold({ slot: slot(), quantity: 1.5 })).toEqual({
      ok: false,
      reason: 'INVALID_QUANTITY',
    });
  });

  it('should_reject_blocked_out_slot_regardless_of_vacancy', () => {
    // docs/07 §T1 재고 2 — 블록아웃은 잔여와 무관하게 판매를 막는다.
    expect(precheckHold({ slot: freesaleSlot({ status: 'CLOSED' }), quantity: 1 })).toEqual({
      ok: false,
      reason: 'SLOT_CLOSED',
    });
  });

  it('should_allow_hold_on_unlimited_slot', () => {
    expect(precheckHold({ slot: freesaleSlot(), quantity: 5000 })).toEqual({ ok: true });
  });

  it('should_reject_when_requested_exceeds_vacancy', () => {
    const s = slot({ capacity: 10, bookedCount: 8, heldCount: 1 }); // 잔여 1
    expect(precheckHold({ slot: s, quantity: 2 })).toEqual({ ok: false, reason: 'SOLD_OUT' });
    expect(precheckHold({ slot: s, quantity: 1 })).toEqual({ ok: true });
  });

  it('should_enforce_min_and_max_units', () => {
    // docs/07 §A3 최소 인원 클래스
    expect(precheckHold({ slot: slot(), quantity: 1, minUnits: 2 })).toEqual({
      ok: false,
      reason: 'BELOW_MIN_UNITS',
    });
    expect(precheckHold({ slot: slot(), quantity: 9, maxUnits: 8 })).toEqual({
      ok: false,
      reason: 'ABOVE_MAX_UNITS',
    });
  });

  it('should_reject_after_cutoff', () => {
    // docs/07 §S1 난타 — 회차 2시간 전 마감
    const cutoff = {
      localDate: parseLocalDate('2026-08-05'),
      localStartTime: parseLocalTime('20:00'),
      timeZone: SEOUL,
      cutoffMinutes: 120,
      now: new Date('2026-08-05T09:30:00.000Z'), // KST 18:30 — 마감 30분 경과
    };
    expect(precheckHold({ slot: slot(), quantity: 1, cutoff })).toEqual({
      ok: false,
      reason: 'CUTOFF_PASSED',
    });
  });
});

describe('isCutoffPassed — 시설 타임존 기준 (INV-8)', () => {
  const base = {
    localDate: parseLocalDate('2026-08-05'),
    localStartTime: parseLocalTime('20:00'),
    timeZone: SEOUL,
    cutoffMinutes: 120,
  };

  it('should_not_pass_before_deadline', () => {
    // KST 17:59 — 마감(18:00) 1분 전
    expect(isCutoffPassed({ ...base, now: new Date('2026-08-05T08:59:00.000Z') })).toBe(false);
  });

  it('should_pass_exactly_at_deadline', () => {
    // 경계는 마감으로 취급한다 — 애매한 1초에 팔리는 것보다 낫다.
    expect(isCutoffPassed({ ...base, now: new Date('2026-08-05T09:00:00.000Z') })).toBe(true);
  });

  it('should_use_facility_timezone_not_server_time', () => {
    // 같은 UTC 순간이라도 시설 타임존이 다르면 마감 여부가 갈린다.
    const seoulResult = isCutoffPassed({ ...base, now: new Date('2026-08-05T08:00:00.000Z') });
    const nyResult = isCutoffPassed({
      ...base,
      timeZone: parseTimeZone('America/New_York'),
      now: new Date('2026-08-05T08:00:00.000Z'),
    });
    expect(seoulResult).toBe(false); // KST 17:00, 마감 18:00 → 아직
    expect(nyResult).toBe(false); // EDT 04:00, 마감은 같은 날 18:00 EDT → 아직
    expect(
      isCutoffPassed({
        ...base,
        timeZone: parseTimeZone('America/New_York'),
        now: new Date('2026-08-06T00:00:00.000Z'), // EDT 20:00 — 마감 경과
      }),
    ).toBe(true);
  });

  it('should_use_midnight_for_date_only_slot', () => {
    // OPENING_HOURS·FREESALE 은 이용일 00:00 기준으로 마감을 계산한다.
    const dateOnly = { ...base, localStartTime: null, cutoffMinutes: 60 };
    // KST 2026-08-04 22:59 → 마감(2026-08-04 23:00 KST) 직전
    expect(isCutoffPassed({ ...dateOnly, now: new Date('2026-08-04T13:59:00.000Z') })).toBe(false);
    expect(isCutoffPassed({ ...dateOnly, now: new Date('2026-08-04T14:00:00.000Z') })).toBe(true);
  });
});

describe('번들 — 가용성 = min(구성품), 컷오프 = max(구성품) (INV-9 / docs/07 §B1)', () => {
  it('should_take_min_vacancy_across_components', () => {
    // 에버랜드 티켓(무제한) + 셔틀(잔여 4) + 밀쿠폰(잔여 20) → 번들 잔여 4
    expect(
      bundleVacancy([
        { capacity: null, bookedCount: 0, heldCount: 0, status: 'OPEN' },
        { capacity: 10, bookedCount: 6, heldCount: 0, status: 'OPEN' },
        { capacity: 30, bookedCount: 10, heldCount: 0, status: 'OPEN' },
      ]),
    ).toBe(4);
  });

  it('should_return_unlimited_only_when_every_component_is_unlimited', () => {
    expect(
      bundleVacancy([
        { capacity: null, bookedCount: 0, heldCount: 0, status: 'OPEN' },
        { capacity: null, bookedCount: 0, heldCount: 0, status: 'OPEN' },
      ]),
    ).toBeNull();
    expect(bundleVacancy([])).toBeNull();
  });

  it('should_take_max_cutoff_across_components', () => {
    // 가장 빨리 닫히는 구성품이 번들 전체를 닫는다.
    expect(bundleCutoffMinutes([60, 120, 30])).toBe(120);
    expect(bundleCutoffMinutes([])).toBe(0);
  });
});
