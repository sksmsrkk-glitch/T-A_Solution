#!/usr/bin/env node
// PostToolUse hook (Edit|Write): 수정된 파일에 하네스 규칙을 즉시 적용한다.
//
// 원본(compile_check.sh)은 JS 문법 검증만 했으나, 이 프로젝트의 사고는 문법이 아니라
// 도메인 규칙 위반에서 발생하므로(오버부킹·테넌트 노출·시크릿 유출) 정적 가드를 함께 건다.
//
//   BLOCK (exit 2) — 되돌릴 수 없는 사고로 직결되는 위반
//   WARN  (exit 0) — 검토가 필요한 신호. 작업은 계속 진행

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// stdin 은 스트림으로 읽는다 — readFileSync(0) 은 Windows 파이프에서 실패한다.
const readStdin = () =>
  new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (buf += d));
    process.stdin.on('end', () => resolve(buf.replace(/^﻿/, ''))); // BOM 방어
    process.stdin.on('error', () => resolve(''));
  });

const BLOCK = [];
const WARN = [];

/** 파일 내용에서 정규식에 걸린 첫 라인 번호를 찾는다 (보고용) */
const lineOf = (text, re) => {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => re.test(l));
  return i === -1 ? null : i + 1;
};

const add = (bucket, text, re, code, message) => {
  const line = lineOf(text, re);
  if (line !== null) bucket.push(`  [${code}] L${line} — ${message}`);
};

/** SQL 마이그레이션: 테넌트 테이블이면 같은 파일에 RLS 활성화가 있어야 한다 (INV-5) */
function checkSql(text, file) {
  const lower = text.toLowerCase();
  if (!/create\s+table/.test(lower)) return;

  const hasTenantColumn = /\btenant_id\b/.test(lower);
  const hasRls = /enable\s+row\s+level\s+security/.test(lower);
  const hasPolicy = /create\s+policy/.test(lower);

  if (hasTenantColumn && !hasRls) {
    BLOCK.push(
      `  [INV-5] tenant_id 컬럼을 가진 테이블을 생성하면서 RLS 를 활성화하지 않았습니다.\n` +
      `          같은 마이그레이션에 다음을 추가하세요:\n` +
      `            alter table <table> enable row level security;\n` +
      `            create policy tenant_isolation on <table>\n` +
      `              using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);`
    );
  } else if (hasTenantColumn && hasRls && !hasPolicy) {
    WARN.push(`  [INV-5] RLS 는 켰지만 정책(create policy)이 없습니다 — 전체 접근 차단 상태입니다.`);
  }

  if (/\bnumeric\b|\bdecimal\b|\bdouble\s+precision\b|\breal\b/.test(lower) &&
      /amount|price|fare|fee|net|total/.test(lower)) {
    WARN.push(`  [INV-10] 금액 컬럼에 부동소수/numeric 타입이 보입니다 — integer minor unit + currency 를 사용하세요.`);
  }

  if (/timestamptz/.test(lower) && /slot|availability/.test(lower)) {
    WARN.push(`  [INV-8] 슬롯 시각에 timestamptz 가 보입니다 — local_date/local_start_time + timezone 을 사용하세요.`);
  }

  if (/user_metadata/.test(lower)) {
    BLOCK.push(`  [INV-5] RLS 정책에 user_metadata 사용은 금지입니다(클라이언트 조작 가능). app_metadata 를 사용하세요.`);
  }

  if (/drop\s+(table|column)/.test(lower)) {
    WARN.push(`  [MIGRATION] 파괴적 변경(DROP)이 포함되어 있습니다 — 사용자 사전 승인이 필요합니다.`);
  }
}

/** TypeScript/JS: 시크릿 노출·타입 은폐·재고 안전성 정적 점검 */
function checkTs(text, file) {
  // 시크릿 — 클라이언트 번들 유출은 되돌릴 수 없다
  add(BLOCK, text, /NEXT_PUBLIC_[A-Z_]*(SERVICE_ROLE|SECRET|PRIVATE|SERVICE_KEY)/,
    'SECRET', 'NEXT_PUBLIC_* 환경변수에 비밀값이 담겨 있습니다 — 클라이언트 번들에 노출됩니다.');
  add(BLOCK, text, /(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})|(sb_secret_[A-Za-z0-9]{10,})/,
    'SECRET', '하드코딩된 토큰/키로 보이는 문자열이 있습니다 — 환경변수로 옮기세요.');

  const isClientFile = /[\\/](app|components|pages|hooks)[\\/]/.test(file) || /^'use client'/m.test(text);
  if (isClientFile && /service_role|SERVICE_ROLE_KEY/.test(text)) {
    BLOCK.push(`  [SECRET] 클라이언트 코드에서 service_role 키를 참조하고 있습니다 — 서버 전용입니다.`);
  }

  // 루프 엔지니어링 금지 우회
  add(BLOCK, text, /@ts-ignore/, 'LOOP', '@ts-ignore 로 타입 오류를 덮는 것은 금지입니다 (loop_agent forbidden_fixes).');
  add(WARN, text, /eslint-disable(?!-next-line)/, 'LOOP', '파일 단위 eslint-disable 이 있습니다 — 규칙을 끄지 말고 원인을 수정하세요.');
  add(WARN, text, /\bas\s+unknown\s+as\b/, 'TYPE', '이중 단언(as unknown as)은 타입 은폐 신호입니다.');
  add(WARN, text, /:\s*any\b|<any>/, 'TYPE', '`any` 사용이 감지되었습니다 — strict 정책상 금지입니다.');
  add(WARN, text, /\.(skip|todo)\s*\(|xit\s*\(|xdescribe\s*\(/, 'LOOP', '테스트 skip 이 있습니다 — 통과를 위한 우회인지 확인하세요.');

  // 재고 안전성 (INV-1)
  if (/capacity\s*\?\?\s*0|capacity\s*\|\|\s*0/.test(text)) {
    BLOCK.push(`  [INV-1] capacity 의 NULL 은 "무제한(FREESALE)"을 의미합니다. \`?? 0\` 로 기본값을 넣으면 무한재고 상품이 즉시 매진됩니다.`);
  }
  if (/held_count\s*=\s*held_count\s*\+/.test(text) && !/capacity\s+is\s+null/i.test(text)) {
    WARN.push(`  [INV-1] 재고 차감 UPDATE 에 \`capacity IS NULL\` 분기가 보이지 않습니다 — FREESALE 상품이 매진 처리될 수 있습니다.`);
  }

  // SQL 인젝션 — 문자열 보간 SQL
  add(BLOCK, text, /(execute|query|raw)\s*\(\s*[`'"][^`'"]*\$\{/, 'SQLI',
    '문자열 보간으로 SQL 을 조립하고 있습니다 — Drizzle 또는 파라미터 바인딩을 사용하세요.');

  // 읽기 복제본 오용 (INV-12) — 복제본은 SELECT 전용이고 비동기 지연이 있다
  add(BLOCK, text, /replicaDb\s*(\.\w+)*\s*\.\s*(insert|update|delete)\s*\(/, 'INV-12',
    '읽기 복제본에 쓰기를 시도하고 있습니다 — 복제본은 SELECT 전용입니다. primaryDb 를 사용하세요.');
  if (/replicaDb/.test(text) && /(held_count|booked_count|BookingState|price_snapshot)/.test(text)) {
    WARN.push(`  [INV-12] 재고·예약 상태 코드에서 replicaDb 참조가 보입니다 — 복제 지연으로 오버부킹이 발생할 수 있습니다. 차감·전이·확정 판정은 primaryDb 여야 합니다.`);
  }

  // N+1 (Rule #16) — 루프 안 await 쿼리
  if (/for\s*\(|\.forEach\s*\(/.test(text) && /await\s+(primaryDb|replicaDb|db)\s*\./.test(text)) {
    WARN.push(`  [PERF] 반복문 안에서 쿼리를 await 하고 있을 수 있습니다 (N+1) — 배치 조회로 대체하세요.`);
  }
}

/** ESLint 가 설치되어 있으면 실제 린트를 돌린다 (없으면 조용히 생략) */
function runEslint(file) {
  const r = spawnSync('npx', ['--no', 'eslint', file], {
    encoding: 'utf8', shell: process.platform === 'win32', timeout: 45_000,
  });
  if (r.error || r.status === null) return null;      // eslint 미설치 등 → 생략
  return r.status === 0 ? null : (r.stdout || r.stderr || '').trim();
}

try {
  const input = JSON.parse(await readStdin());
  const file = String(input?.tool_input?.file_path ?? '');

  // 하네스 설정·문서 자체는 검사 대상이 아니다
  const skip = !file || /[\\/]\.claude[\\/]|[\\/]docs[\\/]|[\\/]node_modules[\\/]/.test(file);
  const isSql = /\.sql$/i.test(file);
  const isTs = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(file);

  if (skip || (!isSql && !isTs) || !existsSync(file)) process.exit(0);

  const text = readFileSync(file, 'utf8');
  if (isSql) checkSql(text, file);
  if (isTs) {
    checkTs(text, file);
    const lint = runEslint(file);
    if (lint) BLOCK.push(`  [ESLINT] 린트 오류:\n${lint}`);
  }

  if (BLOCK.length > 0) {
    process.stderr.write(
      `하네스 규칙 위반 — 다음을 수정한 뒤 진행하세요: ${file}\n${BLOCK.join('\n')}\n` +
      (WARN.length ? `\n[참고]\n${WARN.join('\n')}\n` : '') +
      `\n근거: .claude/CLAUDE.md 도메인 불변식 / .claude/skills/loop_agent.skill.yaml\n`
    );
    process.exit(2); // 차단 — Claude 에게 피드백
  }

  if (WARN.length > 0) {
    process.stdout.write(`[하네스 경고] ${file}\n${WARN.join('\n')}\n`);
  } else {
    process.stdout.write(`[하네스 검증 통과] ${file}\n`);
  }
} catch {
  // 훅 자체의 실패가 작업을 막아서는 안 된다
}

process.exit(0);
