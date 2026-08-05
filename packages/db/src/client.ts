import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema.js';

/**
 * 커넥션 — 프라이머리 / 읽기 복제본 분리 (INV-12)
 *
 * 어느 쪽을 읽었는지가 코드에서 드러나야 복제 지연으로 생긴 사고를 추적할 수 있다.
 * 그래서 자동 라우팅을 제공하지 않는다. 호출부가 매번 고르게 한다.
 *
 *   재고 차감 · 예약 상태 전이 · 정산 · 예약 직전 availability/check → primaryDb
 *   캘린더 조회 · 상품 탐색 · 리포트                                  → replicaDb
 *
 * 상시 기동 컨테이너이므로 Supavisor **session mode(5432)** 를 쓴다.
 * transaction mode(6543)는 prepared statement 를 지원하지 않는다.
 */

export type Database = NodePgDatabase<typeof schema>;

export interface DbConfig {
  readonly primaryUrl: string;
  /** 미설정 시 프라이머리로 폴백한다. 개발·소규모 환경에서는 복제본이 없다. */
  readonly replicaUrl?: string | undefined;
  readonly poolMax?: number;
  /** Supabase 는 자체 CA 를 쓰므로 로컬 스택 외에는 TLS 를 켠다. */
  readonly ssl?: boolean;
}

export interface DbHandles {
  readonly primaryDb: Database;
  readonly replicaDb: Database;
  readonly close: () => Promise<void>;
}

function createPool(connectionString: string, config: DbConfig): Pool {
  return new Pool({
    connectionString,
    // 풀 크기 × 인스턴스 수가 compute 등급의 커넥션 상한을 넘지 않아야 한다.
    max: config.poolMax ?? 20,
    idleTimeoutMillis: 30_000,
    // 커넥션 확보가 지연되면 요청이 무한정 매달리는 대신 빠르게 실패해야 한다.
    connectionTimeoutMillis: 10_000,
    ssl: config.ssl === true ? { rejectUnauthorized: false } : undefined,
  });
}

export function createDatabase(config: DbConfig): DbHandles {
  const primaryPool = createPool(config.primaryUrl, config);
  const primaryDb = drizzle(primaryPool, { schema });

  const replicaUrl =
    config.replicaUrl !== undefined && config.replicaUrl !== '' ? config.replicaUrl : null;

  // 복제본이 없으면 프라이머리를 그대로 쓴다. 동작은 같고 의도만 다르다 —
  // 나중에 복제본이 생겨도 호출부를 고칠 필요가 없다.
  const replicaPool = replicaUrl === null ? null : createPool(replicaUrl, config);
  const replicaDb = replicaPool === null ? primaryDb : drizzle(replicaPool, { schema });

  return {
    primaryDb,
    replicaDb,
    close: async () => {
      await primaryPool.end();
      if (replicaPool !== null) await replicaPool.end();
    },
  };
}

export { schema };
