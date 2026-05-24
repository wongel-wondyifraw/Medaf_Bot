import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AedObservation } from './observation.entity';
import { ObservationsService } from './observations.service';

@Module({
  imports: [TypeOrmModule.forFeature([AedObservation])],
  providers: [ObservationsService],
  exports: [ObservationsService],
})
export class ObservationsModule {}
