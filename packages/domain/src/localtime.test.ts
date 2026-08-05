import { describe, expect, it } from 'vitest';

import { InvalidLocalTimeError } from './errors.js';
import {
  dayOfWeek,
  minutesOfDay,
  parseLocalDate,
  parseLocalTime,
  parseTimeZone,
  toInstant,
} from './localtime.js';

const SEOUL = parseTimeZone('Asia/Seoul');
const NEW_YORK = parseTimeZone('America/New_York');

describe('LocalDate / LocalTime 파싱 (INV-8)', () => {
  it('should_reject_malformed_date', () => {
    expect(() => parseLocalDate('2026-8-5')).toThrow(InvalidLocalTimeError);
    expect(() => parseLocalDate('20260805')).toThrow(InvalidLocalTimeError);
  });

  it('should_reject_nonexistent_calendar_date', () => {
    // Date 는 2026-02-30 을 3월 2일로 조용히 이월시킨다. 그 이월이 슬롯 생성에
    // 들어가면 존재하지 않는 회차가 팔린다.
    expect(() => parseLocalDate('2026-02-30')).toThrow(InvalidLocalTimeError);
    expect(() => parseLocalDate('2026-13-01')).toThrow(InvalidLocalTimeError);
  });

  it('should_accept_leap_day', () => {
    expect(parseLocalDate('2028-02-29')).toBe('2028-02-29');
    expect(() => parseLocalDate('2026-02-29')).toThrow(InvalidLocalTimeError);
  });

  it('should_reject_out_of_range_time', () => {
    expect(() => parseLocalTime('24:00')).toThrow(InvalidLocalTimeError);
    expect(() => parseLocalTime('10:60')).toThrow(InvalidLocalTimeError);
    expect(parseLocalTime('00:00')).toBe('00:00');
    expect(parseLocalTime('23:59')).toBe('23:59');
  });

  it('should_reject_unknown_timezone', () => {
    expect(() => parseTimeZone('Asia/Seoul_City')).toThrow(InvalidLocalTimeError);
  });

  it('should_compute_day_of_week', () => {
    // 2026-08-05 는 수요일
    expect(dayOfWeek(parseLocalDate('2026-08-05'))).toBe(3);
    expect(dayOfWeek(parseLocalDate('2026-08-09'))).toBe(0); // 일요일
  });

  it('should_convert_time_to_minutes', () => {
    expect(minutesOfDay(parseLocalTime('00:00'))).toBe(0);
    expect(minutesOfDay(parseLocalTime('14:30'))).toBe(870);
  });
});

describe('toInstant — 시설 로컬 벽시계 → UTC 순간 (INV-8)', () => {
  it('should_convert_seoul_wall_clock', () => {
    // 서울은 서머타임이 없다. 2026-08-05 10:00 KST = 01:00 UTC
    const at = toInstant(parseLocalDate('2026-08-05'), parseLocalTime('10:00'), SEOUL);
    expect(at.toISOString()).toBe('2026-08-05T01:00:00.000Z');
  });

  it('should_treat_null_time_as_midnight', () => {
    // 시각 없는 슬롯(OPENING_HOURS·FREESALE)은 이용일 00:00 기준
    const at = toInstant(parseLocalDate('2026-08-05'), null, SEOUL);
    expect(at.toISOString()).toBe('2026-08-04T15:00:00.000Z');
  });

  it('should_respect_dst_offset_change', () => {
    // 같은 벽시계 시각이라도 서머타임 여부에 따라 UTC 순간이 달라진다.
    // 뉴욕 1월 = EST(-05:00), 7월 = EDT(-04:00)
    const winter = toInstant(parseLocalDate('2026-01-15'), parseLocalTime('12:00'), NEW_YORK);
    const summer = toInstant(parseLocalDate('2026-07-15'), parseLocalTime('12:00'), NEW_YORK);

    expect(winter.toISOString()).toBe('2026-01-15T17:00:00.000Z');
    expect(summer.toISOString()).toBe('2026-07-15T16:00:00.000Z');
  });

  it('should_pick_earlier_instant_for_ambiguous_local_time', () => {
    // 2026-11-01 01:30 은 뉴욕에서 두 번 존재한다(시계 되돌림).
    // 이른 쪽(EDT, -04:00)을 택한다 — 회차 시작이 앞당겨지는 편이 안전하다.
    const at = toInstant(parseLocalDate('2026-11-01'), parseLocalTime('01:30'), NEW_YORK);
    expect(at.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('should_normalize_nonexistent_local_time', () => {
    // 2026-03-08 02:30 은 뉴욕에 존재하지 않는다(시계 앞당김).
    // 예외를 던지지 않고 전환 이후 순간으로 정규화된다 — 슬롯 생성 배치가
    // 이 한 칸 때문에 통째로 실패하는 것을 막기 위함이다.
    const at = toInstant(parseLocalDate('2026-03-08'), parseLocalTime('02:30'), NEW_YORK);
    expect(at.toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('should_reject_invalid_input', () => {
    expect(() => toInstant('bad' as never, null, SEOUL)).toThrow(InvalidLocalTimeError);
    expect(() => toInstant(parseLocalDate('2026-01-01'), 'bad' as never, SEOUL)).toThrow(
      InvalidLocalTimeError,
    );
  });
});
