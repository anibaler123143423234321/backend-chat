import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from './entities/system-config.entity';

@Injectable()
export class SystemConfigService {
  constructor(
    @InjectRepository(SystemConfig)
    private systemConfigRepository: Repository<SystemConfig>,
  ) {}

  async getConfig(key: string): Promise<string> {
    const config = await this.systemConfigRepository.findOne({
      where: { key, isActive: true },
    });

    if (!config) {
      throw new NotFoundException(`Configuración '${key}' no encontrada`);
    }

    return config.value;
  }

  async setConfig(
    key: string,
    value: string,
    description?: string,
  ): Promise<SystemConfig> {
    let config = await this.systemConfigRepository.findOne({
      where: { key },
    });

    if (config) {
      config.value = value;
      config.description = description || config.description;
    } else {
      config = this.systemConfigRepository.create({
        key,
        value,
        description,
        type: 'string',
        isActive: true,
      });
    }

    return await this.systemConfigRepository.save(config);
  }

  async getAllConfigs(): Promise<SystemConfig[]> {
    return await this.systemConfigRepository.find({
      where: { isActive: true },
      order: { key: 'ASC' },
    });
  }

  async deleteConfig(key: string): Promise<void> {
    const config = await this.systemConfigRepository.findOne({
      where: { key },
    });

    if (config) {
      config.isActive = false;
      await this.systemConfigRepository.save(config);
    }
  }

  // Métodos específicos para configuraciones comunes
  async getMessageExpirationDays(): Promise<number> {
    const value = await this.getConfig('message_expiration_days');
    return parseInt(value) || 30;
  }

  async setMessageExpirationDays(days: number): Promise<SystemConfig> {
    return await this.setConfig(
      'message_expiration_days',
      days.toString(),
      'Días de expiración de mensajes',
    );
  }

  async getMaxFileSizeMB(): Promise<number> {
    const value = await this.getConfig('max_file_size_mb');
    return parseInt(value) || 50;
  }

  async setMaxFileSizeMB(mb: number): Promise<SystemConfig> {
    return await this.setConfig(
      'max_file_size_mb',
      mb.toString(),
      'Tamaño máximo de archivos en MB',
    );
  }

  async getNotificationSettings(): Promise<any> {
    const sound = await this.getConfig('notification_sound');
    const visual = await this.getConfig('notification_visual');
    const email = await this.getConfig('notification_email');

    return {
      sound: sound === 'true',
      visual: visual === 'true',
      email: email === 'true',
    };
  }

  async setNotificationSettings(settings: {
    sound: boolean;
    visual: boolean;
    email: boolean;
  }): Promise<void> {
    await this.setConfig(
      'notification_sound',
      settings.sound.toString(),
      'Notificaciones de sonido',
    );
    await this.setConfig(
      'notification_visual',
      settings.visual.toString(),
      'Notificaciones visuales',
    );
    await this.setConfig(
      'notification_email',
      settings.email.toString(),
      'Notificaciones por email',
    );
  }
}
