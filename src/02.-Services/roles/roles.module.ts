import { Module } from '@nestjs/common';
import { RolesService } from 'src/02.-Services/roles/roles.service';

@Module({
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule { }
