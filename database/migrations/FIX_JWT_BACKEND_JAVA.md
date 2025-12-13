# 🔧 FIX: Soporte para Tokens JWT del Backend Java

## ❌ Problema Anterior

Los endpoints de **Búsquedas Recientes** estaban protegidos con `JwtAuthGuard`, pero este guard intentaba verificar el token JWT **localmente** usando `jwtService.verifyAsync()`. 

Esto causaba el error:
```json
{
  "message": "Token inválido",
  "error": "Unauthorized",
  "statusCode": 401
}
```

**Razón:** Los tokens JWT generados por el **Backend Java** (CRM) no pueden ser verificados localmente porque:
- Usan un secret diferente
- Tienen una estructura diferente
- Deben validarse contra el CRM

---

## ✅ Solución Implementada

Se modificó el `JwtAuthGuard` para que **valide los tokens contra el Backend Java** en lugar de verificarlos localmente.

### Archivo Modificado: `src/auth/jwt-auth.guard.ts`

**Antes:**
```typescript
async canActivate(context: ExecutionContext): Promise<boolean> {
  const request = context.switchToHttp().getRequest();
  const token = this.extractTokenFromHeader(request);

  if (!token) {
    throw new UnauthorizedException('Token no proporcionado');
  }

  try {
    // ❌ Verificación LOCAL - NO funciona con tokens del Backend Java
    const payload = await this.jwtService.verifyAsync(token);
    request['user'] = payload;
  } catch {
    throw new UnauthorizedException('Token inválido');
  }

  return true;
}
```

**Después:**
```typescript
async canActivate(context: ExecutionContext): Promise<boolean> {
  const request = context.switchToHttp().getRequest();
  const token = this.extractTokenFromHeader(request);

  if (!token) {
    throw new UnauthorizedException('Token no proporcionado');
  }

  try {
    // ✅ Validación contra el Backend Java (CRM)
    const response = await fetch(process.env.CRM_REFRESH_TOKEN_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new UnauthorizedException('Token inválido');
    }

    const userData = await response.json();

    if (userData.rpta !== 1) {
      throw new UnauthorizedException('Token inválido');
    }

    // Adjuntar los datos del usuario a la request
    request['user'] = {
      username: userData.data.username || userData.data.usuario,
      id: userData.data.id,
      role: userData.data.role || userData.data.rol || 'ASESOR',
      ...userData.data,
    };
  } catch (error) {
    if (error instanceof UnauthorizedException) {
      throw error;
    }
    throw new UnauthorizedException('Token inválido o expirado');
  }

  return true;
}
```

---

## 🔑 Cómo Funciona Ahora

1. **Cliente envía request** con token JWT del Backend Java:
   ```http
   GET /api/recent-searches/admin
   Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

2. **JwtAuthGuard intercepta** la request y extrae el token

3. **Valida contra el Backend Java** haciendo una petición a:
   ```
   https://apisozarusac.com/BackendJava/api/refresh-token
   ```

4. **Backend Java responde** con los datos del usuario:
   ```json
   {
     "rpta": 1,
     "data": {
       "id": 123,
       "username": "admin",
       "nombre": "Juan",
       "apellido": "Pérez",
       "role": "ADMIN",
       ...
     }
   }
   ```

5. **Guard adjunta los datos** del usuario a `request['user']`

6. **Controller procesa** la request normalmente

---

## 🎯 Endpoints Afectados

Todos los endpoints de **Búsquedas Recientes** ahora aceptan tokens JWT del Backend Java:

- ✅ `POST /api/recent-searches`
- ✅ `GET /api/recent-searches/:username`
- ✅ `GET /api/recent-searches/:username/type/:searchType`
- ✅ `GET /api/recent-searches/:username/stats`
- ✅ `DELETE /api/recent-searches/:id`
- ✅ `DELETE /api/recent-searches/clear/:username`
- ✅ `POST /api/recent-searches/clean-old`

---

## 🧪 Prueba de Funcionamiento

### 1. Obtener un token del Backend Java

```bash
# Ejemplo: Login en el Backend Java
curl -X POST https://apisozarusac.com/BackendJava/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "tu_password"
  }'
```

**Respuesta:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { ... }
}
```

### 2. Usar el token en los endpoints de Búsquedas Recientes

```bash
curl -X POST http://localhost:8747/api/recent-searches \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "searchTerm": "test",
    "searchType": "general"
  }'
```

**Respuesta esperada (201 Created):**
```json
{
  "id": 1,
  "username": "admin",
  "searchTerm": "test",
  "searchType": "general",
  "resultCount": null,
  "clickedResultId": null,
  "createdAt": "2025-12-12T21:30:00.000Z",
  "updatedAt": "2025-12-12T21:30:00.000Z"
}
```

---

## ⚙️ Configuración Requerida

Asegúrate de que la variable de entorno esté configurada en `.env`:

```env
CRM_REFRESH_TOKEN_URL=https://apisozarusac.com/BackendJava/api/refresh-token
```

---

## 🔒 Seguridad

### Ventajas de esta implementación:

✅ **Validación centralizada**: Todos los tokens se validan contra el Backend Java  
✅ **Sin duplicación de secrets**: No necesitas compartir el JWT secret entre backends  
✅ **Revocación inmediata**: Si un token se revoca en el Backend Java, deja de funcionar inmediatamente  
✅ **Datos actualizados**: Siempre obtiene los datos más recientes del usuario  

### Consideraciones:

⚠️ **Latencia adicional**: Cada request hace una petición al Backend Java (añade ~50-200ms)  
⚠️ **Dependencia externa**: Si el Backend Java está caído, la autenticación falla  
⚠️ **Carga en el Backend Java**: Cada request autenticado genera una petición adicional  

### Optimización futura (opcional):

Para reducir la latencia, podrías implementar un **cache de tokens validados** en Redis:

```typescript
// Pseudocódigo
const cacheKey = `token:${token}`;
const cachedUser = await redis.get(cacheKey);

if (cachedUser) {
  request['user'] = JSON.parse(cachedUser);
  return true;
}

// Si no está en cache, validar contra Backend Java
const userData = await validateWithBackendJava(token);

// Guardar en cache por 5 minutos
await redis.set(cacheKey, JSON.stringify(userData), { EX: 300 });
```

---

## ✅ Estado Actual

🟢 **JwtAuthGuard modificado** para validar contra Backend Java  
🟢 **Servidor reiniciado** y funcionando correctamente  
🟢 **Todos los endpoints** aceptan tokens JWT del Backend Java  
🟢 **Compatible** con el sistema de autenticación existente  

---

## 📚 Archivos Modificados

- ✅ `src/auth/jwt-auth.guard.ts` - Guard modificado para validar contra Backend Java

---

## 🆘 Solución de Problemas

### Error: "Token inválido"
- Verifica que el token sea válido en el Backend Java
- Verifica que `CRM_REFRESH_TOKEN_URL` esté configurado correctamente
- Verifica que el Backend Java esté accesible desde el servidor de NestJS

### Error: "fetch is not defined"
- Este error no debería ocurrir en Node.js >= 18
- Si ocurre, instala `node-fetch`: `npm install node-fetch`

### Error: "Connection timeout"
- El Backend Java puede estar caído o inaccesible
- Verifica la conectividad de red
- Verifica que la URL sea correcta

---

## 📞 Resumen

El módulo de **Búsquedas Recientes** ahora acepta tokens JWT del **Backend Java** correctamente. 

La validación se hace en tiempo real contra el endpoint:
```
https://apisozarusac.com/BackendJava/api/refresh-token
```

¡Todo listo para usar! 🎉

