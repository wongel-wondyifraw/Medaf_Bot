import { DataSourceOptions } from 'typeorm';
import { Reseller } from '../resellers/reseller.entity';
import { Order } from '../orders/order.entity';
import { InitialResellers1737490000000 } from '../migrations/1737490000000-InitialResellers';
import { Orders1779000000000 } from '../migrations/1779000000000-Orders';
import { OrderStatus1779100000000 } from '../migrations/1779100000000-OrderStatus';

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
    entities: [Reseller, Order],
    migrations: [
      InitialResellers1737490000000,
      Orders1779000000000,
      OrderStatus1779100000000,
    ],
    synchronize: false,
    logging: opts.logging,
    migrationsRun: opts.runMigrations,
  };
}
