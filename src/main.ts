import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { RedisIoAdapter } from './socket/redis-io.adapter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as basicAuth from 'express-basic-auth';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ forbidUnknownValues: false }));

  // Configurar CORS
  app.enableCors({
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3000',
      'http://localhost:4200',
      'https://apisozarusac.com',
      'https://apisozarusac.com/BackendJava',
      'https://apisozarusac.com/BackendJavaMidas',
      'https://apisozarusac.com/BackendChat',
      'https://chat.mass34.com',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
  });

  // Configurar prefijo global para todas las rutas
  app.setGlobalPrefix('api');

  // Configurar Swagger
  const config = new DocumentBuilder()
    .setTitle('Backend Chat API')
    .setDescription('Documentación de las APIs del sistema de Chat')
    .setVersion('1.0')
    .addTag('Mensajería', 'Envío, recepción y gestión de mensajes')
    .addTag('Salas y Grupos', 'Gestión de salas temporales y grupos de chat')
    .addTag('Favoritos (Salas)', 'Gestión de salas marcadas como favoritas')
    .addTag('Chats Asignados', 'Conversaciones directas entre usuarios asignadas')
    .addTag('Configuración', 'Ajustes globales del sistema de chat')
    .addTag('Favoritos (Chats)', 'Gestión de conversaciones favoritas')
    .addTag('Búsquedas Recientes', 'Historial de términos buscados por el usuario')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

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

  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
    },
  });

  // Configurar Redis Adapter para Socket.IO
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  const port = process.env.PORT || 8747;
  await app.listen(port, '0.0.0.0');
  // console.log(`ðŸŒ CORS enabled for frontend origins`);
}
bootstrap();
