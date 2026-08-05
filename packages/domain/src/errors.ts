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
