import { describe, expect, it } from 'vitest';

import { NoPriceRuleError } from './errors.js';
import { parseLocalDate, parseLocalTime } from './localtime.js';
import { money } from './money.js';
import {
  buildPriceSnapshot,
  PRICE_SCOPE_PRIORITY,
  resolvePrice,
  type PriceContext,
  type PriceRule,
} from './pricing.js';

const rule = (over: Partial<PriceRule> & Pick<PriceRule, 'id' | 'scope'>): PriceRule => ({
  channelId: null,
  dateFrom: null,
  dateTo: null,
  daysOfWeek: null,
  timeFrom: null,
  timeTo: null,
  tierMin: null,
  tierMax: null,
  retailPrice: money(46_000, 'KRW'),
  netPrice: null,
  ...over,
});

const ctx = (over: Partial<PriceContext> = {}): PriceContext => ({
  serviceDate: parseLocalDate('2026-08-05'), // 수요일
  startTime: null,
  channelId: null,
  totalQuantity: 2,
  ...over,
});

describe('우선순위 — 특정일 > 시간대 > 채널+요일 > 요일 > 시즌 > 기본 (INV-4)', () => {
  it('should_declare_priority_order_from_docs', () => {
    expect([...PRICE_SCOPE_PRIORITY]).toEqual([
      'SPECIFIC_DATE',
      'TIME_BAND',
      'CHANNEL_DOW',
      'DOW',
      'SEASON',
      'BASE',
    ]);
  });

  it('should_pick_specific_date_over_all_others', () => {
    // 6개 스코프가 전부 매칭될 때 특정일 룰이 이긴다.
    const rules: PriceRule[] = [
      rule({ id: 'base', scope: 'BASE' }),
      rule({
        id: 'season',
        scope: 'SEASON',
        dateFrom: parseLocalDate('2026-07-01'),
        dateTo: parseLocalDate('2026-08-31'),
      }),
      rule({ id: 'dow', scope: 'DOW', daysOfWeek: [3] }),
      rule({ id: 'channelDow', scope: 'CHANNEL_DOW', channelId: 'KLOOK', daysOfWeek: [3] }),
      rule({ id: 'band', scope: 'TIME_BAND', timeFrom: parseLocalTime('09:00') }),
      rule({
        id: 'specific',
        scope: 'SPECIFIC_DATE',
        dateFrom: parseLocalDate('2026-08-05'),
        dateTo: parseLocalDate('2026-08-05'),
      }),
    ];

    expect(
      resolvePrice(rules, ctx({ channelId: 'KLOOK', startTime: parseLocalTime('10:00') })).ruleId,
    ).toBe('specific');
  });

  it('should_fall_through_priority_levels_in_order', () => {
    const all: PriceRule[] = [
      rule({ id: 'base', scope: 'BASE' }),
      rule({
        id: 'season',
        scope: 'SEASON',
        dateFrom: parseLocalDate('2026-07-01'),
        dateTo: parseLocalDate('2026-08-31'),
      }),
      rule({ id: 'dow', scope: 'DOW', daysOfWeek: [3] }),
      rule({ id: 'channelDow', scope: 'CHANNEL_DOW', channelId: 'KLOOK', daysOfWeek: [3] }),
      rule({ id: 'band', scope: 'TIME_BAND', timeFrom: parseLocalTime('09:00') }),
    ];
    const context = ctx({ channelId: 'KLOOK', startTime: parseLocalTime('10:00') });

    // 상위 스코프를 하나씩 제거하며 다음 순위로 정확히 내려가는지 확인
    const expected = ['band', 'channelDow', 'dow', 'season', 'base'];
    let remaining = all;
    for (const id of expected) {
      expect(resolvePrice(remaining, context).ruleId).toBe(id);
      remaining = remaining.filter((r) => r.id !== id);
    }
  });
});

describe('룰 매칭 조건', () => {
  it('should_not_apply_channel_rule_to_other_channels', () => {
    // docs/07 §T1 가격 3 — Klook 평일 특가가 직판에 새면 안 된다.
    const rules = [
      rule({ id: 'klook', scope: 'CHANNEL_DOW', channelId: 'KLOOK', daysOfWeek: [3] }),
      rule({ id: 'base', scope: 'BASE' }),
    ];
    expect(resolvePrice(rules, ctx({ channelId: 'KLOOK' })).ruleId).toBe('klook');
    expect(resolvePrice(rules, ctx({ channelId: 'DIRECT' })).ruleId).toBe('base');
    expect(resolvePrice(rules, ctx({ channelId: null })).ruleId).toBe('base');
  });

  it('should_respect_date_range_boundaries_inclusively', () => {
    const rules = [
      rule({
        id: 'season',
        scope: 'SEASON',
        dateFrom: parseLocalDate('2026-08-05'),
        dateTo: parseLocalDate('2026-08-05'),
      }),
      rule({ id: 'base', scope: 'BASE' }),
    ];
    expect(resolvePrice(rules, ctx({ serviceDate: parseLocalDate('2026-08-05') })).ruleId).toBe(
      'season',
    );
    expect(resolvePrice(rules, ctx({ serviceDate: parseLocalDate('2026-08-06') })).ruleId).toBe(
      'base',
    );
    expect(resolvePrice(rules, ctx({ serviceDate: parseLocalDate('2026-08-04') })).ruleId).toBe(
      'base',
    );
  });

  it('should_treat_time_band_end_as_exclusive', () => {
    // docs/07 §T6 Burj Khalifa 프라임아워 — 09:00~12:00 룰에 12:00 회차는 미포함
    const rules = [
      rule({
        id: 'morning',
        scope: 'TIME_BAND',
        timeFrom: parseLocalTime('09:00'),
        timeTo: parseLocalTime('12:00'),
      }),
      rule({ id: 'base', scope: 'BASE' }),
    ];
    expect(resolvePrice(rules, ctx({ startTime: parseLocalTime('09:00') })).ruleId).toBe('morning');
    expect(resolvePrice(rules, ctx({ startTime: parseLocalTime('11:59') })).ruleId).toBe('morning');
    expect(resolvePrice(rules, ctx({ startTime: parseLocalTime('12:00') })).ruleId).toBe('base');
  });

  it('should_skip_time_band_rule_when_product_has_no_start_time', () => {
    // 오픈데이트·일자권 상품에 시간대 룰이 잘못 붙어도 적용되지 않아야 한다.
    const rules = [
      rule({ id: 'band', scope: 'TIME_BAND', timeFrom: parseLocalTime('09:00') }),
      rule({ id: 'base', scope: 'BASE' }),
    ];
    expect(resolvePrice(rules, ctx({ startTime: null })).ruleId).toBe('base');
  });

  it('should_not_apply_dow_rule_on_other_days', () => {
    // docs/07 §T1 — Klook 화·수·목 특가가 금요일에 새면 매출 손실이 조용히 발생한다.
    const rules = [
      rule({
        id: 'weekday',
        scope: 'DOW',
        daysOfWeek: [2, 3, 4],
        retailPrice: money(39_000, 'KRW'),
      }),
      rule({ id: 'base', scope: 'BASE' }),
    ];
    // 2026-08-05 수요일 → 적용
    expect(resolvePrice(rules, ctx({ serviceDate: parseLocalDate('2026-08-05') })).ruleId).toBe(
      'weekday',
    );
    // 2026-08-07 금요일 → 미적용
    expect(resolvePrice(rules, ctx({ serviceDate: parseLocalDate('2026-08-07') })).ruleId).toBe(
      'base',
    );
    // 2026-08-09 일요일 → 미적용
    expect(resolvePrice(rules, ctx({ serviceDate: parseLocalDate('2026-08-09') })).ruleId).toBe(
      'base',
    );
  });

  it('should_exclude_quantity_above_tier_max', () => {
    // 2~4인 구간 룰은 5인 예약에 적용되면 안 된다.
    const rules = [
      rule({ id: 'small', scope: 'BASE', tierMin: 2, tierMax: 4 }),
      rule({ id: 'base', scope: 'BASE' }),
    ];
    expect(resolvePrice(rules, ctx({ totalQuantity: 4 })).ruleId).toBe('small');
    expect(resolvePrice(rules, ctx({ totalQuantity: 5 })).ruleId).toBe('base');
  });

  it('should_apply_tier_rule_by_total_quantity', () => {
    // docs/07 §X1 그룹 계단가 — 8인 이상 인당 인하
    const rules = [
      rule({ id: 'group', scope: 'BASE', tierMin: 8, retailPrice: money(38_000, 'KRW') }),
      rule({ id: 'base', scope: 'BASE' }),
    ];
    expect(resolvePrice(rules, ctx({ totalQuantity: 8 })).ruleId).toBe('group');
    expect(resolvePrice(rules, ctx({ totalQuantity: 7 })).ruleId).toBe('base');
  });
});

describe('동일 순위 결정 규칙 — 항상 같은 답이 나와야 한다', () => {
  it('should_prefer_tier_rule_within_same_scope', () => {
    const rules = [
      rule({ id: 'zzz-plain', scope: 'BASE' }),
      rule({ id: 'aaa-tier', scope: 'BASE', tierMin: 1 }),
    ];
    expect(resolvePrice(rules, ctx()).ruleId).toBe('aaa-tier');
  });

  it('should_prefer_narrower_date_range_within_same_scope', () => {
    const rules = [
      rule({
        id: 'wide',
        scope: 'SEASON',
        dateFrom: parseLocalDate('2026-01-01'),
        dateTo: parseLocalDate('2026-12-31'),
      }),
      rule({
        id: 'narrow',
        scope: 'SEASON',
        dateFrom: parseLocalDate('2026-08-01'),
        dateTo: parseLocalDate('2026-08-31'),
      }),
    ];
    expect(resolvePrice(rules, ctx()).ruleId).toBe('narrow');
  });

  it('should_be_deterministic_regardless_of_input_order', () => {
    const a = rule({ id: 'aaa', scope: 'BASE' });
    const b = rule({ id: 'bbb', scope: 'BASE' });
    expect(resolvePrice([a, b], ctx()).ruleId).toBe(resolvePrice([b, a], ctx()).ruleId);
  });
});

describe('룰 부재 — 0원으로 넘어가지 않는다 (INV-4)', () => {
  it('should_throw_when_no_rule_matches', () => {
    expect(() => resolvePrice([], ctx())).toThrow(NoPriceRuleError);
    expect(() =>
      resolvePrice([rule({ id: 'other', scope: 'BASE', channelId: 'KKDAY' })], ctx()),
    ).toThrow(NoPriceRuleError);
  });
});

describe('buildPriceSnapshot — 예약 시점 스냅샷 (INV-3)', () => {
  // docs/07 §S1 난타 VIP 70,000 / S 60,000
  const vip = rule({ id: 'vip', scope: 'BASE', retailPrice: money(70_000, 'KRW') });
  const s = rule({ id: 's', scope: 'BASE', retailPrice: money(60_000, 'KRW') });

  it('should_total_lines_and_record_applied_rule_ids', () => {
    const snapshot = buildPriceSnapshot(
      [
        { unitId: 'adult', quantity: 2, rules: [vip] },
        { unitId: 'child', quantity: 1, rules: [s] },
      ],
      ctx({ totalQuantity: 3 }),
      'KRW',
    );

    expect(snapshot.totalRetail).toEqual(money(200_000, 'KRW'));
    // 금액만이 아니라 근거 룰까지 남아야 정산 분쟁에서 방어가 된다.
    expect(snapshot.lines.map((l) => l.ruleId)).toEqual(['vip', 's']);
    expect(snapshot.lines[0]?.lineRetail).toEqual(money(140_000, 'KRW'));
  });

  it('should_return_null_total_net_when_any_line_lacks_net_price', () => {
    // 일부만 더한 넷가 합계는 정산에서 오해를 부른다 — 아예 null 로 둔다.
    const withNet = rule({
      id: 'withNet',
      scope: 'BASE',
      retailPrice: money(70_000, 'KRW'),
      netPrice: money(56_000, 'KRW'),
    });
    const snapshot = buildPriceSnapshot(
      [
        { unitId: 'a', quantity: 1, rules: [withNet] },
        { unitId: 'b', quantity: 1, rules: [s] },
      ],
      ctx(),
      'KRW',
    );
    expect(snapshot.totalNet).toBeNull();
  });

  it('should_total_net_when_every_line_has_net_price', () => {
    const withNet = rule({
      id: 'withNet',
      scope: 'BASE',
      retailPrice: money(70_000, 'KRW'),
      netPrice: money(56_000, 'KRW'),
    });
    const snapshot = buildPriceSnapshot(
      [{ unitId: 'a', quantity: 2, rules: [withNet] }],
      ctx(),
      'KRW',
    );
    expect(snapshot.totalNet).toEqual(money(112_000, 'KRW'));
  });

  it('should_not_change_when_rules_change_afterwards', () => {
    // INV-3: 스냅샷은 값이다. 이후 룰이 바뀌어도 기존 예약 금액은 그대로다.
    const rules = [vip];
    const snapshot = buildPriceSnapshot([{ unitId: 'a', quantity: 1, rules }], ctx(), 'KRW');
    const before = snapshot.totalRetail;

    // 룰 배열을 교체(가격 인상)해도 이미 만들어진 스냅샷에는 영향이 없다.
    buildPriceSnapshot(
      [{ unitId: 'a', quantity: 1, rules: [{ ...vip, retailPrice: money(99_000, 'KRW') }] }],
      ctx(),
      'KRW',
    );
    expect(snapshot.totalRetail).toEqual(before);
    expect(snapshot.totalRetail).toEqual(money(70_000, 'KRW'));
  });
});
