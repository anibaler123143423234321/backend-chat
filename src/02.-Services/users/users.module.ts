import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from 'src/02.-Services/users/users.service';
import { UsersController } from 'src/02.-Services/users/users.controller';
import { User } from 'src/02.-Services/users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule { }
