# 🔍 Instalación de Búsquedas Recientes

## 📋 Pasos de Instalación

### 1. **Ejecutar el Script SQL**

Debes ejecutar el archivo `create_recent_searches_table.sql` en tu base de datos MySQL.

#### Opción A: Desde MySQL Workbench
1. Abre MySQL Workbench
2. Conéctate a tu base de datos (198.46.186.2)
3. Abre el archivo `create_recent_searches_table.sql`
4. Ejecuta el script completo (Ctrl + Shift + Enter)

#### Opción B: Desde línea de comandos
```bash
mysql -h 198.46.186.2 -u tu_usuario -p nombre_base_datos < database/migrations/create_recent_searches_table.sql
```

#### Opción C: Desde phpMyAdmin
1. Accede a phpMyAdmin
2. Selecciona tu base de datos
3. Ve a la pestaña "SQL"
4. Copia y pega el contenido de `create_recent_searches_table.sql`
5. Haz clic en "Continuar"

---

### 2. **Verificar la Instalación**

Ejecuta esta consulta para verificar que la tabla se creó correctamente:

```sql
SHOW TABLES LIKE 'recent_searches';
```

Deberías ver:
```
+----------------------------------+
| Tables_in_db (recent_searches)   |
+----------------------------------+
| recent_searches                  |
+----------------------------------+
```

Para ver la estructura de la tabla:
```sql
DESCRIBE recent_searches;
```

---

### 3. **Reiniciar el Servidor (si es necesario)**

Si el servidor backend ya estaba corriendo, reinícialo para que detecte la nueva tabla:

```bash
# Detener el servidor (Ctrl + C en la terminal donde corre)
# Luego reiniciar:
npm run start:dev
```

---

## ✅ Verificación de Funcionamiento

### Verificar que el módulo se cargó:
En los logs del servidor deberías ver:
```
[Nest] LOG [InstanceLoader] RecentSearchesModule dependencies initialized
[Nest] LOG [RoutesResolver] RecentSearchesController {/api/recent-searches}:
[Nest] LOG [RouterExplorer] Mapped {/api/recent-searches, POST} route
```

### Probar el endpoint:
```bash
# Obtener un token JWT primero (si no lo tienes)
curl -X POST http://localhost:8747/api/auth/validate-token \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "tu_password"}'

# Luego probar el endpoint de búsquedas
curl -X POST http://localhost:8747/api/recent-searches \
  -H "Authorization: Bearer TU_TOKEN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "searchTerm": "test",
    "searchType": "general"
  }'
```

---

## 📁 Archivos Creados

### Backend (NestJS):
- ✅ `src/recent-searches/entities/recent-search.entity.ts` - Entidad TypeORM
- ✅ `src/recent-searches/dto/create-recent-search.dto.ts` - DTO de validación
- ✅ `src/recent-searches/recent-searches.service.ts` - Lógica de negocio
- ✅ `src/recent-searches/recent-searches.controller.ts` - Controlador REST
- ✅ `src/recent-searches/recent-searches.module.ts` - Módulo NestJS
- ✅ `src/app.module.ts` - Módulo registrado

### Base de Datos:
- ✅ `database/migrations/create_recent_searches_table.sql` - Script SQL

### Documentación:
- ✅ `database/migrations/ENDPOINTS_RECENT_SEARCHES.md` - Documentación de endpoints
- ✅ `database/migrations/README_RECENT_SEARCHES.md` - Este archivo

---

## 🎯 Características Implementadas

1. **Guardar búsquedas** con tipo, resultados y resultado clickeado
2. **Obtener búsquedas recientes** por usuario (últimas 20)
3. **Filtrar por tipo** de búsqueda (user, room, message, general)
4. **Estadísticas** de búsquedas por tipo
5. **Eliminar búsquedas** individuales o todas
6. **Limpieza automática** de búsquedas antiguas
7. **Límite automático** de 20 búsquedas por usuario (trigger MySQL)
8. **Prevención de duplicados** (actualiza timestamp en lugar de crear duplicado)

---

## 🔒 Seguridad

- ✅ Todos los endpoints requieren autenticación JWT
- ✅ Validación de datos con class-validator
- ✅ Índices en base de datos para performance
- ✅ Límite de caracteres en términos de búsqueda (500 max)

---

## 📊 Estructura de la Tabla

```sql
CREATE TABLE recent_searches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  search_term VARCHAR(500) NOT NULL,
  search_type ENUM('user', 'room', 'message', 'general') DEFAULT 'general',
  result_count INT DEFAULT NULL,
  clicked_result_id VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_search (username, search_term),
  INDEX idx_username (username),
  INDEX idx_username_created (username, created_at),
  INDEX idx_search_term (search_term)
);
```

---

## 🆘 Solución de Problemas

### Error: "Table 'recent_searches' doesn't exist"
- Verifica que ejecutaste el script SQL correctamente
- Verifica que estás conectado a la base de datos correcta

### Error: "Nest can't resolve dependencies of the JwtAuthGuard"
- Ya está solucionado: el `AuthModule` está importado en `RecentSearchesModule`

### Los endpoints no aparecen
- Verifica que el módulo esté importado en `app.module.ts`
- Reinicia el servidor con `npm run start:dev`

### Error 401 Unauthorized
- Verifica que estás enviando el token JWT en el header `Authorization: Bearer <token>`
- Verifica que el token no haya expirado

---

## 📞 Soporte

Para más información, consulta:
- **Endpoints:** `ENDPOINTS_RECENT_SEARCHES.md`
- **Código fuente:** `src/recent-searches/`
- **Script SQL:** `create_recent_searches_table.sql`

