/**
 * @ta/domain — 순수 도메인 로직
 *
 * 이 패키지는 NestJS·Next.js·Supabase·Drizzle 을 import 하지 않는다(ESLint 로 강제).
 * 덕분에 재고·가격·상태머신 규칙을 DB 없이 단위 테스트할 수 있고,
 * 배포 형태가 바뀌어도 도메인이 함께 흔들리지 않는다. — CLAUDE.md Rule #10
 */
export * from './errors.js';
export * from './money.js';
