# 🖼️ Redis Cache para Mensajes con URLs Multimedia

## 📌 Explicación: ¿Cómo funciona con URLs?

Cuando tus mensajes tienen archivos multimedia (imágenes, videos, audios, documentos), Redis guarda **el objeto completo del mensaje**, incluyendo las URLs.

### Ejemplo de Mensaje con URL en Redis:

```json
{
  "id": 12345,
  "from": "Juan Pérez",
  "to": "María López",
  "message": "Te envío la cotización",
  "mediaType": "image",
  "mediaData": "https://storage.googleapis.com/chat-midas/images/cotizacion-2025.jpg",
  "fileName": "cotizacion-2025.jpg",
  "fileSize": 2456789,
  "sentAt": "2025-11-26T14:25:00",
  "time": "14:25",
  "isRead": false
}
```

**Redis guarda TODO**, incluyendo:
- ✅ La URL completa del archivo (`mediaData`)
- ✅ El nombre del archivo (`fileName`)
- ✅ El tipo de media (`mediaType`)
- ✅ El tamaño (`fileSize`)

## 🚀 Implementación Paso a Paso

### Paso 1: Inyectar Cache Manager en MessagesService

Agrega esto al inicio de `messages.service.ts`:

```typescript
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(TemporaryRoom)
    private temporaryRoomRepository: Repository<TemporaryRoom>,
    @InjectRepository(TemporaryConversation)
    private temporaryConversationRepository: Repository<TemporaryConversation>,
    @Inject(forwardRef(() => SocketGateway))
    private socketGateway: SocketGateway,
    @Inject(CACHE_MANAGER) private cacheManager: Cache, //  NUEVO
  ) {}
```

### Paso 2: Cachear Mensajes de Sala

Modifica el método `findByRoomOrderedById`:

```typescript
async findByRoomOrderedById(
  roomCode: string,
  limit: number = 20,
  offset: number = 0,
): Promise<any[]> {
  //  Clave de cache única por sala, límite y offset
  const cacheKey = `messages:room:${roomCode}:${limit}:${offset}`;
  
  try {
    // 1️⃣ INTENTAR OBTENER DE CACHE
    const cachedMessages = await this.cacheManager.get<any[]>(cacheKey);
    
    if (cachedMessages) {
      console.log(`✅ Cache HIT - Room: ${roomCode} (${cachedMessages.length} mensajes)`);
      return cachedMessages;
    }
    
    console.log(`❌ Cache MISS - Consultando BD para room: ${roomCode}`);
  } catch (error) {
    console.error('⚠️ Error al consultar cache, continuando sin cache:', error);
  }
  
  // 2️⃣ SI NO ESTÁ EN CACHE, CONSULTAR BD
  const messages = await this.messageRepository.find({
    where: { roomCode, threadId: IsNull(), isDeleted: false },
    order: { id: 'DESC' },
    take: limit,
    skip: offset,
  });

  // Obtener threadCounts (código existente)...
  const messageIds = messages.map((m) => m.id);
  const threadCountMap = {};
  const lastReplyMap = {};

  if (messageIds.length > 0) {
    const threadCounts = await this.messageRepository
      .createQueryBuilder('message')
      .select('message.threadId', 'threadId')
      .addSelect('COUNT(*)', 'count')
      .where('message.threadId IN (:...messageIds)', { messageIds })
      .andWhere('message.isDeleted = false')
      .groupBy('message.threadId')
      .getRawMany();

    threadCounts.forEach((tc) => {
      threadCountMap[tc.threadId] = parseInt(tc.count);
    });

    const lastReplies = await this.messageRepository
      .createQueryBuilder('message')
      .where('message.threadId IN (:...messageIds)', { messageIds })
      .andWhere('message.isDeleted = false')
      .orderBy('message.sentAt', 'DESC')
      .getMany();

    const seenThreadIds = new Set();
    lastReplies.forEach((reply) => {
      if (!seenThreadIds.has(reply.threadId)) {
        lastReplyMap[reply.threadId] = reply.from;
        seenThreadIds.add(reply.threadId);
      }
    });
  }

  const reversedMessages = messages.reverse();

  const formattedMessages = reversedMessages.map((msg, index) => ({
    ...msg,
    numberInList: index + 1 + offset,
    threadCount: threadCountMap[msg.id] || 0,
    lastReplyFrom: lastReplyMap[msg.id] || null,
    displayDate: formatDisplayDate(msg.sentAt),
  }));

  // 3️⃣ GUARDAR EN CACHE (2 minutos de TTL)
  try {
    await this.cacheManager.set(cacheKey, formattedMessages, 120);
    console.log(`💾 Guardado en cache - Room: ${roomCode} (${formattedMessages.length} mensajes)`);
  } catch (error) {
    console.error('⚠️ Error al guardar en cache:', error);
  }

  return formattedMessages;
}
```

### Paso 3: Cachear Mensajes entre Usuarios

Modifica el método `findByUserOrderedById`:

```typescript
async findByUserOrderedById(
  from: string,
  to: string,
  limit: number = 20,
  offset: number = 0,
): Promise<any[]> {
  //  Clave de cache única por conversación
  // Normalizar para que "Juan-María" sea igual a "María-Juan"
  const users = [from, to].sort();
  const cacheKey = `messages:conversation:${users[0]}:${users[1]}:${limit}:${offset}`;
  
  try {
    // 1️⃣ INTENTAR OBTENER DE CACHE
    const cachedMessages = await this.cacheManager.get<any[]>(cacheKey);
    
    if (cachedMessages) {
      console.log(`✅ Cache HIT - Conversación: ${from} ↔ ${to}`);
      return cachedMessages;
    }
    
    console.log(`❌ Cache MISS - Consultando BD para conversación: ${from} ↔ ${to}`);
  } catch (error) {
    console.error('⚠️ Error al consultar cache:', error);
  }
  
  // 2️⃣ CONSULTAR BD (código existente)...
  const messages = await this.messageRepository
    .createQueryBuilder('message')
    .where(
      'LOWER(message.from) = LOWER(:from) AND LOWER(message.to) = LOWER(:to) AND message.threadId IS NULL AND message.isGroup = false AND message.isDeleted = false',
      { from, to },
    )
    .orWhere(
      'LOWER(message.from) = LOWER(:to) AND LOWER(message.to) = LOWER(:from) AND message.threadId IS NULL AND message.isGroup = false AND message.isDeleted = false',
      { from, to },
    )
    .orderBy('message.id', 'DESC')
    .take(limit)
    .skip(offset)
    .getMany();

  // Procesar threadCounts (código existente)...
  const messageIds = messages.map((m) => m.id);
  const threadCountMap = {};
  const lastReplyMap = {};

  if (messageIds.length > 0) {
    const threadCounts = await this.messageRepository
      .createQueryBuilder('message')
      .select('message.threadId', 'threadId')
      .addSelect('COUNT(*)', 'count')
      .where('message.threadId IN (:...messageIds)', { messageIds })
      .andWhere('message.isDeleted = false')
      .groupBy('message.threadId')
      .getRawMany();

    threadCounts.forEach((tc) => {
      threadCountMap[tc.threadId] = parseInt(tc.count);
    });

    const lastReplies = await this.messageRepository
      .createQueryBuilder('message')
      .where('message.threadId IN (:...messageIds)', { messageIds })
      .andWhere('message.isDeleted = false')
      .orderBy('message.sentAt', 'DESC')
      .getMany();

    const seenThreadIds = new Set();
    lastReplies.forEach((reply) => {
      if (!seenThreadIds.has(reply.threadId)) {
        lastReplyMap[reply.threadId] = reply.from;
        seenThreadIds.add(reply.threadId);
      }
    });
  }

  const reversedMessages = messages.reverse();

  const messagesWithNumber = reversedMessages.map((msg, index) => ({
    ...msg,
    numberInList: index + 1 + offset,
    threadCount: threadCountMap[msg.id] || 0,
    lastReplyFrom: lastReplyMap[msg.id] || null,
    displayDate: formatDisplayDate(msg.sentAt),
  }));

  // 3️⃣ GUARDAR EN CACHE (2 minutos de TTL)
  try {
    await this.cacheManager.set(cacheKey, messagesWithNumber, 120);
    console.log(`💾 Guardado en cache - Conversación: ${from} ↔ ${to}`);
  } catch (error) {
    console.error('⚠️ Error al guardar en cache:', error);
  }

  return messagesWithNumber;
}
```

### Paso 4: INVALIDAR Cache al Crear Mensaje

**MUY IMPORTANTE**: Cuando se crea un mensaje nuevo, debes limpiar el cache:

```typescript
async create(createMessageDto: CreateMessageDto): Promise<Message> {
  // ... tu código existente para crear mensaje ...
  
  const savedMessage = await this.messageRepository.save(message);

  //  INVALIDAR CACHE relacionado
  try {
    if (savedMessage.roomCode) {
      // Mensaje de sala - invalidar cache de la sala
      const pattern = `messages:room:${savedMessage.roomCode}:*`;
      console.log(`🗑️ Invalidando cache de sala: ${pattern}`);
      
      // Nota: cache-manager no soporta wildcards, así que invalidamos las páginas más comunes
      for (let offset = 0; offset < 100; offset += 20) {
        await this.cacheManager.del(`messages:room:${savedMessage.roomCode}:20:${offset}`);
      }
    } else if (savedMessage.from && savedMessage.to) {
      // Mensaje privado - invalidar cache de la conversación
      const users = [savedMessage.from, savedMessage.to].sort();
      console.log(`🗑️ Invalidando cache de conversación: ${users[0]} ↔ ${users[1]}`);
      
      for (let offset = 0; offset < 100; offset += 20) {
        await this.cacheManager.del(`messages:conversation:${users[0]}:${users[1]}:20:${offset}`);
      }
    }
  } catch (error) {
    console.error('⚠️ Error al invalidar cache:', error);
  }

  return savedMessage;
}
```

### Paso 5: Invalidar Cache al Eliminar/Editar Mensaje

```typescript
async deleteMessage(
  messageId: number,
  username: string,
  isAdmin: boolean = false,
  deletedBy?: string,
): Promise<boolean> {
  const message = await this.messageRepository.findOne({ 
    where: isAdmin ? { id: messageId } : { id: messageId, from: username }
  });

  if (message) {
    message.isDeleted = true;
    message.deletedAt = new Date();
    if (isAdmin && deletedBy) {
      message.deletedBy = deletedBy;
    }
    await this.messageRepository.save(message);

    //  INVALIDAR CACHE
    try {
      if (message.roomCode) {
        for (let offset = 0; offset < 100; offset += 20) {
          await this.cacheManager.del(`messages:room:${message.roomCode}:20:${offset}`);
        }
      } else if (message.from && message.to) {
        const users = [message.from, message.to].sort();
        for (let offset = 0; offset < 100; offset += 20) {
          await this.cacheManager.del(`messages:conversation:${users[0]}:${users[1]}:20:${offset}`);
        }
      }
    } catch (error) {
      console.error('⚠️ Error al invalidar cache:', error);
    }

    return true;
  }
  return false;
}
```

## 📊 Mejora de Rendimiento Esperada

### Antes (Sin Cache)
```
Usuario abre chat → Backend consulta BD → 150ms
Usuario scroll → Backend consulta BD → 150ms
Usuario cambia de chat → Backend consulta BD → 150ms

Total: ~450ms de espera
```

### Después (Con Cache)
```
Usuario abre chat → Backend consulta cache → 5ms (1ra vez: 150ms)
Usuario scroll → Backend consulta cache → 5ms
Usuario cambia de chat → Backend consulta cache → 5ms

Total: ~15ms de espera (30x más rápido!)
```

## ✅ Beneficios Específicos para URLs

1. **URLs se cachean completas** - No hay que reconstruirlas
2. **Menos carga en Google Cloud Storage** - No se re-firman URLs innecesariamente
3. **Frontend recibe datos instantáneamente** - Mejor UX
4. **Base de datos descansa** - Puede manejar más usuarios

## 🎯 Configuración Recomendada de TTL

```typescript
// Mensajes recientes de salas activas
TTL: 120 segundos (2 minutos)

// Mensajes antiguos (historial)
TTL: 600 segundos (10 minutos)

// Conversaciones privadas
TTL: 180 segundos (3 minutos)
```

##  Comando para Monitorear

```bash
# Ver qué está en cache
redis-cli -h 198.46.186.2 -p 6379 -a Midas*2025 KEYS "messages:*"

# Ver un mensaje específico en cache
redis-cli -h 198.46.186.2 -p 6379 -a Midas*2025 GET "messages:room:ABC123:20:0"

# Ver cuánta memoria usa
redis-cli -h 198.46.186.2 -p 6379 -a Midas*2025 INFO memory
```

---

**IMPORTANTE**: Las URLs de multimedia se cachean perfectamente. Redis solo guarda el **texto de la URL**, no descarga los archivos. El frontend sigue haciendo las peticiones HTTP normales para obtener las imágenes/videos.

