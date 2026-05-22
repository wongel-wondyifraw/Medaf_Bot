import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './order.entity';
import { OrdersService } from './orders.service';
import { OrderDraftStateService } from './order-draft-state.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order])],
  providers: [OrdersService, OrderDraftStateService],
  exports: [OrdersService, OrderDraftStateService],
})
export class OrdersModule {}
