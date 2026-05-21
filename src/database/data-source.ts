import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from './typeorm-options';

function envBool(name: string, fallback = false): boolean {
  const v = (process.env[name] || '').toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}

export default new DataSource(
  buildTypeOrmOptions({
    url: process.env.DATABASE_URL || '',
    logging: envBool('TYPEORM_LOGGING'),
    runMigrations: false,
  }),
);
