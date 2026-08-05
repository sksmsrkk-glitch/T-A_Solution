# .claude — 개발 하네스 (Harness Engineering)

T&A Solution 프로젝트의 **개발 하네스**. 에이전트가 지켜야 할 규칙·검증 장치·자동 훅을 리포지토리에 고정해, 세션이 바뀌어도 동일한 품질 기준이 강제되게 한다.

> `sksmsrkk-glitch/allmytour-webbooking-sys/.claude` 구조를 벤치마킹해 본 프로젝트(투어&액티비티 멀티테넌트 SaaS · Supabase · TypeScript)에 맞게 재구성했다.

## 구성

```
.claude/
├── CLAUDE.md                       # 세션 규칙 — 프로젝트 컨텍스트 + 불변식 INV-1~12 + Rule #1~#16
├── config.yaml                     # 스킬 등록·컨텍스트 범위·워크플로 설정
├── pipeline.yaml                   # 5단계 파이프라인 + 루프 설정
├── triggers.yaml                   # 트리거 키워드 사전
├── settings.json                   # Claude Code 네이티브 훅 바인딩
├── hooks/
│   ├── pipeline_trigger.mjs        # UserPromptSubmit — 트리거 감지 → 파이프라인 지시문 주입
│   ├── verify_hook.mjs             # PostToolUse(Edit|Write) — 불변식·시크릿·RLS·린트 정적 검증
│   └── selftest.mjs                # 하네스 자가 점검 (9케이스)
└── skills/
    ├── SKILL.md                    # 도메인 지식 + 개발 패턴 모음
    ├── claude_init.skill.yaml      # 세션 시작 시 설정 자동 로드
    ├── dev_agent.skill.yaml        # 기능 개발·리팩터링
    ├── domain_agent.skill.yaml     # 도메인 불변식 검증 ★ 본 프로젝트 고유
    ├── supabase_agent.skill.yaml   # 마이그레이션·RLS 정책 ★ 본 프로젝트 고유
    ├── test_agent.skill.yaml       # Vitest/Supertest
    ├── quality_agent.skill.yaml    # 타입·린트·레이어 경계
    ├── security_agent.skill.yaml   # OWASP·멀티테넌시·시크릿
    └── loop_agent.skill.yaml       # 자동 수정 루프 ★ 루프 엔지니어링
```

## 두 가지 원칙

### 하네스 엔지니어링 — 규칙을 리포지토리에 고정한다

이 프로젝트의 사고는 문법 오류가 아니라 **도메인 규칙 위반**에서 발생한다. 오버부킹, 잘못된 가격 청구, 타 테넌트 데이터 노출, 채널의 상품 자동 비활성화. 그래서 하네스의 중심은 린터가 아니라 **불변식 12개**다.

| #      | 불변식                                                         | 방어 대상                  |
| ------ | -------------------------------------------------------------- | -------------------------- |
| INV-1  | 재고 차감은 원자적 조건부 UPDATE (`capacity IS NULL` = 무제한) | 오버부킹 / 무한재고 오매진 |
| INV-2  | 외부 유입은 `idempotency_key` UNIQUE 로 방어                   | 채널 재시도 중복 예약      |
| INV-3  | 예약 시 `price_snapshot` 저장, 재계산 금지                     | 정산 분쟁                  |
| INV-4  | 가격 우선순위는 단일 함수에만 구현                             | 채널별 금액 불일치         |
| INV-5  | `tenant_id` + RLS 이중 격리                                    | 타 테넌트 데이터 노출      |
| INV-6  | entitlement 는 서버에서 403                                    | 미결제 모듈 무단 사용      |
| INV-7  | 상태 전이표 준수 + BookingLog 기록                             | 추적 불가능한 예약         |
| INV-8  | 시설 로컬 시각 보존                                            | 서머타임·운영시간 붕괴     |
| INV-9  | 번들은 단일 트랜잭션                                           | 부분 점유 재고 누수        |
| INV-10 | 금액은 정수 minor unit                                         | 정산 대사 오차             |
| INV-11 | 게이트웨이 장애 시 5xx                                         | 채널의 상품 자동 비활성화  |
| INV-12 | 캐시·읽기 복제본은 예약 확정 경로의 진실이 아니다              | 복제 지연發 오버부킹       |

`verify_hook.mjs` 가 파일 저장 시점에 이 중 정적 검출 가능한 항목(INV-1·5·8·10·12 + 시크릿 + SQLi + N+1 + 루프 우회)을 **자동 차단**한다.

여기에 **ESLint 가 레이어 경계를 강제**한다 — `packages/domain` 이 NestJS·Next·Supabase·Drizzle 을 import 하면 CI 가 실패한다. 도메인 규칙을 DB 없이 테스트할 수 있는 상태를 유지하기 위한 장치다.

### 루프 엔지니어링 — 실패를 수렴시킨다

검증 실패를 사람에게 즉시 넘기지 않고, 종료 조건과 반복 상한이 있는 자동 수정 루프를 돈다.

```
OBSERVE(원문 신호) → DIAGNOSE(가설 1개) → PATCH(최소 변경) → VERIFY(pnpm verify) → JUDGE
```

- **성공 종료**: `pnpm verify` 통과 + 단계 체크리스트 충족 + 회귀 없음
- **에스컬레이션**: 동일 원인 3회 실패 / 실패 지점 순환 / 불변식을 깨야만 통과 / 설계 문서 변경 필요
- **금지**: 테스트 완화·`any`·`@ts-ignore`·`eslint-disable`·RLS 우회로 통과시키기
  → 이런 우회가 유일한 해법으로 보이면 그것이 곧 에스컬레이션 신호다

## 파이프라인

```
development → domain → testing → quality → security
     ↓ 실패      ↓ 실패     ↓ 실패      ↓ 실패      ↓ 실패
   ┌────────────────── loop_agent (최대 3회) ──────────────────┐
   └── 미수렴 → 사용자 에스컬레이션 ─────────────────────────────┘
```

원본 대비 **`domain` 단계를 신설**했다. 이 프로젝트에서 가장 비싼 버그가 발생하는 지점이기 때문이다.

## 자가 점검

```bash
node .claude/hooks/selftest.mjs
```

훅이 실제로 트리거를 잡고 불변식 위반을 차단하는지 9개 케이스로 검증한다. 하네스 파일을 수정한 뒤에는 반드시 실행할 것. CI(`harness` job)에서도 동일하게 돌아간다 — 훅이 조용히 망가지면 모든 가드가 무력화되기 때문이다.

## 원본과 달라진 점

| 항목         | 원본 (allmytour)              | 본 프로젝트                                                                          |
| ------------ | ----------------------------- | ------------------------------------------------------------------------------------ |
| 스택         | Node/Express + sql.js + React | TypeScript/NestJS + **Supabase** + Next.js                                           |
| 파이프라인   | 4단계                         | **5단계** (domain 신설)                                                              |
| 스킬 수      | 5개                           | **8개** (domain·supabase·loop 추가)                                                  |
| 훅 구현      | bash + jq                     | **Node .mjs** — Windows 에 `jq` 가 없고 `bash` 가 WSL 이라 원본 훅은 동작하지 않는다 |
| 훅 검증 범위 | JS 문법                       | **문법 + 도메인 불변식 + 시크릿 + RLS + SQLi**                                       |
| 실패 처리    | 중단 후 보고                  | **자동 수정 루프 → 미수렴 시 에스컬레이션**                                          |
| 근거         | 코드                          | **설계 문서 8종(docs/)이 진실의 원천**                                               |
