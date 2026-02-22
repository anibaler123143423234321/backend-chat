import { DocumentBuilder, SwaggerCustomOptions } from '@nestjs/swagger';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const appUrl = (process.env.APP_URL || 'http://localhost:8747').replace(/\/$/, '');

export const swaggerConfig = new DocumentBuilder()
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
    .addServer(appUrl)
    .addBearerAuth()
    .build();

export const swaggerOptions: SwaggerCustomOptions = {
    swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'none',
    },
};
