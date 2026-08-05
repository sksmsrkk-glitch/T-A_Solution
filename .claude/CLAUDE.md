# Claude Session Rules — T&A Solution

## 프로젝트 컨텍스트

**투어&액티비티 판매관리 SaaS** — 서로 다른 시설사·공급사가 각각 독립 테넌트로 입주하는 **모듈형 멀티테넌트 SaaS**. 당사는 마스터 계정으로 전 모듈을 보유하고, 가입 설문(상품 형태·가격/재고 관리 방법)에 따라 테넌트별 모듈을 승인·개통(entitlement)한다. Open API 모듈(OCTO 표준)로 OTA에 상품·가격·재고를 실시간 유통한다.

### 설계 문서 (코드 작성 전 반드시 근거 확인)

| #   | 문서                                     | 언제 읽나                                                      |
| --- | ---------------------------------------- | -------------------------------------------------------------- |
| 01  | `docs/01_OTA_카테고리_분석.md`           | 카테고리(C1~C8)·상품 형태 판단 시                              |
| 02  | `docs/02_카테고리별_관리모델_정의.md`    | 가격/재고/판매 라이프사이클 정의 확인                          |
| 03  | `docs/03_도메인_모델_설계.md`            | **엔터티·필드·상태머신 — 스키마 작업 시 필수**                 |
| 04  | `docs/04_시스템_아키텍처_설계.md`        | 모듈 경계·권한 매트릭스                                        |
| 05  | `docs/05_채널연동_API_설계.md`           | **OCTO API 구현 시 필수**                                      |
| 06  | `docs/06_개발_로드맵.md`                 | Phase 범위 확인 (범위 밖 작업 금지)                            |
| 07  | `docs/07_상품_케이스별_관리로직_상세.md` | **23개 실상품 케이스 — 가격/재고 로직 구현 시 필수**           |
| 08  | `docs/08_시스템_기획서.md`               | **SaaS 구조·모듈 카탈로그 25종·기능 ID·화면 IA — 최상위 기준** |

> 문서와 코드가 충돌하면 **문서가 기준**이다. 문서를 바꿔야 한다고 판단되면 코드를 먼저 고치지 말고 사용자에게 보고한다.

### 리포지토리 구조 (목표)

| 워크스페이스        | 경로                                       | 포트  | 설명                                                |
| ------------------- | ------------------------------------------ | ----- | --------------------------------------------------- |
| 코어 API            | `apps/api/`                                | 4000  | NestJS 모듈러 모놀리스 (테넌트 포털 BFF + 도메인)   |
| Open API 게이트웨이 | `apps/octo-gateway/`                       | 4100  | OCTO 표준 채널 API (별도 배포·별도 인증)            |
| 테넌트 포털         | `apps/portal/`                             | 3000  | Next.js — 시설사·공급사용 (모듈 게이팅 UI)          |
| 마스터 콘솔         | `apps/console/`                            | 3001  | Next.js — 가입 심사·모듈 프로비저닝·플랫폼 운영     |
| 현장 PWA            | `apps/field/`                              | 3002  | Next.js PWA — 리딤/스캔                             |
| 공유 패키지         | `packages/{db,domain,contracts,ui,config}` | —     | 스키마·도메인 로직·API 타입·디자인 시스템           |
| DB                  | `supabase/`                                | 54322 | Supabase (Postgres 17) — 마이그레이션·RLS 정책·시드 |

### 기술 스택

- **언어**: TypeScript (전 스택 단일 언어, `strict: true`)
- **런타임**: Node.js 22 LTS 이상
- **모노레포**: pnpm workspaces + Turborepo
- **백엔드**: NestJS (Fastify 어댑터), Zod 검증 — **상시 기동 컨테이너**(서버리스 아님)
- **DB**: **Supabase (Postgres 17)** — Auth / Storage / Realtime / RLS + **읽기 복제본(Read Replica)**
- **DB 접근**: Drizzle ORM (SQL-first) + 마이그레이션은 Supabase CLI SQL 파일
- **DB 커넥션**: **직결(5432) + 앱측 커넥션 풀**. 상시 컨테이너이므로 prepared statement 를 유지한다
  (Supavisor transaction mode(6543)는 prepared statement 미지원 — 서버리스 전용)
- **캐시**: Redis — 가용성 캘린더 read-through 캐시 / 채널 rate limit
- **잡/스케줄**: **2계층**
  - `pg_cron` — 순수 SQL 배치(홀드 만료·노쇼). 네트워크 왕복 0, 앱 장애와 무관하게 동작
  - **BullMQ + Redis** — 앱 로직이 필요한 작업(채널 웹훅 팬아웃·재시도 백오프)
- **프론트**: Next.js (App Router) + React, TanStack Query, Tailwind + shadcn/ui
- **관측**: OpenTelemetry(트레이스·메트릭) + Sentry(에러). **성능 예산은 측정으로 검증한다**
- **테스트**: Vitest + Supertest + Supabase 로컬 스택(Docker) + k6(부하)
- **품질**: ESLint(flat config) + Prettier + `tsc --noEmit`
- **CI**: GitHub Actions

> **배포 원칙**: 앱은 **Supabase 프로젝트와 동일 리전**에 배포한다. 예약 요청 1건은 DB를 여러 번 왕복하므로 리전 간 거리가 그대로 p99에 곱해진다. 리전이 다른 배포처(예: Seoul DB ↔ Tokyo 앱)는 선택하지 않는다.

### 배포 환경 (확정)

| 항목    | 값                                                                                 |
| ------- | ---------------------------------------------------------------------------------- |
| DB      | Supabase **Seoul** (Pro + compute 애드온 — 읽기 복제본 사용)                       |
| 앱      | **GCP Cloud Run `asia-northeast3`(서울)**                                          |
| 캐시/큐 | Memorystore(Redis) `asia-northeast3` + Serverless VPC Access — 간이 대안은 Upstash |
| CI/CD   | GitHub Actions → Artifact Registry → Cloud Run                                     |

**Cloud Run 필수 설정** (지키지 않으면 성능·정합성이 무너진다)

- **`--min-instances >= 1`** — 콜드 스타트는 채널 타임아웃 → 상품 자동 비활성화로 이어진다 (INV-11)
- **워커는 별도 서비스로 분리하고 CPU always allocated** — Cloud Run은 기본적으로 요청 처리 중에만 CPU를 준다. BullMQ 워커를 API 서비스에 얹으면 요청이 없는 동안 잡이 멈춘다
- **`--concurrency` × 인스턴스 수 ≥ DB 풀 크기 정합** — 풀 총합이 Supabase compute 등급의 커넥션 상한을 넘지 않게 산정한다
- **DB 커넥션은 Supavisor `session` mode(5432)** — Supabase 직결은 IPv6 기본이고 Cloud Run 이그레스는 IPv4 경로가 일반적이다. **session mode 는 prepared statement 를 지원**하므로 성능 손실 없이 IPv4 문제를 해결한다. (금지 대상은 prepared statement 를 못 쓰는 `transaction` mode(6543)뿐이다)

### 주요 명령어

```bash
pnpm dev                      # 전체 앱 동시 실행 (turbo)
pnpm --filter api dev         # 코어 API 단독
pnpm --filter portal dev      # 테넌트 포털 단독
supabase start                # 로컬 Supabase 스택 기동 (Docker 필요)
supabase db reset             # 마이그레이션 재적용 + 시드 (로컬 초기화)
supabase migration new <name> # 새 마이그레이션 SQL 생성
pnpm typecheck                # tsc --noEmit 전체
pnpm lint                     # ESLint 전체
pnpm test                     # Vitest 전체
pnpm verify                   # typecheck + lint + test (루프 종료 판정 기준)
```

---

## Session Initialization

**MANDATORY**: 세션 시작 즉시 `.claude/skills/claude_init.skill.yaml` 을 Read 도구로 읽는다. 이 파일의 instructions에 따라 모든 설정이 로드된다.

---

## 도메인 불변식 (Non-negotiable Invariants)

아래 12개는 **어떤 이유로도 위반 금지**다. 위반하는 코드는 작성하지 않고, 발견 시 즉시 보고한다.

### INV-1. 오버부킹 금지 — 재고 차감은 원자적 조건부 UPDATE

`SELECT`로 잔여를 확인한 뒤 `UPDATE` 하는 2단계 패턴 **금지**. 반드시 단일 조건부 UPDATE로 차감하고, 영향 행 수 0이면 매진으로 처리한다.

```sql
UPDATE availability_slot
   SET held_count = held_count + :qty
 WHERE id = :slot_id
   AND (capacity IS NULL OR capacity - booked_count - held_count >= :qty);
-- rowCount === 0  →  SOLD_OUT
```

`capacity IS NULL` = 무제한 재고(FREESALE). NULL 처리를 빠뜨리면 무한재고 상품이 전량 매진된다.

### INV-2. 멱등성 — 외부 유입은 멱등키로 방어

채널에서 유입되는 예약/취소/확정 요청은 `idempotency_key` UNIQUE 제약으로 중복을 막는다. 애플리케이션 레벨 중복 체크만으로 처리 금지(경합 발생).

### INV-3. 가격 스냅샷 불변

예약 생성 시 `price_snapshot`에 확정 금액·통화·적용 룰 ID를 저장한다. 이후 PriceRule이 바뀌어도 기존 예약 금액은 **재계산하지 않는다**. 정산은 스냅샷 기준.

### INV-4. 가격 룰 우선순위는 단일 구현

해석 순서 **특정일 > 시간대(time band) > 채널+요일 > 요일 > 시즌 > 기본**. 이 순서는 `packages/domain`의 단일 함수에만 구현하고, 다른 곳에서 재구현·분기 금지.

### INV-5. 테넌트 격리 이중화

테넌트 데이터 테이블은 예외 없이 `tenant_id NOT NULL` + **RLS 활성화 + 정책 존재**. RLS 없는 테넌트 테이블 생성 금지. 애플리케이션 필터만으로 격리 금지.
`service_role` 키는 **서버 전용**. 클라이언트 번들·`NEXT_PUBLIC_*`·로그에 절대 노출 금지.

### INV-6. Entitlement는 서버에서 강제

모듈 기능 API는 서버측 entitlement 가드를 통과해야 한다. 미개통 모듈 호출은 **403**. UI 메뉴 숨김만으로 처리 금지.

### INV-7. 예약 상태 전이는 전이표 밖으로 못 나간다

`ON_HOLD → CONFIRMED|PENDING|EXPIRED`, `PENDING → CONFIRMED|REJECTED`, `CONFIRMED → REDEEMED|CANCELLED|NO_SHOW`. 상태 변경은 단일 서비스(BookingStateService)만 수행하고 **모든 전이는 `BookingLog`에 기록**한다.

### INV-8. 타임존 — 시설 로컬 시간 보존

슬롯은 `local_date` + `local_start_time` + 시설 `timezone`으로 저장한다. UTC로 변환해 저장 금지(서머타임·운영시간 해석 붕괴). 비교·정렬은 로컬 값 기준.

### INV-9. 번들은 단일 트랜잭션

번들/패키지 구성품 재고 차감은 한 트랜잭션에서 전부 성공하거나 전부 롤백. 가용성 = `min(구성품)`, 컷오프 = `max(구성품)`.

### INV-10. 금액은 정수(minor unit)

금액은 정수 최소단위 + `currency` 코드로 저장·계산. `float`/`number` 연산 금지.

### INV-11. 게이트웨이 장애 시 5xx

OCTO Availability 응답에서 내부 장애를 **빈 가용성/NO_AVAILABILITY로 변환 금지**. 반드시 5xx를 반환한다. (채널이 상품을 자동 비활성화하는 사고 방지 — `docs/05` 참조)

### INV-12. 캐시·읽기 복제본은 예약 확정 경로의 진실이 아니다

성능을 위해 도입한 읽기 복제본(비동기 복제 = **지연 존재**)과 Redis 캐시(**TTL 동안 stale**)는 **탐색용 읽기에만** 쓴다.

| 경로                                  | 소스                | 이유                                 |
| ------------------------------------- | ------------------- | ------------------------------------ |
| 캘린더 조회 · 상품 탐색               | 복제본 / 캐시 허용  | 조금 늦어도 사고가 아니다            |
| **예약 직전 `availability/check`**    | **프라이머리 필수** | 재고 판단의 마지막 관문              |
| **재고 차감 · 예약 상태 전이 · 정산** | **프라이머리 필수** | 지연·stale 은 오버부킹·오청구가 된다 |

- 재고 차감은 언제나 프라이머리에서 원자적 UPDATE 로 최종 판정한다 (INV-1). **캐시 값을 보고 차감 여부를 결정하지 않는다.**
- 캐시는 read-through + **도메인 이벤트 기반 무효화**. TTL 만료에만 의존하지 않는다.
- 트랜잭션 안에서 복제본을 읽지 않는다(같은 트랜잭션 내 read-your-write 깨짐).

---

## Critical Rules to Follow

### 1. Plan First, Execute After Approval

- 항상 작업 계획을 먼저 제시하고 사용자 승인을 받는다
- 파일 수정 전 반드시 사용자 확인을 받는다
- 사용자가 방향과 핵심 결정을 내린다
- 추측하지 않고 확인을 요청한다

### 2. Documents-First Approach

- 구현 전 해당 기능의 근거 문서(`docs/01`~`08`)를 먼저 확인한다
- 기능 ID(예: PLT-03, CHN-08)와 화면 ID(예: SCR-MD1)로 추적 가능하게 커밋·PR을 기술한다
- 문서에 없는 요구가 발견되면 **코드로 임의 결정하지 말고** 문서 개정을 먼저 제안한다

### 3. Platform-First Approach (Supabase/NestJS 내장 우선)

- 커스텀 구현 전 Supabase(Auth·RLS·Storage·Realtime)와 NestJS(Guard·Pipe·Interceptor) 내장 기능을 먼저 검토한다
- 단, **재고 차감·상태 전이·가격 해석**은 플랫폼 기능에 위임하지 말고 도메인 계층에 명시적으로 구현한다 (INV-1/4/7)

### 4. No Guessing or Assumptions

- 확신이 없으면 문서를 확인한다. 불확실하면 "확인해보겠습니다"라고 말한다
- 외부 스펙(OCTO·채널 API) 질문 시 WebFetch로 원문을 확인한다

### 5. Preserve Working Solutions

- 동작하는 코드는 성능·정합성 문제가 없으면 변경하지 않는다
- "왜 동작하는 것을 바꿔야 하는가?"를 먼저 묻는다. 최적화 전에 측정한다

### 6. Question Detection Rule

- 메시지가 "?"로 끝나면 질문으로만 처리한다. 파일 수정 없이 정보만 제공한다

### 7. Check Existing Content

- 편집·덮어쓰기 전에 항상 파일을 먼저 읽는다. 새 섹션 추가 시 기존 내용을 보존한다

### 8. Analyze Existing Code First

- 새 파일 생성 전 유사한 기존 파일 패턴을 먼저 확인한다 (네이밍·모듈 구조·DTO·에러 처리)
- 예시: NestJS 모듈 생성 → `apps/api/src/modules/` 기존 모듈 / 마이그레이션 → `supabase/migrations/` 기존 SQL / 화면 → `apps/portal/app/` 라우트 구조
- 새 패턴을 강요하지 말고 기존 코드베이스 스타일에 맞춘다

### 9. Readability for Domain-Outsiders

- **"도메인 지식 없는 개발자"** 관점의 가독성 우선
- 비즈니스 로직은 명시적 코드 > 숨겨진 로직
- 재고·가격·상태 분기에는 반드시 근거 주석(`// INV-1`, `// docs/07 §T4`)을 남긴다

### 10. Architecture Decision Making

- 기준: **"도메인 지식 없이 프로덕션에서 오류 추적이 가능한가?"**
- NestJS 가드 체인은 레이어별로 명확히 분리: **인증 → 테넌트 스코프 → entitlement → 비즈니스**
- 횡단 관심사(인증·로깅·에러·요청 컨텍스트)는 미들웨어/인터셉터로, 도메인 판단(재고·가격·정책)은 서비스에 명시적으로

### 11. Data Layer Guidelines

- 마이그레이션은 `supabase/migrations/` SQL 파일로만 관리 (수기 DB 변경 금지)
- 테넌트 테이블 생성 시 같은 마이그레이션에서 `ENABLE ROW LEVEL SECURITY` + 정책까지 작성 (INV-5)
- 파괴적 마이그레이션(DROP/타입 축소)은 사전 보고 후 진행
- 쿼리는 Drizzle 또는 파라미터 바인딩 raw SQL만. 문자열 보간 SQL 금지

### 12. Code Quality Standards

- `pnpm verify`(typecheck + lint + test) 통과가 작업 완료 조건
- 코드 스멜·취약점 수정 완료 후 작업을 마무리한다
- 하드코딩·시크릿 노출·중복 설계·누락 주석 금지

### 13. Pipeline Execution Rule (MANDATORY)

- **트리거 감지 시 `pipeline.yaml`의 5단계를 순서대로 실행할 것**
- 트리거 키워드: "개발해줘", "구현해줘", "작업 진행해", "기능 추가해줘", "리팩터링 해줘" 등
- **실행 순서** (생략 불가):
  1. `[development]` `dev_agent` → 코드 작성/수정
  2. `[domain]` `domain_agent` → **도메인 불변식 INV-1~11 검증**
  3. `[testing]` `test_agent` → 테스트 작성 및 실행
  4. `[quality]` `quality_agent` → 코드 품질 검증
  5. `[security]` `security_agent` → 보안·RLS·시크릿 점검
- 각 단계 완료 후 결과를 보고하고 사용자 승인을 받은 뒤 다음 단계로 진행 (`require_approval_before_next_stage: true`)
- 단계 실패 시 즉시 중단하고 원인 보고 (`stop_on_failure: true`) → **loop_agent 루프 진입**
- TS/SQL 파일 수정 시 `verify_hook` 훅이 자동으로 문법·정책 검증을 수행

### 14. Loop Engineering Rule (MANDATORY)

검증 실패는 사람에게 바로 넘기지 않고 **자동 수정 루프**를 먼저 돈다. 상세 규칙은 `.claude/skills/loop_agent.skill.yaml`.

- **루프 = 관찰 → 진단 → 최소 수정 → 재검증 → 종료 판정**
- **종료 조건(성공)**: `pnpm verify` 통과 + 해당 단계 체크리스트 전부 충족
- **중단 조건(에스컬레이션)**: 동일 원인으로 **3회** 실패, 또는 실패 원인이 설계 문서 변경을 요구할 때, 또는 불변식(INV-*)을 깨야만 통과할 때 → **즉시 멈추고 사용자에게 보고**
- 루프 중 **테스트를 약화시키거나 삭제해서 통과시키는 행위 금지**
- 매 반복마다 "무엇이 실패했고, 원인 가설이 무엇이며, 무엇을 바꿨는지" 1줄로 기록한다

### 15. Git Workflow (MANDATORY)

`main` 직접 커밋 금지. 모든 작업은 **기능 브랜치 → PR → 리뷰 → 머지**로 진행한다.

- **브랜치 네이밍**: `<type>/<기능ID-또는-요약>`
  - `feat/PLT-03-signup-survey` · `fix/INV-1-freesale-soldout` · `chore/ci-setup`
  - type: `feat` / `fix` / `refactor` / `chore` / `docs` / `test`
- **작업 시작 시**: `git switch main && git pull` 후 브랜치를 새로 딴다 (오래된 base 금지)
- **커밋 메시지**: `<type>: <요약>` + 본문에 **근거 문서·기능 ID** 명시
  ```
  feat: 가입 설문 모듈 자동 추천 로직

  docs/08 §3.2 STEP 2~4 체크박스 응답 → 모듈 매핑 규칙 구현 (PLT-03).
  의존성 해석 포함(INV-* 영향 없음).
  ```
- **PR 본문 필수 항목**: 근거 문서·기능 ID / 변경 요약 / **불변식 영향(INV-\*)** / 검증 결과(`pnpm verify`) / 마이그레이션 유무
- **머지 조건**: `pnpm verify` 통과 + 파이프라인 5단계 완료 + 리뷰 승인
- **머지 방식**: Squash merge (기능 단위 1커밋), 머지 후 브랜치 삭제
- **금지**: `main` 직접 push, `--force` push(공유 브랜치), 훅 우회(`--no-verify`)
- 마이그레이션이 포함된 PR은 **파괴적 변경 여부를 본문 상단에 명시**한다

### 16. Performance Budget (MANDATORY)

성능은 "빠르게 짜자"는 태도가 아니라 **숫자와 측정**으로 관리한다. 아래 예산을 넘기면 기능이 완성돼도 미완료로 본다.

| 엔드포인트                   | p95   | p99   | 비고                                       |
| ---------------------------- | ----- | ----- | ------------------------------------------ |
| OCTO `availability/calendar` | 200ms | 400ms | 최대 트래픽. 복제본 + 캐시 + 사전계산 전제 |
| OCTO `availability/check`    | 100ms | 200ms | **프라이머리 조회** (INV-12)               |
| 예약 생성(홀드)              | 150ms | 300ms | 단일 조건부 UPDATE 경로                    |
| 포털 화면 API                | 300ms | 600ms |                                            |

- **N+1 쿼리 금지**. 옵션·Unit·가격 룰은 배치 조회하거나 사전계산 테이블에서 읽는다
- 가용성 캘린더는 요청 시점에 가격 룰을 전수 해석하지 않는다 — **사전계산 프로젝션 + 이벤트 기반 갱신**
- 새 쿼리를 추가하면 `EXPLAIN (ANALYZE, BUFFERS)`로 인덱스 사용을 확인한다. Seq Scan 발견 시 인덱스 추가 또는 사유 기록
- 재고 슬롯은 **단건 PK 갱신**이 되게 설계한다(핫 로우 경합 최소화). 범위 UPDATE 금지
- 성능 주장은 측정 없이 하지 않는다 — 부하 테스트(k6) 또는 트레이스 근거를 PR에 첨부
- 최적화 전에 측정한다(Rule #5). 단, **위 예산은 사후 최적화 대상이 아니라 설계 제약**이다

---

## Coding Principles

- 최소한의 중간 변수로 깔끔한 코드 작성
- 적절한 곳에 함수형 패턴 적용 (`map`/`filter`/`reduce`)
- TypeScript `strict` 준수 — `any` 금지, 외부 입력은 Zod로 파싱 후 사용
- 시간 = 돈 — 낭비적인 반복 피하기
- 생성된 코드에는 **왜**를 설명하는 주석을 남긴다 (무엇을 하는지는 코드가 말한다)

---

## Claude Execution Standards

모든 요청에 대해 **목표 → 제약조건 → 입력 → 기대 출력**을 먼저 구조화한 뒤, **design → implementation → validation** 순서로 처리한다.

### Do

요건을 소단위로 분해, 가정을 명확히 기술, 변경 영향을 설명, 유지보수성과 확장성 우선, 보안·성능·에러 핸들링·로깅 기준 포함, 도움이 될 때 체크리스트와 샘플 코드 추가, 근거 문서·기능 ID 명시.

### Don't

모호한 추측으로 구현 금지, 불명확하거나 검증되지 않은 코드 제공 금지, 미검증 답변을 최종으로 제시 금지, 불필요한 복잡성·과도한 엔지니어링 금지, 하드코딩·시크릿 노출·중복 설계·누락 주석 금지, **불변식(INV-\*) 위반 금지**.
