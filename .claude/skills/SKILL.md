# T&A Solution Development Skills

TypeScript + NestJS + Next.js + **Supabase** 기반 **투어&액티비티 모듈형 멀티테넌트 SaaS** 개발을 위한 Claude 세션 규칙과 스킬셋입니다.

본 스킬셋은 두 가지 원칙 위에 설계되었습니다.

- **하네스 엔지니어링(Harness Engineering)** — 에이전트가 지켜야 할 규칙·검증 장치·자동 훅을 리포지토리에 고정해, 세션이 바뀌어도 동일한 품질 기준이 강제되게 한다.
- **루프 엔지니어링(Loop Engineering)** — 검증 실패를 사람에게 즉시 넘기지 않고, 명확한 종료 조건과 반복 상한을 가진 자동 수정 루프를 돌려 수렴시킨다.

---

## 스킬 구성

| 스킬          | 파일                        | 역할                                                |
| ------------- | --------------------------- | --------------------------------------------------- |
| ClaudeInit    | `claude_init.skill.yaml`    | 세션 시작 시 설정 자동 로드                         |
| DevAgent      | `dev_agent.skill.yaml`      | 기능 개발·리팩터링                                  |
| DomainAgent   | `domain_agent.skill.yaml`   | **도메인 불변식(INV-1~11) 검증 — 본 프로젝트 고유** |
| SupabaseAgent | `supabase_agent.skill.yaml` | 마이그레이션·RLS 정책 설계·검증                     |
| TestAgent     | `test_agent.skill.yaml`     | Vitest/Supertest 테스트 작성·실행                   |
| QualityAgent  | `quality_agent.skill.yaml`  | ESLint/타입/가독성 품질 검증                        |
| SecurityAgent | `security_agent.skill.yaml` | OWASP·시크릿·RLS·멀티테넌시 보안 점검               |
| LoopAgent     | `loop_agent.skill.yaml`     | **자동 수정 루프 운영 — 루프 엔지니어링**           |

파이프라인 실행 순서: `dev → domain → test → quality → security` (실패 시 `loop` 진입)

---

## 핵심 개발 원칙

### 1. Plan-First Development (계획 우선 개발)

- 항상 작업 계획을 먼저 제시하고 사용자 승인을 받는다
- 파일 수정 전 반드시 사용자 확인을 받는다
- 사용자가 방향과 핵심 결정을 내린다
- 추측하지 않고 확인을 요청한다

### 2. Documents-First (문서 우선)

이 프로젝트는 코드보다 설계 문서가 먼저 완성되었습니다. **문서가 진실의 원천**입니다.

- 구현 전 `docs/03`(도메인 모델), `docs/07`(23개 실상품 케이스), `docs/08`(SaaS 기획서)에서 근거를 찾는다
- 문서에 없는 요구는 코드로 임의 결정하지 않고 문서 개정을 먼저 제안한다
- 커밋·PR에 기능 ID(`PLT-03`, `CHN-08`)와 화면 ID(`SCR-MD1`)를 명시한다

### 3. Platform-First, Domain-Explicit

- 인증·스토리지·실시간·행 수준 보안은 **Supabase 내장** 기능을 우선 활용한다
- 그러나 **재고 차감·예약 상태 전이·가격 룰 해석**은 플랫폼에 위임하지 않고 도메인 계층에 명시적으로 구현한다 — 이 셋이 이 시스템의 사고 발생 지점이다

### 4. No Guessing Policy (추측 금지)

- 확신이 없으면 문서를 확인한다
- 외부 스펙(OCTO·Klook·GYG)은 WebFetch로 원문을 확인한다
- 불확실할 때는 "확인해보겠습니다"라고 말한다

### 5. Preserve Working Solutions (동작 코드 보존)

- "왜 동작하는 것을 바꿔야 하는가?"를 먼저 묻는다
- 최적화 전에 측정한다

---

## 도메인 지식 요약

### 상품 구조 — 3계층 (OCTO 표준)

```
Product (상품)
  └─ Option (패키지·회차·좌석등급 — 재고가 갈리면 여기서 분리)
       └─ Unit (판매 단위 SKU — 성인/소인/그룹/차량 …)
```

**핵심 판단 기준**: _"가격이 다르면 룰, 재고가 다르면 Option/슬롯"_

- 에버랜드 종일권/야간권 → 재고는 무한이지만 **입장 조건이 다르므로 Option 분리**
- 부르즈 칼리파 시간대별 요금 → 같은 슬롯 재고, **가격만 다르므로 PriceRule(time band)**

### 재고 3유형 (단일 `AvailabilitySlot` 추상화)

| 유형       | `availability_type` | capacity                    | 예시                       |
| ---------- | ------------------- | --------------------------- | -------------------------- |
| 타임슬롯   | `START_TIME`        | 정수                        | 난타 회차, 세션형 액티비티 |
| 일자       | `OPENING_HOURS`     | 정수 또는 NULL              | 날짜지정 입장권            |
| 오픈데이트 | `FREESALE`          | **NULL(무제한)** + 유효기간 | 에버랜드 오픈데이트권      |

### 예약 상태머신 (2단계 커밋)

```
ON_HOLD ──▶ CONFIRMED ──▶ REDEEMED / CANCELLED / NO_SHOW
   │  └──▶ PENDING ──▶ CONFIRMED | REJECTED
   └──▶ EXPIRED (홀드 만료 배치)
```

### 가격 해석 우선순위 (고정)

```
특정일 > 시간대(time band) > 채널+요일 > 요일 > 시즌 > 기본
```

### SaaS 구조

- 테넌트 = 시설사·공급사 (기능은 동일, **개통 모듈만 다름**)
- 모듈 카탈로그 25종: `CORE` + `PRICE-*`(8) + `INV-*`(9) + `PROD-*`(3) + `API-*`(3) + `OPS-*`(3)
- 가입 설문(체크박스) → 모듈 자동 추천 → 마스터 승인 → `TenantEntitlement` 개통
- 격리 이중화: 애플리케이션 `tenant_id` 스코프 + **Postgres RLS**

### 채널 연동 2모델

- **PULL**: 우리가 OCTO API 서버 제공 (Klook, GetYourGuide)
- **PUSH**: 우리가 어댑터로 밀어넣음 (KKday, Trip.com)

---

## 개발 패턴

### 재고 차감 — 원자적 조건부 UPDATE (INV-1)

```ts
// packages/domain/src/inventory/hold.ts
// INV-1: SELECT 후 UPDATE 하는 2단계 패턴은 경합 시 오버부킹을 만든다.
//        단일 조건부 UPDATE로 차감하고 rowCount로 성공을 판정한다.
//        capacity IS NULL = FREESALE(무제한) — 이 분기를 빠뜨리면 무한재고가 매진된다.
const { rowCount } = await tx.execute(sql`
  UPDATE availability_slot
     SET held_count = held_count + ${qty},
         version    = version + 1
   WHERE id = ${slotId}
     AND status = 'OPEN'
     AND (capacity IS NULL OR capacity - booked_count - held_count >= ${qty})
`);

if (rowCount === 0) throw new SoldOutError(slotId, qty);
```

### 번들 재고 — 단일 트랜잭션 원자성 (INV-9)

```ts
// INV-9: 구성품 중 하나라도 실패하면 전체 롤백. 부분 점유 상태를 남기지 않는다.
await db.transaction(async (tx) => {
  for (const component of bundle.components) {
    await holdSlot(tx, component.slotId, component.qty * pax); // 실패 시 throw → 롤백
  }
});
```

### NestJS 가드 체인 — 인증 → 테넌트 → entitlement (INV-5, INV-6)

```ts
// apps/api/src/modules/pricing/season-price.controller.ts
// 가드는 레이어별로 분리한다: 누구인가 → 어느 테넌트인가 → 그 모듈을 샀는가
@UseGuards(AuthGuard, TenantScopeGuard, EntitlementGuard)
@RequireModule('PRICE-SEASON') // 미개통 테넌트는 여기서 403 — UI 숨김에 의존하지 않는다 (INV-6)
@Controller('pricing/seasons')
export class SeasonPriceController {
  /* … */
}
```

### RLS 정책 — 테넌트 테이블 생성 시 동시 작성 (INV-5)

```sql
-- supabase/migrations/0003_availability_slot.sql
create table availability_slot (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id),
  local_date   date not null,           -- INV-8: 시설 로컬 날짜. UTC 변환 저장 금지
  local_start_time time,
  capacity     integer,                 -- NULL = FREESALE 무제한 (INV-1)
  booked_count integer not null default 0,
  held_count   integer not null default 0,
  version      integer not null default 0
);

-- INV-5: 테이블 생성과 같은 마이그레이션에서 RLS까지 활성화한다.
alter table availability_slot enable row level security;

create policy tenant_isolation on availability_slot
  using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
```

### 가격 해석 — 단일 진입점 (INV-4)

```ts
// packages/domain/src/pricing/resolve.ts
// INV-4: 이 우선순위는 여기 한 곳에만 존재한다. 호출부에서 재구현·분기 금지.
const PRIORITY = ['SPECIFIC_DATE', 'TIME_BAND', 'CHANNEL_DOW', 'DOW', 'SEASON', 'BASE'] as const;

export function resolvePrice(rules: PriceRule[], ctx: PriceContext): ResolvedPrice {
  for (const scope of PRIORITY) {
    const hit = rules.find((r) => r.scope === scope && matches(r, ctx));
    if (hit) return toResolved(hit, scope);
  }
  throw new NoPriceRuleError(ctx);
}
```

### 커넥션 선택 — 명시적으로 (INV-12)

```ts
// packages/db/src/client.ts
// INV-12: 복제본은 비동기 복제라 지연이 있고 SELECT 전용이다.
//         어느 커넥션을 쓰는지가 코드에서 바로 보여야 오류를 추적할 수 있다(Rule #10).
export const primaryDb = drizzle(primaryPool); // 차감·상태 전이·정산
export const replicaDb = drizzle(replicaPool ?? primaryPool); // 캘린더·리포트 (미설정 시 폴백)
```

```ts
// 캘린더 = 탐색용 → 복제본 + 캐시 허용
const calendar = await cache.getOrLoad(key, () => replicaDb.select()...);

// 예약 직전 확인 = 재고 판단의 마지막 관문 → 프라이머리 필수
const slot = await primaryDb.select()...;

// 차감 = 캐시 값을 보고 판정하지 않는다. 프라이머리의 원자적 UPDATE 결과가 유일한 진실 (INV-1)
const { rowCount } = await primaryDb.execute(holdSql);
```

### 금액 — 정수 minor unit (INV-10)

```ts
// Good: 정수 최소단위 + 통화 코드
type Money = { amount: number; currency: 'KRW' | 'USD' | 'JPY' }; // KRW 70000 = 70,000원

// Never: 부동소수 연산 — 정산 대사에서 1원 차이가 분쟁이 된다
const total = price * 0.85 + fee;
```

### 에러 핸들링 — 내부 정보 비노출

```ts
// apps/api/src/common/all-exceptions.filter.ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    this.logger.error(err); // 스택은 서버 로그에만
    // 클라이언트에는 코드 + 사용자 메시지만. 스택·SQL·내부 경로 노출 금지
    reply.status(status).send({ code, message: userMessage, traceId });
  }
}
```

### OCTO 가용성 — 장애를 매진으로 바꾸지 않는다 (INV-11)

```ts
// apps/octo-gateway/src/availability/availability.controller.ts
try {
  return await this.availability.check(query);
} catch (err) {
  // INV-11: 빈 배열을 돌려주면 채널이 상품을 자동 비활성화한다. 반드시 5xx로 알린다.
  throw new ServiceUnavailableException('AVAILABILITY_UPSTREAM_ERROR');
}
```

---

## 품질·검증 명령

```bash
pnpm verify        # typecheck + lint + test — 루프 종료 판정의 단일 기준
pnpm typecheck     # tsc --noEmit
pnpm lint          # ESLint flat config
pnpm test          # Vitest
pnpm test:coverage # 커버리지 (도메인 90%+ 목표)
supabase db lint   # 마이그레이션 정적 점검
pnpm audit         # 의존성 취약점
```

---

## 사용 방법

1. **계획 수립**: 작업 전 구현 계획 제시 후 승인
2. **문서 확인**: `docs/`에서 근거(기능 ID·케이스 번호) 확보
3. **코드 분석**: 기존 유사 파일 패턴 먼저 확인
4. **구현**: 불변식(INV-1~11) 준수, 근거 주석 명시
5. **검증**: `domain → test → quality → security` 파이프라인 순차 실행
6. **루프**: 실패 시 `loop_agent` 규칙으로 최대 3회 자동 수정 → 미수렴 시 사용자 에스컬레이션

T&A Solution의 일관성 있고 정합성 높은 시스템 개발을 위해 이 가이드라인을 따라주세요.
