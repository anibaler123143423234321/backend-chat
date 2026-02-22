import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemConfigService } from 'src/02.-Services/system-config/system-config.service';
import { SystemConfigController } from 'src/02.-Services/system-config/system-config.controller';
import { SystemConfig } from 'src/02.-Services/system-config/entities/system-config.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SystemConfig])],
  controllers: [SystemConfigController],
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule { }
