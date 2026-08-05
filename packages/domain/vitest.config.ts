import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      // 재고·가격·상태머신이 사는 패키지 — test_agent 기준 90%+
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
