import { DataSourceOptions } from 'typeorm';
import { Reseller } from '../resellers/reseller.entity';
import { Order } from '../orders/order.entity';
import { Admin } from '../admins/admin.entity';
import { Setting } from '../settings/setting.entity';
import { HealthLog } from '../health/health-log.entity';
import { Category } from '../categories/category.entity';
import { InitialResellers1737490000000 } from '../migrations/1737490000000-InitialResellers';
import { Orders1779000000000 } from '../migrations/1779000000000-Orders';
import { OrderStatus1779100000000 } from '../migrations/1779100000000-OrderStatus';
import { Admins1779200000000 } from '../migrations/1779200000000-Admins';
import { Settings1779300000000 } from '../migrations/1779300000000-Settings';
import { HealthLog1779400000000 } from '../migrations/1779400000000-HealthLog';
import { Categories1779500000000 } from '../migrations/1779500000000-Categories';

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
    entities: [Reseller, Order, Admin, Setting, HealthLog, Category],
    migrations: [
      InitialResellers1737490000000,
      Orders1779000000000,
      OrderStatus1779100000000,
      Admins1779200000000,
      Settings1779300000000,
      HealthLog1779400000000,
      Categories1779500000000,
    ],
    synchronize: false,
    logging: opts.logging,
    migrationsRun: opts.runMigrations,
  };
}
