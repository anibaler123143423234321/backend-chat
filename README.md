# 💬 Backend Chat - Sistema de Mensajería en Tiempo Real

Backend robusto de chat en tiempo real construido con **NestJS**, **TypeORM**, **Socket.IO** y **MySQL**, diseñado para manejar conversaciones privadas, salas de grupo, mensajería multimedia y videollamadas.

## 🚀 Características

### Mensajería
- ✅ Chat en tiempo real con WebSockets (Socket.IO)
- ✅ Mensajes privados 1-a-1
- ✅ Salas de grupo (públicas y privadas)
- ✅ Conversaciones asignadas por administradores
- ✅ Sistema de hilos de conversación
- ✅ Respuestas a mensajes específicos
- ✅ Reacciones con emojis
- ✅ Indicadores de escritura en tiempo real
- ✅ Detección de mensajes duplicados

### Multimedia
- 📷 Envío de imágenes
- 🎥 Envío de videos
- 🎵 Mensajes de audio
- 📎 Documentos y archivos
- 📹 Integración con videollamadas

### Gestión
- 👥 Sistema de usuarios con roles (ADMIN, USER)
- 🔐 Autenticación con JWT
- 📊 Contadores de mensajes no leídos
- 📌 Favoritos de salas y conversaciones
- 🗳️ Sistema de encuestas
- 🗄️ Soft delete de mensajes
- ⏰ Zona horaria de Perú (America/Lima)

## 🛠️ Stack Tecnológico

| Tecnología | Versión | Propósito |
|------------|---------|-----------|
| **NestJS** | 10.3.8 | Framework backend |
| **TypeORM** | 0.3.20 | ORM para MySQL |
| **Socket.IO** | 4.7.5 | WebSockets en tiempo real |
| **MySQL** | 8.x | Base de datos principal |
| **Redis** | 6.x | Cache distribuido |
| **JWT** | 10.2.0 | Autenticación |
| **TypeScript** | 5.1.3 | Lenguaje principal |

## 📋 Requisitos Previos

- **Node.js** >= 18.x
- **npm** >= 9.x
- **MySQL** >= 8.x
- **Redis** >= 6.x (opcional pero recomendado)

## 🔧 Instalación

### 1. Clonar el repositorio

```bash
git clone <repository-url>
cd backend-chat
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
# === SERVIDOR ===
PORT=8747
NODE_ENV=production

# === BASE DE DATOS MYSQL ===
DB_HOST=tu-servidor-mysql
DB_PORT=3306
DB_USERNAME=tu-usuario
DB_PASSWORD=tu-password-seguro
DB_DATABASE=chat_midas

# === REDIS (Cache) ===
REDIS_HOST=tu-servidor-redis
REDIS_PORT=6379
REDIS_PASSWORD=tu-password-redis

# === AUTENTICACIÓN ===
JWT_SECRET=tu-secret-key-muy-seguro-minimo-32-caracteres
JWT_EXPIRES_IN=24h

# === INTEGRACIÓN CRM ===
CRM_REFRESH_TOKEN_URL=https://tu-crm.com/api/refresh-token

# === CORS - Orígenes permitidos (separados por comas) ===
ALLOWED_ORIGINS=https://chat.mass34.com,https://apisozarusac.com
```

> ⚠️ **IMPORTANTE**: Nunca subas el archivo `.env` a Git. Ya está incluido en `.gitignore`.

### 4. Crear la base de datos

```sql
CREATE DATABASE chat_midas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 5. Ejecutar migraciones (si existen)

```bash
npm run migration:run
```

## 🚀 Ejecución

### Desarrollo

```bash
npm run start:dev
```

El servidor estará disponible en `http://localhost:8747`

### Producción

```bash
npm run build
npm run start:prod
```

### Debug

```bash
npm run start:debug
```

## 📡 Endpoints REST

### Autenticación

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/auth/validate-token` | Validar token del CRM y generar JWT |
| POST | `/api/auth/refresh` | Refrescar token JWT |

### Mensajes

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/messages/room/:roomCode` | Obtener mensajes de una sala |
| GET | `/api/messages/conversation/:user1/:user2` | Mensajes entre usuarios |
| POST | `/api/messages` | Crear nuevo mensaje |
| PATCH | `/api/messages/:id/read` | Marcar mensaje como leído |
| DELETE | `/api/messages/:id` | Eliminar mensaje |
| PUT | `/api/messages/:id` | Editar mensaje |
| POST | `/api/messages/:id/reaction` | Agregar/quitar reacción |

### Salas Temporales

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/temporary-rooms` | Listar todas las salas |
| POST | `/api/temporary-rooms` | Crear sala temporal |
| POST | `/api/temporary-rooms/join` | Unirse a una sala |
| DELETE | `/api/temporary-rooms/:roomCode` | Eliminar sala |

### Conversaciones Asignadas

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/temporary-conversations` | Listar conversaciones |
| POST | `/api/temporary-conversations` | Crear conversación asignada |
| DELETE | `/api/temporary-conversations/:id` | Eliminar conversación |

### Configuración del Sistema

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/system-config` | Obtener configuración |
| PUT | `/api/system-config/:id` | Actualizar configuración |

## 🔌 Eventos WebSocket

### Conexión

```javascript
const socket = io('http://localhost:8747', {
  transports: ['websocket', 'polling']
});
```

### Eventos del Cliente → Servidor

| Evento | Payload | Descripción |
|--------|---------|-------------|
| `register` | `{ username, userData, assignedConversations }` | Registrar usuario en WebSocket |
| `message` | `{ from, to, message, isGroup, roomCode, ... }` | Enviar mensaje |
| `typing` | `{ from, to, isTyping, roomCode }` | Indicador de escritura |
| `joinRoom` | `{ roomCode, username }` | Unirse a sala |
| `leaveRoom` | `{ roomCode, username }` | Salir de sala |
| `requestUserListPage` | `{ page, pageSize }` | Solicitar lista paginada de usuarios |

### Eventos del Servidor → Cliente

| Evento | Payload | Descripción |
|--------|---------|-------------|
| `message` | `{ from, to, message, time, ... }` | Nuevo mensaje recibido |
| `roomMessage` | `{ from, roomCode, message, ... }` | Mensaje de sala |
| `userList` | `{ users }` | Lista de usuarios conectados |
| `userTyping` | `{ from, isTyping }` | Usuario escribiendo |
| `roomTyping` | `{ from, roomCode, isTyping }` | Usuario escribiendo en sala |
| `newConversationAssigned` | `{ conversationName, otherUser }` | Nueva conversación asignada |
| `conversationRemoved` | `{ conversationId, conversationName }` | Conversación eliminada |
| `messageDeleted` | `{ messageId, deletedBy }` | Mensaje eliminado |
| `messageEdited` | `{ messageId, newText }` | Mensaje editado |
| `reactionUpdate` | `{ messageId, reactions }` | Reacciones actualizadas |

## 🗂️ Estructura del Proyecto

```
backend-chat/
├── src/
│   ├── auth/                    # Autenticación JWT
│   ├── common/                  # Interceptors, guards, decorators
│   ├── config/                  # Configuración (BD, Redis)
│   ├── conversation-favorites/  # Favoritos de conversaciones
│   ├── messages/                # Servicio de mensajes
│   │   ├── dto/
│   │   ├── entities/
│   │   ├── messages.controller.ts
│   │   └── messages.service.ts
│   ├── polls/                   # Sistema de encuestas
│   ├── roles/                   # Gestión de roles
│   ├── room-favorites/          # Favoritos de salas
│   ├── socket/                  # WebSocket Gateway
│   │   └── socket.gateway.ts   # Gateway principal (WebSockets)
│   ├── system-config/           # Configuración del sistema
│   ├── temporary-conversations/ # Conversaciones asignadas
│   ├── temporary-rooms/         # Salas temporales
│   ├── users/                   # Gestión de usuarios
│   ├── utils/                   # Utilidades (fechas, etc.)
│   ├── app.module.ts            # Módulo principal
│   └── main.ts                  # Punto de entrada
├── migrations/                  # Migraciones de BD
├── .env                         # Variables de entorno (NO subir a Git)
├── .env.example                 # Plantilla de variables
├── package.json
└── tsconfig.json
```

## 🔒 Seguridad

### Implementado
- ✅ Validación de entrada con `class-validator`
- ✅ Interceptor de errores de base de datos
- ✅ CORS configurado
- ✅ JWT para autenticación
- ✅ Soft delete de mensajes

### Recomendado Implementar
- ⚠️ Rate limiting (prevenir spam)
- ⚠️ Helmet para headers de seguridad
- ⚠️ Autenticación en WebSockets
- ⚠️ Encriptación de archivos multimedia
- ⚠️ Validación de tamaño de archivos

## 🧪 Testing

```bash
# Tests unitarios
npm run test

# Tests e2e
npm run test:e2e

# Cobertura
npm run test:cov
```

## 📊 Monitoreo y Logs

Los logs se generan usando `console.log`. Para producción, se recomienda:
- Usar el `Logger` de NestJS
- Integrar con servicios como Sentry, Datadog, o ELK Stack

## 🔄 Migraciones

### Crear nueva migración

```bash
npm run migration:generate -- -n NombreMigracion
```

### Ejecutar migraciones

```bash
npm run migration:run
```

### Revertir última migración

```bash
npm run migration:revert
```

## 🐳 Docker (Opcional)

```bash
# Levantar servicios
docker-compose up -d

# Ver logs
docker-compose logs -f

# Detener servicios
docker-compose down
```

## 📝 Variables de Entorno Completas

| Variable | Tipo | Requerido | Descripción |
|----------|------|-----------|-------------|
| `PORT` | number | No | Puerto del servidor (default: 8747) |
| `NODE_ENV` | string | No | Ambiente (development/production) |
| `DB_HOST` | string | **Sí** | Host de MySQL |
| `DB_PORT` | number | No | Puerto de MySQL (default: 3306) |
| `DB_USERNAME` | string | **Sí** | Usuario de MySQL |
| `DB_PASSWORD` | string | **Sí** | Contraseña de MySQL |
| `DB_DATABASE` | string | **Sí** | Nombre de la base de datos |
| `REDIS_HOST` | string | **Sí** | Host de Redis |
| `REDIS_PORT` | number | No | Puerto de Redis (default: 6379) |
| `REDIS_PASSWORD` | string | **Sí** | Contraseña de Redis |
| `JWT_SECRET` | string | **Sí** | Secret para firmar JWT (mín. 32 chars) |
| `JWT_EXPIRES_IN` | string | No | Expiración del JWT (default: 24h) |
| `CRM_REFRESH_TOKEN_URL` | string | **Sí** | URL del CRM para validar tokens |
| `ALLOWED_ORIGINS` | string | No | Orígenes CORS permitidos (separados por comas) |

## 🤝 Contribuciones

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto es privado y confidencial.

## 👥 Contacto

Para soporte o preguntas, contacta al equipo de desarrollo.

---

**Última actualización**: 2025-11-26
**Versión**: 1.0.0
