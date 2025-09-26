import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TemporaryRoomsService } from './temporary-rooms.service';
import { TemporaryRoomsController } from './temporary-rooms.controller';
import { TemporaryRoom } from './entities/temporary-room.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([TemporaryRoom]), AuthModule],
  controllers: [TemporaryRoomsController],
  providers: [TemporaryRoomsService],
  exports: [TemporaryRoomsService],
})
export class TemporaryRoomsModule {}
