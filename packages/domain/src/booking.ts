import { IllegalTransitionError, TransitionGuardError } from './errors.js';
import type { LocalDate } from './localtime.js';

/**
 * 예약 상태머신 — INV-7 / docs/03 §3.1
 *
 * 상태 변경은 이 모듈을 통해서만 일어나고, 모든 전이는 로그를 남긴다.
 * 여기저기서 status 를 직접 UPDATE 하면 "이 예약이 왜 취소됐는지"를
 * 프로덕션에서 재구성할 수 없다.
 */

export type BookingStatus =
  | 'ON_HOLD'
  | 'PENDING'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REDEEMED'
  | 'NO_SHOW';

/**
 * 허용 전이표 (docs/03 §3.1).
 *
 * - `ON_HOLD → ON_HOLD` 는 홀드 연장(extend)이다.
 * - `ON_HOLD → CANCELLED` 는 release, `PENDING → CANCELLED` 는 §3.1 취소 가드
 *   ("CONFIRMED/PENDING/ON_HOLD 일 때만")에 따라 허용된다.
 * - REJECTED·EXPIRED·CANCELLED·REDEEMED·NO_SHOW 는 종단 상태다.
 */
export const BOOKING_TRANSITIONS = {
  ON_HOLD: ['ON_HOLD', 'CONFIRMED', 'PENDING', 'EXPIRED', 'CANCELLED'],
  PENDING: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
  CONFIRMED: ['REDEEMED', 'CANCELLED', 'NO_SHOW'],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
  REDEEMED: [],
  NO_SHOW: [],
} as const satisfies Record<BookingStatus, readonly BookingStatus[]>;

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return (BOOKING_TRANSITIONS[from] as readonly BookingStatus[]).includes(to);
}

export function isTerminal(status: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[status].length === 0;
}

export type ActorType = 'USER' | 'CHANNEL_API' | 'SYSTEM_BATCH';

/** docs/03 §2.4 BookingLog — 감사 이력 1건 */
export interface BookingLogEntry {
  readonly from: BookingStatus;
  readonly to: BookingStatus;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly reason: string | null;
  readonly occurredAt: Date;
}

export interface BookingSnapshot {
  readonly status: BookingStatus;
  /** 홀드 만료 시각. ON_HOLD 가 아니면 null */
  readonly holdExpiresAt: Date | null;
  /** 이용일 — 과거 예약 취소 가드에 쓰인다 */
  readonly serviceDate: LocalDate;
}

export interface TransitionCommand {
  readonly to: BookingStatus;
  readonly actorType: ActorType;
  readonly actorId?: string | null;
  readonly reason?: string | null;
  /** 판정 기준 시각. 도메인은 시계를 직접 읽지 않는다(테스트 가능성). */
  readonly now: Date;
  /** 취소 가드용 — 시설 로컬 기준 오늘 날짜 */
  readonly today?: LocalDate;
}

export interface TransitionResult {
  readonly status: BookingStatus;
  readonly log: BookingLogEntry;
}

/**
 * 상태 전이 실행 — 전이표 검사 → 가드 검사 → 로그 생성.
 *
 * 전이표에 없으면 IllegalTransitionError, 표에는 있으나 조건이 안 맞으면
 * TransitionGuardError 로 구분해 던진다. 프로덕션에서 "규칙상 불가"와
 * "지금 상황상 불가"는 대응이 다르기 때문이다.
 */
export function transition(booking: BookingSnapshot, command: TransitionCommand): TransitionResult {
  const { status: from } = booking;
  const { to, now } = command;

  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);

  applyGuards(booking, command);

  return {
    status: to,
    log: {
      from,
      to,
      actorType: command.actorType,
      actorId: command.actorId ?? null,
      reason: command.reason ?? null,
      occurredAt: now,
    },
  };
}

function applyGuards(booking: BookingSnapshot, command: TransitionCommand): void {
  const { status: from, holdExpiresAt, serviceDate } = booking;
  const { to, now, today } = command;

  // confirm 가드: 만료된 홀드는 확정할 수 없다 (docs/03 §3.1).
  // 만료 배치가 아직 돌지 않은 상태에서 확정을 허용하면, 이미 남에게 팔린
  // 재고를 다시 확정해 오버부킹이 된다.
  const isConfirmingHold = from === 'ON_HOLD' && (to === 'CONFIRMED' || to === 'PENDING');
  if (isConfirmingHold && holdExpiresAt !== null && now.getTime() >= holdExpiresAt.getTime()) {
    throw new TransitionGuardError(
      'HOLD_EXPIRED',
      `홀드가 이미 만료되었습니다 (만료: ${holdExpiresAt.toISOString()}) — 재예약이 필요합니다`,
    );
  }

  // 홀드 연장은 만료 전에만 의미가 있다.
  if (from === 'ON_HOLD' && to === 'ON_HOLD') {
    if (holdExpiresAt !== null && now.getTime() >= holdExpiresAt.getTime()) {
      throw new TransitionGuardError(
        'HOLD_EXPIRED',
        '만료된 홀드는 연장할 수 없습니다 — 재예약이 필요합니다',
      );
    }
  }

  // cancel 가드: 이용일이 지난 예약은 취소 대상이 아니다
  // (GYG BOOKING_IN_PAST 준용 — docs/03 §3.1).
  // today 를 넘기지 않으면 이 가드는 검사하지 않는다(배치성 정리 작업 등).
  if (to === 'CANCELLED' && today !== undefined && serviceDate < today) {
    throw new TransitionGuardError(
      'BOOKING_IN_PAST',
      `이용일이 지난 예약은 취소할 수 없습니다 (이용일: ${serviceDate}, 오늘: ${today})`,
    );
  }
}
