#!/usr/bin/env node
// UserPromptSubmit hook: 개발 트리거 감지 → pipeline.yaml 파이프라인 지시문 주입
// triggers.yaml 의 develop 섹션과 동기화 유지.
// Node 구현 이유: 원본(bash + jq)은 Windows 환경에서 jq 부재·WSL 경로 문제로 동작하지 않음.

// stdin 은 스트림으로 읽는다 — readFileSync(0) 은 Windows 파이프에서 실패한다.
const readStdin = () =>
  new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (buf += d));
    process.stdin.on('end', () => resolve(buf.replace(/^﻿/, ''))); // BOM 방어
    process.stdin.on('error', () => resolve(''));
  });

// triggers.yaml develop 섹션 + 확장 패턴
const TRIGGERS = [
  '개발해줘',
  '이거 구현해줘',
  '이 기능 추가해줘',
  '리팩터링 해줘',
  '코드 개선해줘',
  '작업 진행해',
  '작업해줘',
  '구현해줘',
  '개발 시작',
  '기능 개발',
  '코드 작성해줘',
  'API 만들어줘',
  '화면 만들어줘',
  '모듈 추가해줘',
  '작업해',
  '진행해',
];

const INSTRUCTION = `[PIPELINE ACTIVATED] pipeline.yaml 의 5단계 파이프라인을 순서대로 실행하세요.

단계별 규칙:
  1. [development] dev_agent.skill.yaml      → 근거 문서 확인 후 코드 작성/수정
     - PostToolUse 훅(verify_hook.mjs)이 TS/SQL 수정 시 하네스 규칙을 자동 검증
  2. [domain]      domain_agent.skill.yaml   → 도메인 불변식 INV-1~11 전수 점검
     - 오버부킹(원자적 차감) / 가격 스냅샷·우선순위 / 예약 상태머신 / 테넌트 격리·entitlement
     - docs/07 해당 상품 케이스와 절차 대조
  3. [testing]     test_agent.skill.yaml     → Vitest/Supertest 테스트 작성 및 실행
     - 불변식 회귀 테스트(동시성·멱등성·스냅샷·격리·게이팅) 필수 포함
  4. [quality]     quality_agent.skill.yaml  → typecheck 0 · lint 0 · 레이어 경계 검증
  5. [security]    security_agent.skill.yaml → RLS·시크릿·입력검증·OCTO 파트너 인증 점검

실행 규칙:
  - 각 단계 완료 후 결과를 보고하고 다음 단계 진행 승인을 받을 것 (require_approval_before_next_stage: true)
  - 단계 실패 시 즉시 중단 (stop_on_failure: true) 후 loop_agent.skill.yaml 루프 진입
  - [LOOP] 최대 3회: OBSERVE → DIAGNOSE → PATCH(최소 변경) → VERIFY(pnpm verify) → JUDGE
    · 매 반복마다 "[loop N/3] FAIL:… · CAUSE:… · FIX:… · RESULT:…" 기록
    · 테스트 완화 / any / @ts-ignore / eslint-disable / RLS 우회로 통과시키는 것 금지
    · 3회 미수렴 · 불변식 위반 필요 · 설계 문서 변경 필요 시 즉시 사용자 에스컬레이션`;

try {
  const prompt = String(JSON.parse(await readStdin())?.prompt ?? '');

  if (TRIGGERS.some((t) => prompt.includes(t))) {
    process.stdout.write(INSTRUCTION);
  }
} catch {
  // 훅 실패가 사용자 작업을 막아서는 안 된다 — 조용히 통과
}

process.exit(0);
