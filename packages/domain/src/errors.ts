/**
 * 도메인 에러 기반 클래스.
 *
 * 도메인 계층은 HTTP 를 모른다(Rule #10). 상태 코드 매핑은 앱 계층의 예외 필터가
 * `code` 를 보고 수행한다. 여기서 HttpException 을 던지지 않는 이유다.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** 금액 값이 도메인 규칙(정수 minor unit)을 위반 — INV-10 */
export class InvalidMoneyError extends DomainError {
  readonly code = 'INVALID_MONEY';
}

/** 서로 다른 통화끼리 연산 시도. 환산은 도메인 밖(환율 서비스)의 책임이다. */
export class CurrencyMismatchError extends DomainError {
  readonly code = 'CURRENCY_MISMATCH';

  constructor(
    readonly left: string,
    readonly right: string,
  ) {
    super(`통화가 다릅니다: ${left} ≠ ${right}. 환산 후 연산하십시오.`);
  }
}

/** 로컬 날짜·시각·타임존 형식 위반 — INV-8 */
export class InvalidLocalTimeError extends DomainError {
  readonly code = 'INVALID_LOCAL_TIME';
}

/**
 * 적용 가능한 가격 룰이 하나도 없음 — INV-4
 *
 * 0원으로 넘어가지 않고 반드시 실패시킨다. 가격 없는 판매는 매출 누락이자
 * 정산 분쟁이며, 조용히 통과하면 발견이 몇 달 뒤로 밀린다.
 */
export class NoPriceRuleError extends DomainError {
  readonly code = 'NO_PRICE_RULE';
}

/** 전이표에 없는 예약 상태 전이 시도 — INV-7 */
export class IllegalTransitionError extends DomainError {
  readonly code = 'ILLEGAL_TRANSITION';

  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`허용되지 않은 상태 전이입니다: ${from} → ${to} — INV-7`);
  }
}

/** 전이는 표에 있으나 가드 조건 미충족 (홀드 만료·과거 이용일 등) — INV-7 */
export class TransitionGuardError extends DomainError {
  readonly code = 'TRANSITION_GUARD_FAILED';

  constructor(
    readonly guard: string,
    message: string,
  ) {
    super(message);
  }
}
