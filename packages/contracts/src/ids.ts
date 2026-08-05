/**
 * 브랜드 ID 타입.
 *
 * 모든 식별자가 그냥 string 이면 `bookingId` 자리에 `slotId` 를 넘겨도 컴파일이 통과한다.
 * 이 시스템은 테넌트·상품·슬롯·예약 ID 가 동시에 오가므로, 뒤바뀐 인자는
 * 곧바로 타 테넌트 데이터 접근이나 잘못된 재고 차감이 된다. — CLAUDE.md Rule #9
 */
declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;
export type ProductId = Brand<string, 'ProductId'>;
export type OptionId = Brand<string, 'OptionId'>;
export type UnitId = Brand<string, 'UnitId'>;
export type SlotId = Brand<string, 'SlotId'>;
export type BookingId = Brand<string, 'BookingId'>;
export type ChannelId = Brand<string, 'ChannelId'>;
export type PriceRuleId = Brand<string, 'PriceRuleId'>;

/** 모듈 카탈로그 코드 (docs/08 §2) — entitlement 게이팅 키 (INV-6) */
export type ModuleCode = Brand<string, 'ModuleCode'>;
