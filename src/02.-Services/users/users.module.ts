import { Module } from '@nestjs/common';
import { UsersService } from 'src/02.-Services/users/users.service';

@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule { }
