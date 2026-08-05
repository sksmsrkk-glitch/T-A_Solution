#!/usr/bin/env node
// 하네스 훅 자가 점검. 실행: node .claude/hooks/selftest.mjs
// 훅이 실제로 트리거를 잡고 불변식 위반을 차단하는지 확인한다.

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (hook, payload) => {
  const r = spawnSync(process.execPath, [join('.claude', 'hooks', hook)], {
    input: Buffer.from(JSON.stringify(payload), 'utf8'),
    encoding: 'utf8',
  });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
};

const tmp = mkdtempSync(join(tmpdir(), 'ta-harness-'));
const fixture = (name, content) => {
  const p = join(tmp, name);
  writeFileSync(p, content, 'utf8');
  return p;
};

const cases = [];
const check = (name, cond, detail = '') => cases.push({ name, ok: !!cond, detail });

// 1. 트리거 감지
const hit = run('pipeline_trigger.mjs', { prompt: '예약 모듈 구현해줘' });
check('트리거 감지 → 파이프라인 지시문 주입', hit.out.includes('PIPELINE ACTIVATED'), hit.out.slice(0, 80));

const miss = run('pipeline_trigger.mjs', { prompt: '오늘 날씨 어때?' });
check('비트리거 → 주입 없음', miss.out.trim() === '', miss.out.slice(0, 80));

// 2. INV-5 — RLS 누락 차단
const sqlBad = fixture('bad.sql',
  `create table booking (id uuid primary key, tenant_id uuid not null);`);
const r1 = run('verify_hook.mjs', { tool_input: { file_path: sqlBad } });
check('INV-5 RLS 누락 SQL 차단', r1.code === 2 && r1.out.includes('INV-5'), `exit=${r1.code}`);

const sqlOk = fixture('ok.sql',
  `create table booking (id uuid primary key, tenant_id uuid not null);
   alter table booking enable row level security;
   create policy tenant_isolation on booking
     using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);`);
const r2 = run('verify_hook.mjs', { tool_input: { file_path: sqlOk } });
check('정상 RLS SQL 통과', r2.code === 0, `exit=${r2.code} ${r2.out.slice(0, 120)}`);

// 3. INV-1 — capacity NULL 기본값 차단
const tsBad = fixture('inv1.ts', `const remaining = slot.capacity ?? 0;`);
const r3 = run('verify_hook.mjs', { tool_input: { file_path: tsBad } });
check('INV-1 capacity ?? 0 차단', r3.code === 2 && r3.out.includes('INV-1'), `exit=${r3.code}`);

// 4. 시크릿 노출 차단
const tsSecret = fixture('secret.ts',
  `export const k = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;`);
const r4 = run('verify_hook.mjs', { tool_input: { file_path: tsSecret } });
check('시크릿 NEXT_PUBLIC_*SERVICE_ROLE 차단', r4.code === 2 && r4.out.includes('SECRET'), `exit=${r4.code}`);

// 5. 루프 우회 차단
const tsIgnore = fixture('ignore.ts', `// @ts-ignore\nconst x: string = 1;`);
const r5 = run('verify_hook.mjs', { tool_input: { file_path: tsIgnore } });
check('@ts-ignore 차단', r5.code === 2 && r5.out.includes('LOOP'), `exit=${r5.code}`);

// 6. 하네스 자체 파일은 검사 제외
const r6 = run('verify_hook.mjs', { tool_input: { file_path: '.claude/CLAUDE.md' } });
check('.claude/ 파일은 검사 제외', r6.code === 0, `exit=${r6.code}`);

rmSync(tmp, { recursive: true, force: true });

const failed = cases.filter((c) => !c.ok);
for (const c of cases) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : `  → ${c.detail}`}`);
console.log(`\n${cases.length - failed.length}/${cases.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
