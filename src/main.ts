import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { RedisIoAdapter } from './01.-Infraestructura/redis/redis-io.adapter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as basicAuth from 'express-basic-auth';
import { corsConfig } from './01.-Infraestructura/security/cors.config';
import { swaggerConfig, swaggerOptions } from './01.-Infraestructura/config/swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ forbidUnknownValues: false }));

  // Configurar CORS
  app.enableCors(corsConfig);

  // Configurar prefijo global para todas las rutas
  app.setGlobalPrefix('api');

  // Configurar Swagger
  const document = SwaggerModule.createDocument(app, swaggerConfig);

  // Protección de Swagger con Basic Auth
  app.use(
    ['/api/docs', '/api/docs-json'],
    basicAuth({
      challenge: true,
      users: {
        admin: 'S0zaru2024*', // Puedes cambiar esto por variables de entorno
      },
    }),
  );

  SwaggerModule.setup('api/docs', app, document, swaggerOptions);

  // Configurar Redis Adapter para Socket.IO
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  const port = process.env.PORT || 8747;
  await app.listen(port, '0.0.0.0');
}
bootstrap();
