// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * 이 설정은 하네스의 일부다. CLAUDE.md 의 레이어 경계와 코딩 원칙을
 * "리뷰에서 지적"이 아니라 "CI 에서 실패"로 강제한다.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      'supabase/.temp/**',
      '.claude/hooks/**', // 하네스 훅은 순수 Node 스크립트 — 별도 규칙 적용 대상 아님
    ],
  },

  js.configs.recommended,

  /* 타입 인지 린트는 패키지·앱 소스에만 적용한다 (설정 파일은 프로젝트에 포함되지 않음) */
  {
    files: ['{packages,apps}/*/src/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /* 비동기 누락은 재고 차감·상태 전이에서 조용한 데이터 오류가 된다 */
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',

      /* CLAUDE.md: any 금지 */
      '@typescript-eslint/no-explicit-any': 'error',

      /* 루프 엔지니어링 금지 우회 — 타입 오류를 주석으로 덮지 않는다 */
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-expect-error': 'allow-with-description' },
      ],

      /* 의도적 미사용은 _ 접두사로 명시 */
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  /* INV 레이어 경계 (CLAUDE.md Rule #10, quality_agent):
     packages/domain 은 프레임워크·인프라를 몰라야 한다.
     이 경계가 지켜져야 도메인 규칙을 DB 없이 단위 테스트할 수 있고,
     배포 형태가 바뀌어도 도메인이 따라 흔들리지 않는다. */
  {
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@nestjs/*',
                'next',
                'next/*',
                'react',
                'react-dom',
                '@supabase/*',
                'drizzle-orm',
                'drizzle-orm/*',
                'pg',
                'postgres',
                'ioredis',
                'bullmq',
              ],
              message:
                'packages/domain 은 프레임워크·인프라에 의존하지 않는다 (레이어 경계). 순수 도메인 로직만 둘 것 — CLAUDE.md Rule #10.',
            },
          ],
        },
      ],
    },
  },

  /* 테스트는 일부 규칙을 완화한다 (단, 단언 완화·skip 은 loop_agent 가 별도로 막는다) */
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  /* Prettier 와 충돌하는 포맷 규칙을 끈다 — 포맷은 prettier 단독 책임 */
  prettier,
);
