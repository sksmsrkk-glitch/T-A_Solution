import { CurrencyMismatchError, InvalidMoneyError } from './errors.js';

/**
 * 금액 = 정수 최소단위(minor unit) + 통화 코드 — INV-10
 *
 * 부동소수를 쓰지 않는 이유: 커미션 공제(15~35%)와 부분 환불이 반복되면
 * 0.1 + 0.2 ≠ 0.3 수준의 오차가 정산 대사에서 분쟁이 된다.
 * 이 모듈 밖에서 금액을 number 로 직접 연산하지 않는다.
 */

/** 최소단위 자릿수. KRW·JPY 는 소수점이 없어 minor unit = major unit 이다. */
export const CURRENCY_MINOR_UNITS = {
  KRW: 0,
  JPY: 0,
  USD: 2,
  EUR: 2,
  SGD: 2,
  HKD: 2,
  TWD: 2,
  CNY: 2,
} as const;

export type CurrencyCode = keyof typeof CURRENCY_MINOR_UNITS;

export interface Money {
  /** 최소단위 정수. KRW 70000 = 70,000원 / USD 1050 = $10.50 */
  readonly amount: number;
  readonly currency: CurrencyCode;
}

/**
 * 반올림 방식은 호출자가 반드시 명시한다.
 * 기본값을 두면 "어느 규칙으로 깎인 금액인지" 추적이 불가능해진다(Rule #9).
 */
export type Rounding = 'HALF_UP' | 'DOWN' | 'UP';

/**
 * 비율은 정수 분수로 표현한다. 15% = { numerator: 15, denominator: 100 }
 * 0.15 같은 부동소수를 받지 않는 이유는 INV-10 과 같다.
 */
export interface Rate {
  readonly numerator: number;
  readonly denominator: number;
}

export function money(amount: number, currency: CurrencyCode): Money {
  if (!Number.isSafeInteger(amount)) {
    throw new InvalidMoneyError(
      `금액은 안전한 정수(minor unit)여야 합니다: ${String(amount)} ${currency} — INV-10`,
    );
  }
  return { amount, currency };
}

export function zero(currency: CurrencyCode): Money {
  return { amount: 0, currency };
}

export function isZero(m: Money): boolean {
  return m.amount === 0;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

/** 수량 배수 — 인원 수 등 정수 배수에만 사용한다. 비율 계산은 applyRate 를 쓸 것. */
export function multiply(m: Money, factor: number): Money {
  if (!Number.isSafeInteger(factor)) {
    throw new InvalidMoneyError(
      `배수는 정수여야 합니다: ${String(factor)} — 비율은 applyRate 사용`,
    );
  }
  return money(m.amount * factor, m.currency);
}

/** a 와 b 를 비교. a<b 면 음수, 같으면 0, a>b 면 양수. */
export function compare(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.amount - b.amount;
}

/**
 * 비율 적용 (커미션 공제·부분 환불 등).
 *
 * 정수 나눗셈의 몫과 나머지를 직접 다뤄 부동소수를 완전히 배제한다.
 * 반올림은 0 에서 먼 쪽(away from zero)을 기준으로 하므로, 음수 금액(환불)에서도
 * 대칭적으로 동작한다.
 */
export function applyRate(m: Money, rate: Rate, rounding: Rounding): Money {
  const { numerator, denominator } = rate;

  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new InvalidMoneyError('비율의 분자·분모는 정수여야 합니다 — INV-10');
  }
  if (denominator === 0) {
    throw new InvalidMoneyError('비율의 분모는 0 일 수 없습니다');
  }

  const product = m.amount * numerator;
  if (!Number.isSafeInteger(product)) {
    throw new InvalidMoneyError(
      `비율 계산이 안전한 정수 범위를 벗어났습니다: ${String(m.amount)} × ${String(numerator)}`,
    );
  }

  const quotient = Math.trunc(product / denominator);
  const remainder = product - quotient * denominator;

  if (remainder === 0) return money(quotient, m.currency);

  const awayFromZero = Math.sign(product) * Math.sign(denominator);

  switch (rounding) {
    case 'DOWN':
      return money(quotient, m.currency);
    case 'UP':
      return money(quotient + awayFromZero, m.currency);
    case 'HALF_UP':
      return money(
        Math.abs(remainder) * 2 >= Math.abs(denominator) ? quotient + awayFromZero : quotient,
        m.currency,
      );
  }
}
