import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Admin } from './admin.entity';
import { AdminsService } from './admins.service';
import { AddPriceStateService } from './add-price-state.service';
import { AdminAuthStateService } from './admin-auth-state.service';
import { AdminNotificationsService } from './admin-notifications.service';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [TypeOrmModule.forFeature([Admin]), OrdersModule],
  providers: [
    AdminsService,
    AdminAuthStateService,
    AddPriceStateService,
    AdminNotificationsService,
  ],
  exports: [
    AdminsService,
    AdminAuthStateService,
    AddPriceStateService,
    AdminNotificationsService,
  ],
})
export class AdminsModule {}
