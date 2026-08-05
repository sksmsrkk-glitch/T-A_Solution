import { describe, expect, it } from 'vitest';

import { CurrencyMismatchError, InvalidMoneyError } from './errors.js';
import { add, applyRate, compare, isZero, money, multiply, subtract, zero } from './money.js';

describe('Money — 금액은 정수 minor unit (INV-10)', () => {
  it('should_reject_non_integer_amount', () => {
    // 부동소수 금액이 들어오는 순간 정산 대사에서 추적 불가능한 오차가 시작된다.
    expect(() => money(1000.5, 'KRW')).toThrow(InvalidMoneyError);
  });

  it('should_reject_unsafe_integer_amount', () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, 'KRW')).toThrow(InvalidMoneyError);
  });

  it('should_accept_negative_amount_for_refund', () => {
    // 환불·조정 라인은 음수로 표현된다.
    expect(money(-5000, 'KRW').amount).toBe(-5000);
  });

  it('should_reject_arithmetic_across_currencies', () => {
    // 환산은 환율 서비스의 책임이지 도메인 연산이 아니다.
    expect(() => add(money(1000, 'KRW'), money(10, 'USD'))).toThrow(CurrencyMismatchError);
  });

  it('should_add_and_subtract', () => {
    expect(add(money(70_000, 'KRW'), money(60_000, 'KRW'))).toEqual(money(130_000, 'KRW'));
    expect(subtract(money(70_000, 'KRW'), money(60_000, 'KRW'))).toEqual(money(10_000, 'KRW'));
  });

  it('should_multiply_by_integer_quantity_only', () => {
    // 난타 S석 60,000원 × 3매
    expect(multiply(money(60_000, 'KRW'), 3)).toEqual(money(180_000, 'KRW'));
    expect(() => multiply(money(60_000, 'KRW'), 0.85)).toThrow(InvalidMoneyError);
  });

  it('should_compare', () => {
    expect(compare(money(1, 'KRW'), money(2, 'KRW'))).toBeLessThan(0);
    expect(compare(money(2, 'KRW'), money(2, 'KRW'))).toBe(0);
    expect(compare(money(3, 'KRW'), money(2, 'KRW'))).toBeGreaterThan(0);
  });

  it('should_expose_zero', () => {
    expect(zero('USD')).toEqual({ amount: 0, currency: 'USD' });
    expect(isZero(zero('USD'))).toBe(true);
    expect(isZero(money(-1, 'USD'))).toBe(false);
  });
});

describe('applyRate — 커미션·환불 비율 계산에 부동소수를 쓰지 않는다', () => {
  const commission20 = { numerator: 20, denominator: 100 };

  it('should_compute_exact_commission_without_remainder', () => {
    // 판매가 70,000원 × 20% = 14,000원
    expect(applyRate(money(70_000, 'KRW'), commission20, 'HALF_UP')).toEqual(money(14_000, 'KRW'));
  });

  it('should_round_half_up_away_from_zero', () => {
    // 1,005 × 50% = 502.5 → 503
    const half = { numerator: 50, denominator: 100 };
    expect(applyRate(money(1005, 'KRW'), half, 'HALF_UP')).toEqual(money(503, 'KRW'));
    expect(applyRate(money(1005, 'KRW'), half, 'DOWN')).toEqual(money(502, 'KRW'));
    expect(applyRate(money(1005, 'KRW'), half, 'UP')).toEqual(money(503, 'KRW'));
  });

  it('should_round_symmetrically_for_negative_amounts', () => {
    // 환불 라인(음수)에서도 절댓값 기준으로 동일하게 반올림되어야
    // 결제와 환불의 합이 0 으로 떨어진다.
    const half = { numerator: 50, denominator: 100 };
    expect(applyRate(money(-1005, 'KRW'), half, 'HALF_UP')).toEqual(money(-503, 'KRW'));
    expect(applyRate(money(-1005, 'KRW'), half, 'DOWN')).toEqual(money(-502, 'KRW'));
    expect(applyRate(money(-1001, 'KRW'), half, 'UP')).toEqual(money(-501, 'KRW'));
  });

  it('should_never_produce_floating_point_drift', () => {
    // 0.1 + 0.2 문제의 도메인 버전: 33.33% 를 3번 적용해도 정수만 남는다.
    const third = { numerator: 3333, denominator: 10_000 };
    for (const base of [1, 7, 999, 100_000, 123_457]) {
      const result = applyRate(money(base, 'KRW'), third, 'HALF_UP');
      expect(Number.isInteger(result.amount)).toBe(true);
    }
  });

  it('should_reject_fractional_rate', () => {
    // 0.15 같은 부동소수 비율을 받으면 INV-10 이 무의미해진다.
    // 15% 는 { numerator: 15, denominator: 100 } 으로 표현해야 한다.
    expect(() => applyRate(money(100, 'KRW'), { numerator: 0.15, denominator: 1 }, 'DOWN')).toThrow(
      InvalidMoneyError,
    );
    expect(() => applyRate(money(100, 'KRW'), { numerator: 1, denominator: 3.5 }, 'DOWN')).toThrow(
      InvalidMoneyError,
    );
  });

  it('should_reject_zero_denominator', () => {
    expect(() => applyRate(money(100, 'KRW'), { numerator: 1, denominator: 0 }, 'DOWN')).toThrow(
      InvalidMoneyError,
    );
  });

  it('should_reject_overflow', () => {
    expect(() =>
      applyRate(money(Number.MAX_SAFE_INTEGER, 'KRW'), { numerator: 2, denominator: 1 }, 'DOWN'),
    ).toThrow(InvalidMoneyError);
  });
});
