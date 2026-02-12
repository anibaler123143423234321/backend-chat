# Fix: Contador de mensajes no leídos reaparece después de F5 para SUPERADMIN

## Problema Identificado

Cuando un usuario con rol SUPERADMIN marcaba mensajes como leídos en un grupo, el contador desaparecía correctamente. Sin embargo, al recargar la página (F5), el contador volvía a aparecer con valores antiguos.

### Causa Raíz

El endpoint `getAdminRooms()` (usado por SUPERADMIN, ADMIN, JEFEPISO, PROGRAMADOR) NO estaba calculando ni devolviendo el campo `unreadCount` para las salas. Esto causaba que después de un F5, el frontend recibiera salas sin información actualizada del contador de mensajes no leídos.

## Solución Implementada

### 1. Módulo `TemporaryRoomsModule` (`src/temporary-rooms/temporary-rooms.module.ts`)

**Cambios:**
- Importado `forwardRef` de `@nestjs/common`
- Agregado `MessagesModule` a los imports usando `forwardRef(() => MessagesModule)` para evitar dependencias circulares

```typescript
imports: [
  TypeOrmModule.forFeature([TemporaryRoom, User, Message]),
  RoomFavoritesModule,
  forwardRef(() => MessagesModule), // ← NUEVO
],
```

### 2. Servicio `TemporaryRoomsService` (`src/temporary-rooms/temporary-rooms.service.ts`)

**Cambios:**
- Importado `MessagesService` desde `../messages/messages.service`
- Inyectado `MessagesService` en el constructor usando `forwardRef`
- Agregado cálculo de `unreadCount` en el método `getAdminRooms()`

```typescript
// En el constructor
@Inject(forwardRef(() => MessagesService))
private messagesService: MessagesService,

// En getAdminRooms(), después de la paginación
if (username && paginatedRooms.length > 0) {
  const roomCodes = paginatedRooms.map(room => room.roomCode);
  const unreadCounts = await this.messagesService.getUnreadCountsForUserInRooms(
    roomCodes,
    username,
  );

  // Agregar unreadCount a cada sala
  paginatedRooms.forEach(room => {
    room['unreadCount'] = unreadCounts[room.roomCode] || 0;
  });
}
```

### 3. Módulo `RoomFavoritesModule` (`src/room-favorites/room-favorites.module.ts`)

**Cambios:**
- Importado `forwardRef` de `@nestjs/common`
- Agregado `MessagesModule` a los imports usando `forwardRef(() => MessagesModule)`

### 4. Servicio `RoomFavoritesService` (`src/room-favorites/room-favorites.service.ts`)

**Cambios:**
- Importado `MessagesService` desde `../messages/messages.service`
- Inyectado `MessagesService` en el constructor usando `forwardRef`
- Corregido el cálculo de `unreadCount` en `getUserFavoritesWithRoomData()` (estaba hardcodeado a 0)

```typescript
// Antes
const unreadCount = 0; // Se podría implementar conteo real aquí

// Después
const unreadCount = code ? await this.messagesService.getUnreadCountForUserInRoom(code, username) : 0;
```

## Verificación

### Métodos Utilizados

1. **`getUnreadCountForUserInRoom(roomCode, username)`**: Calcula el contador de mensajes no leídos para un usuario en una sala específica
2. **`getUnreadCountsForUserInRooms(roomCodes[], username)`**: Calcula contadores para múltiples salas de forma eficiente

### Lógica de Conteo

El conteo de mensajes no leídos considera:
- ✅ Solo mensajes NO eliminados (`isDeleted = false`)
- ✅ Solo mensajes principales, no de hilos (`threadId IS NULL`)
- ✅ Excluye mensajes propios del usuario (comparación case-insensitive)
- ✅ Verifica si el usuario está en el array `readBy` (comparación case-insensitive)

## Endpoints Afectados

### Corregidos
1. **GET `/temporary-rooms/admin`** (`getAdminRooms`)
   - Usado por: SUPERADMIN, ADMIN, JEFEPISO, PROGRAMADOR
   - Ahora devuelve `unreadCount` calculado correctamente

2. **GET `/room-favorites`** (`getUserFavoritesWithRoomData`)
   - Usado por: Todos los usuarios
   - Ahora calcula `unreadCount` real en lugar de devolver 0

### Sin Cambios (ya funcionaban correctamente)
- **Socket Event `markRoomMessagesAsRead`**: Marca mensajes como leídos correctamente para todos los roles
- **Socket Event `unreadCountReset`**: Emite correctamente el reset del contador

## Resultado Esperado

Después de estos cambios:

1. ✅ Cuando SUPERADMIN marca mensajes como leídos, el contador desaparece
2. ✅ Al recargar la página (F5), el contador permanece en 0 (no reaparece)
3. ✅ El `unreadCount` devuelto por `getAdminRooms()` refleja el estado real de la base de datos
4. ✅ Los favoritos también muestran contadores correctos

## Notas Técnicas

- Se usó `forwardRef()` para evitar dependencias circulares entre módulos
- El cálculo se hace solo para las salas paginadas (optimización de rendimiento)
- Se reutilizaron métodos existentes en `MessagesService` para mantener consistencia
- No se modificó la lógica de marcado de lectura (ya funcionaba correctamente)
