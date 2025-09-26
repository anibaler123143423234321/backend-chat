import { Controller, Get, Post, Body, Param, Delete, UseGuards } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('system-config')
@UseGuards(JwtAuthGuard)
export class SystemConfigController {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  @Get()
  getAllConfigs() {
    return this.systemConfigService.getAllConfigs();
  }

  @Get('message-expiration')
  getMessageExpirationDays() {
    return this.systemConfigService.getMessageExpirationDays();
  }

  @Post('message-expiration')
  setMessageExpirationDays(@Body() body: { days: number }) {
    return this.systemConfigService.setMessageExpirationDays(body.days);
  }

  @Get('max-file-size')
  getMaxFileSizeMB() {
    return this.systemConfigService.getMaxFileSizeMB();
  }

  @Post('max-file-size')
  setMaxFileSizeMB(@Body() body: { mb: number }) {
    return this.systemConfigService.setMaxFileSizeMB(body.mb);
  }

  @Get('notifications')
  getNotificationSettings() {
    return this.systemConfigService.getNotificationSettings();
  }

  @Post('notifications')
  setNotificationSettings(@Body() body: { sound: boolean; visual: boolean; email: boolean }) {
    return this.systemConfigService.setNotificationSettings(body);
  }

  @Get(':key')
  getConfig(@Param('key') key: string) {
    return this.systemConfigService.getConfig(key);
  }

  @Post(':key')
  setConfig(@Param('key') key: string, @Body() body: { value: string; description?: string }) {
    return this.systemConfigService.setConfig(key, body.value, body.description);
  }

  @Delete(':key')
  deleteConfig(@Param('key') key: string) {
    return this.systemConfigService.deleteConfig(key);
  }
}
