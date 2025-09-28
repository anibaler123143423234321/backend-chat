import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ forbidUnknownValues: false }));

  // Configurar CORS
  app.enableCors({
    origin: [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:4200',
      'https://apisozarusac.com',
      'https://apisozarusac.com/BackendJava',
      'https://apisozarusac.com/BackendChat',
      'https://mensajeria.mass34.com',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
  });

  // Configurar prefijo global para todas las rutas
  app.setGlobalPrefix('BackendChat/api');
  //app.setGlobalPrefix('/api');

  const port = process.env.PORT || 8747;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Chat Backend running on port ${port}`);
  // console.log(`🌐 CORS enabled for frontend origins`);
}
bootstrap();
