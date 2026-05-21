import { DataSourceOptions } from 'typeorm';
import { Reseller } from '../resellers/reseller.entity';
import { InitialResellers1737490000000 } from '../migrations/1737490000000-InitialResellers';

export function buildTypeOrmOptions(opts: {
  url: string;
  logging: boolean;
  runMigrations: boolean;
}): DataSourceOptions {
  if (!opts.url) {
    throw new Error('DATABASE_URL is missing from .env.');
  }
  return {
    type: 'postgres',
    url: opts.url,
    entities: [Reseller],
    migrations: [InitialResellers1737490000000],
    synchronize: false,
    logging: opts.logging,
    migrationsRun: opts.runMigrations,
  };
}
