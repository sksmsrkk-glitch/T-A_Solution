/**
 * @ta/db — 스키마와 커넥션.
 *
 * 이 패키지가 지켜야 할 규칙:
 *
 *  - 커넥션은 `primaryDb` / `replicaDb` 로 **명시 분리**한다 (INV-12).
 *    암묵적 라우팅은 금지 — 어느 쪽을 읽었는지 코드에서 보이지 않으면
 *    복제 지연으로 생긴 오버부킹을 프로덕션에서 추적할 수 없다.
 *  - 재고 차감·예약 상태 전이·정산은 언제나 `primaryDb`.
 *  - 캘린더 조회·리포트만 `replicaDb` 를 쓸 수 있다.
 *  - REPLICA_DATABASE_URL 미설정 시 `replicaDb` 는 프라이머리로 폴백한다.
 *  - 스키마의 진실은 `supabase/migrations/` SQL 이다 (Rule #11).
 */
export * from './client.js';
export * from './inventory.repository.js';
export * as schemaTables from './schema.js';
