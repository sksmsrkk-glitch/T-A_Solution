import { InvalidLocalTimeError } from './errors.js';

/**
 * 시설 로컬 시간 — INV-8 / docs/03 §3.3
 *
 * 슬롯은 `local_date` + `local_start_time` + 시설 `timezone` 으로 다룬다.
 * UTC 로 변환해 "저장"하지 않는 이유: 서머타임이 있는 목적지에서 운영시간 해석이
 * 무너지고, 시설이 말하는 "10시 입장"과 시스템의 시각이 어긋난다.
 *
 * 다만 컷오프처럼 **현재 시각과 비교**해야 할 때는 순간(instant)이 필요하므로,
 * 여기서 로컬 벽시계 → UTC 순간 변환을 한 곳에서만 제공한다.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** `YYYY-MM-DD` — 시설 로컬 날짜 */
export type LocalDate = Brand<string, 'LocalDate'>;
/** `HH:mm` — 시설 로컬 시각 */
export type LocalTime = Brand<string, 'LocalTime'>;
/** IANA 타임존 식별자 (예: `Asia/Seoul`) */
export type TimeZone = Brand<string, 'TimeZone'>;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export function parseLocalDate(value: string): LocalDate {
  const m = DATE_PATTERN.exec(value);
  if (!m) throw new InvalidLocalTimeError(`날짜 형식은 YYYY-MM-DD 여야 합니다: ${value}`);

  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];

  // 2026-02-30 같은 존재하지 않는 날짜를 걸러낸다. Date 는 조용히 이월시키므로
  // 왕복 비교로 검증한다.
  const probe = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;

  if (!isRealDate) throw new InvalidLocalTimeError(`존재하지 않는 날짜입니다: ${value}`);
  return value as LocalDate;
}

export function parseLocalTime(value: string): LocalTime {
  const m = TIME_PATTERN.exec(value);
  if (!m) throw new InvalidLocalTimeError(`시각 형식은 HH:mm 여야 합니다: ${value}`);

  const [hour, minute] = [Number(m[1]), Number(m[2])];
  if (hour > 23 || minute > 59) {
    throw new InvalidLocalTimeError(`시각 범위를 벗어났습니다: ${value}`);
  }
  return value as LocalTime;
}

export function parseTimeZone(value: string): TimeZone {
  try {
    // 런타임의 IANA 데이터로 검증한다. 잘못된 타임존은 여기서 걸러야
    // 컷오프 계산이 조용히 UTC 로 흘러가는 사고를 막을 수 있다.
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    throw new InvalidLocalTimeError(`알 수 없는 IANA 타임존입니다: ${value}`);
  }
  return value as TimeZone;
}

/** 0=일요일 … 6=토요일. 가격 룰의 요일 조건(docs/03 PriceRule.days_of_week)에 쓰인다. */
export function dayOfWeek(date: LocalDate): number {
  const m = DATE_PATTERN.exec(date);
  // parseLocalDate 를 통과한 값만 들어오므로 형식은 보장된다.
  if (!m) throw new InvalidLocalTimeError(`날짜 형식 오류: ${date}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

/** `HH:mm` 을 자정 기준 분으로. 시간대(time band) 비교에 쓴다. */
export function minutesOfDay(time: LocalTime): number {
  const m = TIME_PATTERN.exec(time);
  if (!m) throw new InvalidLocalTimeError(`시각 형식 오류: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 주어진 UTC 순간에 해당 타임존이 갖는 오프셋(ms). */
function zoneOffsetMs(utcMs: number, timeZone: TimeZone): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));

  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new InvalidLocalTimeError(`타임존 파싱 실패: ${timeZone}`);
    return Number(found.value);
  };

  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asIfUtc - utcMs;
}

/**
 * 시설 로컬 벽시계 시각 → UTC 순간.
 *
 * 오프셋은 순간에 의존하고 순간은 오프셋에 의존하는 순환이라, 추정 오프셋으로
 * 1차 계산한 뒤 그 시점의 실제 오프셋으로 한 번 더 보정한다(서머타임 전환 대응).
 *
 * - 존재하지 않는 시각(봄철 시계 앞당김 구간): 전환 이후의 순간으로 정규화된다
 * - 중복되는 시각(가을철 되돌림 구간): 첫 번째(이른) 순간을 택한다
 *
 * 시각이 없는 슬롯(OPENING_HOURS·FREESALE)은 호출부에서 00:00 을 넘긴다.
 */
export function toInstant(date: LocalDate, time: LocalTime | null, timeZone: TimeZone): Date {
  const d = DATE_PATTERN.exec(date);
  if (!d) throw new InvalidLocalTimeError(`날짜 형식 오류: ${date}`);
  const t = time === null ? null : TIME_PATTERN.exec(time);
  if (time !== null && !t) throw new InvalidLocalTimeError(`시각 형식 오류: ${time}`);

  const wallClockMs = Date.UTC(
    Number(d[1]),
    Number(d[2]) - 1,
    Number(d[3]),
    t ? Number(t[1]) : 0,
    t ? Number(t[2]) : 0,
  );

  // 1패스는 전환 이전 오프셋, 2패스는 그 순간의 실제 오프셋으로 보정한다.
  const firstPass = wallClockMs - zoneOffsetMs(wallClockMs, timeZone);
  const corrected = wallClockMs - zoneOffsetMs(firstPass, timeZone);

  // 왕복 검증: 보정 결과를 다시 로컬 벽시계로 되돌렸을 때 요청값과 같아야 한다.
  // 어긋나면 요청한 시각이 그 타임존에 존재하지 않는다는 뜻(시계 앞당김 구간)이다.
  // 이때는 1패스 값을 쓴다 — gap 폭만큼 앞으로 밀린 시각이 되며,
  // java.time·Luxon 과 같은 관례다. 2패스 값을 쓰면 전환 이전으로 되돌아가
  // 회차가 오히려 당겨진다.
  const roundTrip = corrected + zoneOffsetMs(corrected, timeZone);
  return new Date(roundTrip === wallClockMs ? corrected : firstPass);
}
