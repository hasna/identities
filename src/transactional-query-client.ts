import type { QueryResultRow } from "pg";
import type {
  QueryResult,
  TypedQueryClient,
} from "./generated/storage-kit/query.js";

/**
 * Query and transaction surface safe to expose to package consumers.
 *
 * Unlike the generated `PoolQueryClient`, this contract has no raw `pg.Pool`
 * or pool-closing method in its public object graph.
 */
export interface TransactionalQueryClient extends TypedQueryClient {
  transaction<T>(fn: (client: TypedQueryClient) => Promise<T>): Promise<T>;
}

/** Restrict a query client to the public, pool-free surface. */
export function restrictTypedQueryClient(source: TypedQueryClient): TypedQueryClient {
  const restricted: TypedQueryClient = {
    async query<T extends QueryResultRow>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<QueryResult<T>> {
      return source.query<T>(sql, params);
    },
    async many<T extends QueryResultRow>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<T[]> {
      return source.many<T>(sql, params);
    },
    async get<T extends QueryResultRow>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<T | null> {
      return source.get<T>(sql, params);
    },
    async one<T extends QueryResultRow>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<T> {
      return source.one<T>(sql, params);
    },
    async execute(sql: string, params?: readonly unknown[]): Promise<void> {
      await source.execute(sql, params);
    },
  };
  return Object.freeze(restricted);
}

/** Restrict a transactional query client to the public, pool-free surface. */
export function restrictTransactionalQueryClient(
  source: TransactionalQueryClient,
): TransactionalQueryClient {
  const restricted: TransactionalQueryClient = {
    ...restrictTypedQueryClient(source),
    async transaction<T>(
      fn: (client: TypedQueryClient) => Promise<T>,
    ): Promise<T> {
      return source.transaction(fn);
    },
  };
  return Object.freeze(restricted);
}
