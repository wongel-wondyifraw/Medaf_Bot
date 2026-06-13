import { DataSourceOptions } from 'typeorm';
import { Reseller } from '../resellers/reseller.entity';
import { Order } from '../orders/order.entity';
import { Admin } from '../admins/admin.entity';
import { Setting } from '../settings/setting.entity';
import { HealthLog } from '../health/health-log.entity';
import { Category } from '../categories/category.entity';
import { AedObservation } from '../observations/observation.entity';
import { InitialResellers1737490000000 } from '../migrations/1737490000000-InitialResellers';
import { Orders1779000000000 } from '../migrations/1779000000000-Orders';
import { OrderStatus1779100000000 } from '../migrations/1779100000000-OrderStatus';
import { Admins1779200000000 } from '../migrations/1779200000000-Admins';
import { Settings1779300000000 } from '../migrations/1779300000000-Settings';
import { HealthLog1779400000000 } from '../migrations/1779400000000-HealthLog';
import { Categories1779500000000 } from '../migrations/1779500000000-Categories';
import { OrderDetails1779600000000 } from '../migrations/1779600000000-OrderDetails';
import { RenameProductUrlToLink1779700000000 } from '../migrations/1779700000000-RenameProductUrlToLink';
import { OrderUsdPrices1779800000000 } from '../migrations/1779800000000-OrderUsdPrices';
import { CategoryCommission1780000000000 } from '../migrations/1780000000000-CategoryCommission';
import { CosmeticsCategory1780100000000 } from '../migrations/1780100000000-CosmeticsCategory';
import { CategoryDubaiFactor1780200000000 } from '../migrations/1780200000000-CategoryDubaiFactor';
import { AedObservations1780300000000 } from '../migrations/1780300000000-AedObservations';
import { RescaleDubaiFactor1780400000000 } from '../migrations/1780400000000-RescaleDubaiFactor';
import { WeddingDressCategory1780500000000 } from '../migrations/1780500000000-WeddingDressCategory';
import { TshirtDubaiFactor1780600000000 } from '../migrations/1780600000000-TshirtDubaiFactor';
import { CategoryDubaiFactorHigh1780700000000 } from '../migrations/1780700000000-CategoryDubaiFactorHigh';
import { CategoryThreeFactors1780800000000 } from '../migrations/1780800000000-CategoryThreeFactors';
import { CategoryAiCreated1780900000000 } from '../migrations/1780900000000-CategoryAiCreated';
import { UnderwearDubaiFactors1781000000000 } from '../migrations/1781000000000-UnderwearDubaiFactors';
import { DressDubaiFactor1781100000000 } from '../migrations/1781100000000-DressDubaiFactor';
import { OrderApprovalWorkflow1781200000000 } from '../migrations/1781200000000-OrderApprovalWorkflow';
import { OrderUserUnitAed1781300000000 } from '../migrations/1781300000000-OrderUserUnitAed';
import { TypeOrmConsoleLogger } from './typeorm-console.logger';

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
    entities: [Reseller, Order, Admin, Setting, HealthLog, Category, AedObservation],
    migrations: [
      InitialResellers1737490000000,
      Orders1779000000000,
      OrderStatus1779100000000,
      Admins1779200000000,
      Settings1779300000000,
      HealthLog1779400000000,
      Categories1779500000000,
      OrderDetails1779600000000,
      RenameProductUrlToLink1779700000000,
      OrderUsdPrices1779800000000,
      CategoryCommission1780000000000,
      CosmeticsCategory1780100000000,
      CategoryDubaiFactor1780200000000,
      AedObservations1780300000000,
      RescaleDubaiFactor1780400000000,
      WeddingDressCategory1780500000000,
      TshirtDubaiFactor1780600000000,
      CategoryDubaiFactorHigh1780700000000,
      CategoryThreeFactors1780800000000,
      CategoryAiCreated1780900000000,
      UnderwearDubaiFactors1781000000000,
      DressDubaiFactor1781100000000,
      OrderApprovalWorkflow1781200000000,
      OrderUserUnitAed1781300000000,
    ],
    synchronize: false,
    logging: opts.logging ? ['query', 'error', 'warn', 'schema', 'migration'] : ['error', 'warn', 'migration'],
    logger: new TypeOrmConsoleLogger(opts.logging),
    migrationsRun: opts.runMigrations,
  };
}
