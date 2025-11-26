import { CacheModuleOptions } from '@nestjs/cache-manager';
import * as redisStore from 'cache-manager-redis-store';

export const redisConfig: CacheModuleOptions = {
  store: redisStore,
  host: process.env.REDIS_HOST || '198.46.186.2',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || 'Midas*2025',
  ttl: 300, // 5 minutos de TTL por defecto
  max: 1000, // Máximo 1000 items en cache
  isGlobal: true, // Cache disponible globalmente
};
