import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reseller } from './reseller.entity';
import { ResellersService } from './resellers.service';

@Module({
  imports: [TypeOrmModule.forFeature([Reseller])],
  providers: [ResellersService],
  exports: [ResellersService],
})
export class ResellersModule {}
