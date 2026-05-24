import { Logger as NestLogger } from '@nestjs/common';
import type { Logger, QueryRunner } from 'typeorm';

export class TypeOrmConsoleLogger implements Logger {
  private readonly logger = new NestLogger('TypeORM');

  constructor(private readonly logQueries: boolean) {}

  logQuery(query: string, parameters?: unknown[], _queryRunner?: QueryRunner): void {
    if (!this.logQueries) return;
    this.logger.debug(`QUERY ${query} ${this.formatParameters(parameters)}`);
  }

  logQueryError(
    error: string | Error,
    query: string,
    parameters?: unknown[],
    _queryRunner?: QueryRunner,
  ): void {
    const message = error instanceof Error ? error.message : error;
    this.logger.error(`QUERY ERROR ${message} query=${query} ${this.formatParameters(parameters)}`);
  }

  logQuerySlow(
    time: number,
    query: string,
    parameters?: unknown[],
    _queryRunner?: QueryRunner,
  ): void {
    this.logger.warn(`SLOW QUERY ${time}ms query=${query} ${this.formatParameters(parameters)}`);
  }

  logSchemaBuild(message: string, _queryRunner?: QueryRunner): void {
    this.logger.log(`SCHEMA ${message}`);
  }

  logMigration(message: string, _queryRunner?: QueryRunner): void {
    this.logger.log(`MIGRATION ${message}`);
  }

  log(level: 'log' | 'info' | 'warn', message: unknown, _queryRunner?: QueryRunner): void {
    const text = String(message);
    if (level === 'warn') {
      this.logger.warn(text);
      return;
    }
    this.logger.log(text);
  }

  private formatParameters(parameters?: unknown[]): string {
    if (!parameters?.length) return '';
    try {
      return `params=${JSON.stringify(parameters)}`;
    } catch {
      return 'params=[unserializable]';
    }
  }
}
