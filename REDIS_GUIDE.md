# 🚀 Guía de Uso de Redis Cache

Esta guía explica cómo usar Redis para cachear datos en los servicios del backend-chat.

## 📦 Configuración Completada

✅ Dependencias instaladas: `@nestjs/cache-manager`, `cache-manager-redis-store`, `redis`
✅ Archivo de configuración: `src/config/redis.config.ts`
✅ CacheModule integrado en `app.module.ts`
✅ Variables de entorno en `.env`

## 🔧 Cómo Usar Cache en tus Servicios

### 1. Inyectar el Cache Manager

En cualquier servicio donde quieras usar cache:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class TuServicio {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}
  
  // ... tus métodos
}
```

### 2. Guardar en Cache

```typescript
async guardarEnCache(key: string, value: any, ttl?: number) {
  // ttl en segundos (opcional, default 300s = 5min)
  await this.cacheManager.set(key, value, ttl || 300);
}
```

### 3. Obtener de Cache

```typescript
async obtenerDeCache<T>(key: string): Promise<T | null> {
  return await this.cacheManager.get<T>(key);
}
```

### 4. Eliminar de Cache

```typescript
async eliminarDeCache(key: string) {
  await this.cacheManager.del(key);
}
```

### 5. Limpiar Todo el Cache

```typescript
async limpiarCache() {
  await this.cacheManager.reset();
}
```

## 📝 Ejemplos Prácticos

### Ejemplo 1: Cachear Lista de Usuarios Online

```typescript
// En socket.gateway.ts
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

export class SocketGateway {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    // ... otros servicios
  ) {}

  async broadcastUserList(assignedConversations?: any[]) {
    const cacheKey = 'users:online';
    
    // Intentar obtener de cache
    let userList = await this.cacheManager.get(cacheKey);
    
    if (!userList) {
      // Si no está en cache, calcular y guardar
      userList = Array.from(this.users.entries()).map(
        ([username, { userData }]) => ({
          username,
          nombre: userData?.nombre,
          apellido: userData?.apellido,
          // ...
        })
      );
      
      // Guardar en cache por 30 segundos
      await this.cacheManager.set(cacheKey, userList, 30);
    }
    
    // Emitir a todos los clientes
    this.server.emit('userList', { users: userList });
  }
}
```

### Ejemplo 2: Cachear Mensajes de una Sala

```typescript
// En messages.service.ts
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async findByRoom(
    roomCode: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<Message[]> {
    const cacheKey = `messages:room:${roomCode}:${limit}:${offset}`;
    
    // Intentar obtener de cache
    let messages = await this.cacheManager.get<Message[]>(cacheKey);
    
    if (!messages) {
      // Si no está en cache, consultar BD
      messages = await this.messageRepository.find({
        where: { roomCode, threadId: IsNull() },
        order: { id: 'ASC' },
        take: limit,
        skip: offset,
      });
      
      // Guardar en cache por 2 minutos
      await this.cacheManager.set(cacheKey, messages, 120);
    }
    
    return messages;
  }

  async create(createMessageDto: CreateMessageDto): Promise<Message> {
    const message = await this.messageRepository.save(createMessageDto);
    
    //  IMPORTANTE: Invalidar cache al crear nuevo mensaje
    const roomCode = createMessageDto.roomCode;
    if (roomCode) {
      // Eliminar todos los caches de esta sala
      await this.cacheManager.del(`messages:room:${roomCode}:*`);
    }
    
    return message;
  }
}
```

### Ejemplo 3: Cachear Contadores de No Leídos

```typescript
async getUnreadCountForUserInRoom(
  roomCode: string,
  username: string,
): Promise<number> {
  const cacheKey = `unread:${roomCode}:${username}`;
  
  // Intentar obtener de cache
  let count = await this.cacheManager.get<number>(cacheKey);
  
  if (count === null || count === undefined) {
    // Calcular de la BD
    const messages = await this.messageRepository.find({
      where: { roomCode, isDeleted: false },
    });
    
    count = messages.filter(msg => {
      if (msg.from === username) return false;
      if (!msg.readBy || !msg.readBy.includes(username)) return true;
      return false;
    }).length;
    
    // Guardar en cache por 1 minuto
    await this.cacheManager.set(cacheKey, count, 60);
  }
  
  return count;
}

// Al marcar como leído, invalidar cache
async markAsRead(messageId: number, username: string) {
  const message = await this.messageRepository.findOne({ where: { id: messageId } });
  
  if (message) {
    // ... lógica de marcar como leído
    
    // Invalidar cache de contadores
    if (message.roomCode) {
      await this.cacheManager.del(`unread:${message.roomCode}:${username}`);
    }
  }
}
```

## 🎯 Mejores Prácticas

### 1. Nomenclatura de Keys

Usa un patrón consistente para las keys:
```typescript
// ✅ Bueno
`users:online`
`messages:room:${roomCode}:${page}`
`unread:${roomCode}:${username}`
`conversation:${conversationId}`

// ❌ Malo
`users_online`
`msg_${roomCode}`
`data123`
```

### 2. TTL Apropiado

- **Datos que cambian frecuentemente**: 10-60 segundos
- **Datos semi-estáticos**: 5-15 minutos
- **Datos estáticos**: 1-24 horas

```typescript
// Usuarios online (cambia frecuentemente)
await this.cacheManager.set('users:online', users, 30); // 30 segundos

// Mensajes de sala (cambian a veces)
await this.cacheManager.set(cacheKey, messages, 300); // 5 minutos

// Configuración del sistema (casi nunca cambia)
await this.cacheManager.set('system:config', config, 3600); // 1 hora
```

### 3. Invalidación de Cache

**Siempre** invalida el cache cuando los datos cambian:

```typescript
// Al crear mensaje
async create(dto: CreateMessageDto) {
  const message = await this.save(dto);
  
  // Invalidar cache relacionado
  await this.cacheManager.del(`messages:room:${dto.roomCode}:*`);
  await this.cacheManager.del(`unread:${dto.roomCode}:*`);
  
  return message;
}

// Al eliminar mensaje
async deleteMessage(id: number) {
  const message = await this.findOne(id);
  await this.repository.delete(id);
  
  // Invalidar cache
  if (message.roomCode) {
    await this.cacheManager.del(`messages:room:${message.roomCode}:*`);
  }
}
```

### 4. Manejo de Errores

```typescript
async getFromCacheOrDB(key: string, fetchFunction: () => Promise<any>) {
  try {
    // Intentar cache primero
    const cached = await this.cacheManager.get(key);
    if (cached) return cached;
    
    // Si no está en cache, obtener de BD
    const data = await fetchFunction();
    
    // Guardar en cache
    await this.cacheManager.set(key, data, 300);
    
    return data;
  } catch (error) {
    console.error('❌ Error de cache:', error);
    // Si Redis falla, seguir funcionando sin cache
    return await fetchFunction();
  }
}
```

## 📊 Monitorear el Cache

### Ver estadísticas en desarrollo

```typescript
// En cualquier endpoint (solo desarrollo)
@Get('cache-stats')
async getCacheStats() {
  if (process.env.NODE_ENV !== 'development') {
    throw new ForbiddenException();
  }
  
  // Implementar estadísticas custom o usar Redis CLI
  return {
    message: 'Use Redis CLI: redis-cli INFO stats'
  };
}
```

### Redis CLI Commands

```bash
# Conectar a Redis
redis-cli -h 198.46.186.2 -p 6379 -a Midas*2025

# Ver todas las keys
KEYS *

# Ver valor de una key
GET messages:room:ABC123:20:0

# Ver info del servidor
INFO

# Ver estadísticas de cache
INFO stats

# Limpiar todo el cache (¡CUIDADO!)
FLUSHALL
```

## 🚀 Beneficios de Usar Cache

### ✅ Antes de Redis

- Cada request consulta la BD
- Consultas lentas (50-200ms)
- Alta carga en MySQL
- Escalabilidad limitada

### ✅ Después de Redis

- Datos servidos desde memoria (1-5ms)
- BD solo se consulta cuando es necesario
- MySQL puede manejar más usuarios
- Mejor experiencia de usuario

##  Implementaciones Recomendadas

### Prioridad Alta
1. ✅ Cachear usuarios online
2. ✅ Cachear mensajes recientes de salas activas
3. ✅ Cachear contadores de no leídos

### Prioridad Media
4. ⏳ Cachear lista de salas activas
5. ⏳ Cachear configuración del sistema
6. ⏳ Cachear favoritos de usuarios

### Prioridad Baja
7. ⏳ Cachear historial de reacciones
8. ⏳ Cachear estadísticas de uso

---

**Recuerda**: El cache es una herramienta poderosa, pero úsala sabiamente. No caches todo, solo lo que realmente mejora el rendimiento.

