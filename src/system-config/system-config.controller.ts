import { Controller, Get, Post, Body, Param, Delete, UseGuards } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';

import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiBody } from '@nestjs/swagger';

@ApiTags('Configuración')
@ApiBearerAuth()
@Controller('system-config')
export class SystemConfigController {
  constructor(private readonly systemConfigService: SystemConfigService) { }

  @Get()
  @ApiOperation({ summary: 'Obtener toda la configuración del sistema' })
  @ApiResponse({ status: 200, description: 'Configuraciones recuperadas' })
  getAllConfigs() {
    return this.systemConfigService.getAllConfigs();
  }

  @Get('message-expiration')
  getMessageExpirationDays() {
    return this.systemConfigService.getMessageExpirationDays();
  }

  @Post('message-expiration')
  @ApiOperation({ summary: 'Establecer días de expiración de mensajes' })
  @ApiBody({ schema: { type: 'object', properties: { days: { type: 'number' } } } })
  @ApiResponse({ status: 200, description: 'Configuración actualizada' })
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
