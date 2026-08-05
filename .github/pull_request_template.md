# 변경 요약

<!-- 무엇을, 왜 바꿨는지 2~3줄 -->

## 근거

| 항목      | 값                                      |
| --------- | --------------------------------------- |
| 근거 문서 | <!-- 예: docs/08 §3.2 / docs/07 §T4 --> |
| 기능 ID   | <!-- 예: PLT-03, CHN-08 -->             |
| 화면 ID   | <!-- 예: SCR-MD1 (해당 시) -->          |
| Phase     | <!-- docs/06 기준 Phase 1 / 2 / 3 -->   |

## 불변식 영향 (INV-*)

<!-- 건드린 불변식에 체크하고, 어떻게 지켰는지 한 줄씩 설명. 없으면 "해당 없음" -->

- [ ] INV-1 재고 원자적 차감 (`capacity IS NULL` = 무제한 처리 포함)
- [ ] INV-2 멱등키 UNIQUE
- [ ] INV-3 가격 스냅샷 불변
- [ ] INV-4 가격 우선순위 단일 구현
- [ ] INV-5 `tenant_id` + RLS 이중 격리
- [ ] INV-6 entitlement 서버 강제 (미개통 403)
- [ ] INV-7 예약 상태 전이표 + BookingLog
- [ ] INV-8 시설 로컬 시각 보존
- [ ] INV-9 번들 단일 트랜잭션
- [ ] INV-10 금액 정수 minor unit
- [ ] INV-11 게이트웨이 장애 시 5xx

## 마이그레이션

- [ ] 마이그레이션 없음
- [ ] 마이그레이션 있음 → 파일: `supabase/migrations/…`
  - [ ] 신규 테넌트 테이블에 RLS 활성화 + 정책 작성 완료 (INV-5)
  - [ ] **파괴적 변경(DROP/타입 축소/NOT NULL 추가) 포함 여부**: 없음 / 있음 → 사전 승인 받음

## 검증

```
pnpm verify   # typecheck + lint + test
```

- [ ] `pnpm typecheck` 통과
- [ ] `pnpm lint` 통과
- [ ] `pnpm test` 통과
- [ ] 파이프라인 5단계 완료 (dev → domain → test → quality → security)
- [ ] 불변식 회귀 테스트 추가/갱신 (해당 시)

<!-- 실패했다가 루프로 해결한 경우 기록을 붙여주세요:
     [loop 1/3] FAIL:… · CAUSE:… · FIX:… · RESULT:… -->

## 리뷰 포인트

<!-- 리뷰어가 특히 봐줬으면 하는 부분 -->
