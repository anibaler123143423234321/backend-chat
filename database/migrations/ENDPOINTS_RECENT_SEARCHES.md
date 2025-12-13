# 📋 Endpoints de Búsquedas Recientes

## Base URL
```
http://localhost:8747/api/recent-searches
```

**Nota:** El servidor debe estar corriendo en el puerto 8747.

---

## 🔐 Autenticación
Todos los endpoints requieren autenticación JWT mediante el header:
```
Authorization: Bearer <token>
```

---

## 📌 Endpoints Disponibles

### 1. **Guardar Búsqueda Reciente**
```http
POST /api/recent-searches
```

**Body (JSON):**
```json
{
  "username": "admin",
  "searchTerm": "Juan Pérez",
  "searchType": "user",
  "resultCount": 5,
  "clickedResultId": "123"
}
```

**Campos:**
- `username` (string, requerido): Usuario que realiza la búsqueda
- `searchTerm` (string, requerido): Término buscado (máx. 500 caracteres)
- `searchType` (enum, opcional): Tipo de búsqueda: `"user"`, `"room"`, `"message"`, `"general"` (default: `"general"`)
- `resultCount` (number, opcional): Cantidad de resultados encontrados
- `clickedResultId` (string, opcional): ID del resultado clickeado

**Respuesta (201 Created):**
```json
{
  "id": 1,
  "username": "admin",
  "searchTerm": "Juan Pérez",
  "searchType": "user",
  "resultCount": 5,
  "clickedResultId": "123",
  "createdAt": "2025-12-12T10:30:00.000Z",
  "updatedAt": "2025-12-12T10:30:00.000Z"
}
```

---

### 2. **Obtener Búsquedas Recientes de un Usuario**
```http
GET /api/recent-searches/:username?limit=20
```

**Parámetros:**
- `username` (path): Nombre del usuario
- `limit` (query, opcional): Cantidad máxima de resultados (default: 20)

**Ejemplo:**
```http
GET /api/recent-searches/admin?limit=10
```

**Respuesta (200 OK):**
```json
[
  {
    "id": 3,
    "username": "admin",
    "searchTerm": "proyecto",
    "searchType": "message",
    "resultCount": 15,
    "clickedResultId": null,
    "createdAt": "2025-12-12T10:35:00.000Z",
    "updatedAt": "2025-12-12T10:35:00.000Z"
  },
  {
    "id": 2,
    "username": "admin",
    "searchTerm": "Sala General",
    "searchType": "room",
    "resultCount": 1,
    "clickedResultId": "room_456",
    "createdAt": "2025-12-12T10:32:00.000Z",
    "updatedAt": "2025-12-12T10:32:00.000Z"
  }
]
```

---

### 3. **Obtener Búsquedas por Tipo**
```http
GET /api/recent-searches/:username/type/:searchType?limit=10
```

**Parámetros:**
- `username` (path): Nombre del usuario
- `searchType` (path): Tipo de búsqueda (`user`, `room`, `message`, `general`)
- `limit` (query, opcional): Cantidad máxima de resultados (default: 10)

**Ejemplo:**
```http
GET /api/recent-searches/admin/type/user?limit=5
```

**Respuesta (200 OK):**
```json
[
  {
    "id": 1,
    "username": "admin",
    "searchTerm": "Juan Pérez",
    "searchType": "user",
    "resultCount": 5,
    "clickedResultId": "123",
    "createdAt": "2025-12-12T10:30:00.000Z",
    "updatedAt": "2025-12-12T10:30:00.000Z"
  }
]
```

---

### 4. **Obtener Estadísticas de Búsquedas**
```http
GET /api/recent-searches/:username/stats
```

**Ejemplo:**
```http
GET /api/recent-searches/admin/stats
```

**Respuesta (200 OK):**
```json
[
  {
    "type": "user",
    "count": "5"
  },
  {
    "type": "room",
    "count": "3"
  },
  {
    "type": "message",
    "count": "12"
  }
]
```

---

### 5. **Eliminar una Búsqueda Específica**
```http
DELETE /api/recent-searches/:id
```

**Body (JSON):**
```json
{
  "username": "admin"
}
```

**Ejemplo:**
```http
DELETE /api/recent-searches/5
```

**Respuesta (204 No Content)**

---

### 6. **Limpiar Todas las Búsquedas de un Usuario**
```http
DELETE /api/recent-searches/clear/:username
```

**Ejemplo:**
```http
DELETE /api/recent-searches/clear/admin
```

**Respuesta (204 No Content)**

---

### 7. **Limpiar Búsquedas Antiguas (Admin)**
```http
POST /api/recent-searches/clean-old
```

**Body (JSON):**
```json
{
  "daysOld": 30
}
```

**Respuesta (200 OK):**
```json
{
  "message": "Búsquedas antiguas eliminadas",
  "deletedCount": 45,
  "daysOld": 30
}
```

---

## 📊 Tipos de Búsqueda (SearchType)

| Valor | Descripción |
|-------|-------------|
| `user` | Búsqueda de usuarios |
| `room` | Búsqueda de salas/rooms |
| `message` | Búsqueda de mensajes |
| `general` | Búsqueda general (default) |

---

## 🔄 Comportamiento Especial

1. **Duplicados**: Si se guarda el mismo `searchTerm` para el mismo `username`, se actualiza el timestamp en lugar de crear un duplicado.

2. **Límite automático**: La base de datos tiene un trigger que mantiene máximo 20 búsquedas por usuario, eliminando las más antiguas automáticamente.

3. **Ordenamiento**: Las búsquedas se devuelven ordenadas por `updatedAt` descendente (más recientes primero).

---

## 🧪 Ejemplos de Uso con cURL

### Guardar búsqueda:
```bash
curl -X POST http://localhost:8747/api/recent-searches \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "searchTerm": "María García",
    "searchType": "user",
    "resultCount": 1
  }'
```

### Obtener búsquedas:
```bash
curl -X GET http://localhost:8747/api/recent-searches/admin?limit=10 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Limpiar búsquedas:
```bash
curl -X DELETE http://localhost:8747/api/recent-searches/clear/admin \
  -H "Authorization: Bearer YOUR_TOKEN"
```

