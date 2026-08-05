import { NoPriceRuleError } from './errors.js';
import { dayOfWeek, minutesOfDay, type LocalDate, type LocalTime } from './localtime.js';
import { add, multiply, zero, type CurrencyCode, type Money } from './money.js';

/**
 * 가격 룰 해석 — INV-3 / INV-4 / docs/07 §9
 *
 * 우선순위는 **이 파일에만** 존재한다. 호출부에서 재구현하거나 조건 분기를 추가하면
 * 채널마다 다른 금액이 산출되고, 그 차이는 정산 대사에서야 발견된다.
 */

/** docs/07 §9: 특정일 > 시간대(time band) > 채널+요일 > 요일 > 시즌 > 기본 */
export const PRICE_SCOPE_PRIORITY = [
  'SPECIFIC_DATE',
  'TIME_BAND',
  'CHANNEL_DOW',
  'DOW',
  'SEASON',
  'BASE',
] as const;

export type PriceScope = (typeof PRICE_SCOPE_PRIORITY)[number];

export interface PriceRule {
  readonly id: string;
  readonly scope: PriceScope;
  /** null = 전 채널 공통 */
  readonly channelId: string | null;
  /** 적용 기간 (시즌·특정일). null = 상시 */
  readonly dateFrom: LocalDate | null;
  readonly dateTo: LocalDate | null;
  /** 요일 조건 0=일 … 6=토. null = 요일 무관 */
  readonly daysOfWeek: readonly number[] | null;
  /** 시간대 조건 (docs/07 §T6 Burj Khalifa 프라임아워). null = 시간 무관 */
  readonly timeFrom: LocalTime | null;
  readonly timeTo: LocalTime | null;
  /** 인원 구간 계단가 (docs/07 §9 가격 3). null = 구간 무관 */
  readonly tierMin: number | null;
  readonly tierMax: number | null;
  readonly retailPrice: Money;
  /** 채널 정산 기준가. 미설정 시 커미션으로 산출한다. */
  readonly netPrice: Money | null;
}

export interface PriceContext {
  readonly serviceDate: LocalDate;
  /** 시각 없는 상품은 null */
  readonly startTime: LocalTime | null;
  readonly channelId: string | null;
  /** 계단가 판정용 총 인원(수량) */
  readonly totalQuantity: number;
}

export interface ResolvedPrice {
  readonly ruleId: string;
  readonly scope: PriceScope;
  readonly retailPrice: Money;
  readonly netPrice: Money | null;
}

/** 룰의 각 조건은 "지정된 것만" 검사한다. null 조건 = 제약 없음. */
function matches(rule: PriceRule, ctx: PriceContext): boolean {
  if (rule.channelId !== null && rule.channelId !== ctx.channelId) return false;

  if (rule.dateFrom !== null && ctx.serviceDate < rule.dateFrom) return false;
  if (rule.dateTo !== null && ctx.serviceDate > rule.dateTo) return false;

  if (rule.daysOfWeek !== null && !rule.daysOfWeek.includes(dayOfWeek(ctx.serviceDate))) {
    return false;
  }

  if (rule.timeFrom !== null || rule.timeTo !== null) {
    // 시간대 룰인데 상품에 시각이 없으면 적용 대상이 아니다.
    if (ctx.startTime === null) return false;
    const at = minutesOfDay(ctx.startTime);
    if (rule.timeFrom !== null && at < minutesOfDay(rule.timeFrom)) return false;
    // 종료 시각은 배타적: 09:00~12:00 룰에 12:00 회차는 포함되지 않는다.
    if (rule.timeTo !== null && at >= minutesOfDay(rule.timeTo)) return false;
  }

  if (rule.tierMin !== null && ctx.totalQuantity < rule.tierMin) return false;
  if (rule.tierMax !== null && ctx.totalQuantity > rule.tierMax) return false;

  return true;
}

function hasTier(rule: PriceRule): boolean {
  return rule.tierMin !== null || rule.tierMax !== null;
}

/**
 * 동일 우선순위 안에서의 결정 규칙.
 *
 * 같은 순위 룰이 여러 개 매칭될 때 아무거나 고르면 배포 시점마다 금액이 달라질 수 있다.
 * 인원 구간 룰을 우선하고(docs/07 §9 가격 3), 그다음 좁은 기간을 우선하며,
 * 마지막은 id 사전순으로 **항상 같은 답**이 나오게 고정한다.
 */
function preferenceOrder(a: PriceRule, b: PriceRule): number {
  const byTier = Number(hasTier(b)) - Number(hasTier(a));
  if (byTier !== 0) return byTier;

  const byNarrowerRange = rangeWidth(a) - rangeWidth(b);
  if (byNarrowerRange !== 0) return byNarrowerRange;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 기간이 좁을수록 구체적인 룰로 본다. 무기한(null)은 가장 넓게 취급. */
function rangeWidth(rule: PriceRule): number {
  if (rule.dateFrom === null || rule.dateTo === null) return Number.MAX_SAFE_INTEGER;
  return Date.parse(rule.dateTo) - Date.parse(rule.dateFrom);
}

/**
 * 적용 룰 결정 — INV-4 의 단일 구현체.
 *
 * 매칭 룰이 없으면 0원으로 넘어가지 않고 실패한다(NoPriceRuleError).
 */
export function resolvePrice(rules: readonly PriceRule[], ctx: PriceContext): ResolvedPrice {
  const candidates = rules.filter((r) => matches(r, ctx));

  for (const scope of PRICE_SCOPE_PRIORITY) {
    const sameScope = candidates.filter((r) => r.scope === scope).sort(preferenceOrder);
    const chosen = sameScope[0];
    if (chosen) {
      return {
        ruleId: chosen.id,
        scope: chosen.scope,
        retailPrice: chosen.retailPrice,
        netPrice: chosen.netPrice,
      };
    }
  }

  throw new NoPriceRuleError(
    `적용 가능한 가격 룰이 없습니다: date=${ctx.serviceDate} time=${ctx.startTime ?? '-'} channel=${ctx.channelId ?? '-'} qty=${String(ctx.totalQuantity)} — INV-4`,
  );
}

export interface PriceSnapshotLine {
  readonly unitId: string;
  readonly quantity: number;
  readonly ruleId: string;
  readonly scope: PriceScope;
  readonly unitRetail: Money;
  readonly lineRetail: Money;
  readonly unitNet: Money | null;
  readonly lineNet: Money | null;
}

/**
 * 예약 시점의 가격 스냅샷 — INV-3
 *
 * 적용 룰 ID 까지 함께 남긴다. 금액만 남기면 나중에 "왜 이 금액인가"를
 * 재구성할 수 없어 정산 분쟁에서 방어가 되지 않는다.
 * 이 값은 이후 PriceRule 이 바뀌어도 **재계산하지 않는다.**
 */
export interface PriceSnapshot {
  readonly currency: CurrencyCode;
  readonly lines: readonly PriceSnapshotLine[];
  readonly totalRetail: Money;
  /** 구성 라인 중 하나라도 넷가가 없으면 null (부분 합계는 오해를 부른다) */
  readonly totalNet: Money | null;
}

export interface PriceableUnit {
  readonly unitId: string;
  readonly quantity: number;
  readonly rules: readonly PriceRule[];
}

/**
 * Unit 별 단가를 해석하고 합산해 스냅샷을 만든다.
 * 계단가 판정은 라인 수량이 아니라 **예약 전체 수량**을 쓴다(docs/07 §9 가격 3).
 */
export function buildPriceSnapshot(
  units: readonly PriceableUnit[],
  ctx: PriceContext,
  currency: CurrencyCode,
): PriceSnapshot {
  const lines = units.map((unit): PriceSnapshotLine => {
    const resolved = resolvePrice(unit.rules, ctx);
    return {
      unitId: unit.unitId,
      quantity: unit.quantity,
      ruleId: resolved.ruleId,
      scope: resolved.scope,
      unitRetail: resolved.retailPrice,
      lineRetail: multiply(resolved.retailPrice, unit.quantity),
      unitNet: resolved.netPrice,
      lineNet: resolved.netPrice === null ? null : multiply(resolved.netPrice, unit.quantity),
    };
  });

  const totalRetail = lines.reduce((sum, l) => add(sum, l.lineRetail), zero(currency));
  const everyLineHasNet = lines.every((l) => l.lineNet !== null);
  const totalNet = everyLineHasNet
    ? lines.reduce((sum, l) => add(sum, l.lineNet ?? zero(currency)), zero(currency))
    : null;

  return { currency, lines, totalRetail, totalNet };
}
