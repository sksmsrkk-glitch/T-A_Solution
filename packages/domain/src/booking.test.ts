import { describe, expect, it } from 'vitest';

import {
  BOOKING_TRANSITIONS,
  canTransition,
  isTerminal,
  transition,
  type BookingSnapshot,
  type BookingStatus,
} from './booking.js';
import { IllegalTransitionError, TransitionGuardError } from './errors.js';
import { parseLocalDate } from './localtime.js';

const ALL_STATUSES = Object.keys(BOOKING_TRANSITIONS) as BookingStatus[];

const booking = (over: Partial<BookingSnapshot> = {}): BookingSnapshot => ({
  status: 'ON_HOLD',
  holdExpiresAt: new Date('2026-08-05T10:00:00.000Z'),
  serviceDate: parseLocalDate('2026-08-20'),
  ...over,
});

const NOW = new Date('2026-08-05T09:00:00.000Z');

describe('전이표 — docs/03 §3.1 (INV-7)', () => {
  it('should_allow_only_documented_transitions_from_on_hold', () => {
    expect([...BOOKING_TRANSITIONS.ON_HOLD]).toEqual([
      'ON_HOLD',
      'CONFIRMED',
      'PENDING',
      'EXPIRED',
      'CANCELLED',
    ]);
  });

  it('should_treat_end_states_as_terminal', () => {
    for (const s of ['REJECTED', 'EXPIRED', 'CANCELLED', 'REDEEMED', 'NO_SHOW'] as const) {
      expect(isTerminal(s)).toBe(true);
    }
    for (const s of ['ON_HOLD', 'PENDING', 'CONFIRMED'] as const) {
      expect(isTerminal(s)).toBe(false);
    }
  });

  it('should_reject_every_transition_out_of_terminal_states', () => {
    // 리딤된 예약이 다시 확정되거나, 취소된 예약이 되살아나는 경로가 없어야 한다.
    const terminals: BookingStatus[] = ['REJECTED', 'EXPIRED', 'CANCELLED', 'REDEEMED', 'NO_SHOW'];
    for (const from of terminals) {
      for (const to of ALL_STATUSES) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it('should_reject_undocumented_transitions_exhaustively', () => {
    // 전이표에 명시되지 않은 모든 조합이 실제로 막히는지 전수 확인한다.
    for (const from of ALL_STATUSES) {
      const allowed = new Set<BookingStatus>(BOOKING_TRANSITIONS[from]);
      for (const to of ALL_STATUSES) {
        expect(canTransition(from, to)).toBe(allowed.has(to));
      }
    }
  });

  it('should_reject_redeem_from_pending', () => {
    // 미확정 예약이 현장에서 리딤되는 사고를 막는다.
    expect(canTransition('PENDING', 'REDEEMED')).toBe(false);
    expect(canTransition('CONFIRMED', 'REDEEMED')).toBe(true);
  });
});

describe('transition — 로그를 남기지 않는 상태 변경은 없다 (INV-7)', () => {
  it('should_return_new_status_with_audit_log', () => {
    const result = transition(booking(), {
      to: 'CONFIRMED',
      actorType: 'CHANNEL_API',
      actorId: 'KLOOK',
      reason: 'instant confirmation',
      now: NOW,
    });

    expect(result.status).toBe('CONFIRMED');
    expect(result.log).toEqual({
      from: 'ON_HOLD',
      to: 'CONFIRMED',
      actorType: 'CHANNEL_API',
      actorId: 'KLOOK',
      reason: 'instant confirmation',
      occurredAt: NOW,
    });
  });

  it('should_default_actor_and_reason_to_null', () => {
    const result = transition(booking({ status: 'CONFIRMED' }), {
      to: 'NO_SHOW',
      actorType: 'SYSTEM_BATCH',
      now: NOW,
    });
    expect(result.log.actorId).toBeNull();
    expect(result.log.reason).toBeNull();
  });

  it('should_throw_illegal_transition_for_undocumented_move', () => {
    expect(() =>
      transition(booking({ status: 'REDEEMED' }), {
        to: 'CONFIRMED',
        actorType: 'USER',
        now: NOW,
      }),
    ).toThrow(IllegalTransitionError);
  });
});

describe('가드 — 전이표는 통과하지만 상황이 막는 경우', () => {
  it('should_reject_confirming_an_expired_hold', () => {
    // 만료 배치가 아직 돌지 않았어도 확정을 허용하면,
    // 이미 남에게 팔린 재고를 다시 확정해 오버부킹이 된다.
    expect(() =>
      transition(booking({ holdExpiresAt: new Date('2026-08-05T08:00:00.000Z') }), {
        to: 'CONFIRMED',
        actorType: 'CHANNEL_API',
        now: NOW,
      }),
    ).toThrow(TransitionGuardError);
  });

  it('should_treat_exact_expiry_moment_as_expired', () => {
    expect(() =>
      transition(booking({ holdExpiresAt: NOW }), {
        to: 'CONFIRMED',
        actorType: 'USER',
        now: NOW,
      }),
    ).toThrow(TransitionGuardError);
  });

  it('should_reject_extending_an_expired_hold', () => {
    expect(() =>
      transition(booking({ holdExpiresAt: new Date('2026-08-05T08:00:00.000Z') }), {
        to: 'ON_HOLD',
        actorType: 'CHANNEL_API',
        now: NOW,
      }),
    ).toThrow(TransitionGuardError);
  });

  it('should_allow_extending_a_live_hold', () => {
    expect(
      transition(booking(), { to: 'ON_HOLD', actorType: 'CHANNEL_API', now: NOW }).status,
    ).toBe('ON_HOLD');
  });

  it('should_allow_expiring_an_expired_hold', () => {
    // 만료 배치는 만료된 홀드를 처리할 수 있어야 한다 — 가드가 배치를 막으면
    // 재고가 영구 점유된다.
    expect(
      transition(booking({ holdExpiresAt: new Date('2026-08-05T08:00:00.000Z') }), {
        to: 'EXPIRED',
        actorType: 'SYSTEM_BATCH',
        now: NOW,
      }).status,
    ).toBe('EXPIRED');
  });

  it('should_reject_cancelling_a_past_booking', () => {
    // GYG BOOKING_IN_PAST 준용 — docs/03 §3.1
    expect(() =>
      transition(booking({ status: 'CONFIRMED', serviceDate: parseLocalDate('2026-08-01') }), {
        to: 'CANCELLED',
        actorType: 'USER',
        now: NOW,
        today: parseLocalDate('2026-08-05'),
      }),
    ).toThrow(TransitionGuardError);
  });

  it('should_allow_cancelling_on_the_service_date', () => {
    expect(
      transition(booking({ status: 'CONFIRMED', serviceDate: parseLocalDate('2026-08-05') }), {
        to: 'CANCELLED',
        actorType: 'USER',
        now: NOW,
        today: parseLocalDate('2026-08-05'),
      }).status,
    ).toBe('CANCELLED');
  });

  it('should_skip_past_guard_when_today_is_not_supplied', () => {
    // 배치성 정리 작업은 오늘 기준 가드 없이 취소할 수 있어야 한다.
    expect(
      transition(booking({ status: 'CONFIRMED', serviceDate: parseLocalDate('2020-01-01') }), {
        to: 'CANCELLED',
        actorType: 'SYSTEM_BATCH',
        now: NOW,
      }).status,
    ).toBe('CANCELLED');
  });

  it('should_allow_cancelling_from_on_hold_and_pending', () => {
    // docs/03 §3.1 취소 가드: CONFIRMED / PENDING / ON_HOLD 에서 허용
    for (const status of ['ON_HOLD', 'PENDING', 'CONFIRMED'] as const) {
      expect(
        transition(booking({ status }), { to: 'CANCELLED', actorType: 'USER', now: NOW }).status,
      ).toBe('CANCELLED');
    }
  });
});
