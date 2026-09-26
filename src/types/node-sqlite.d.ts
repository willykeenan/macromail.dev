declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(
      path: string,
      options?: {
        readOnly?: boolean;
        enableForeignKeyConstraints?: boolean;
        timeout?: number;
      },
    );
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }

  export class StatementSync {
    run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }
}
