import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RideCacheService } from './cache/ride-cache.service';
import { Ride } from './domain/ride.entity';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';

@Module({
  imports: [TypeOrmModule.forFeature([Ride])],
  controllers: [RidesController],
  providers: [RidesService, RideCacheService],
})
export class RidesModule {}
