import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as crypto from 'crypto';
import { TemporaryRoomsService } from 'src/02.-Services/temporary-rooms/temporary-rooms.service';
import { MessagesService } from 'src/02.-Services/messages/messages.service';
import { TemporaryConversationsService } from 'src/02.-Services/temporary-conversations/temporary-conversations.service';
import { PollsService } from 'src/02.-Services/polls/polls.service';
import { User } from 'src/02.-Services/users/entities/user.entity';
import { RoomFavoritesService } from 'src/02.-Services/room-favorites/room-favorites.service';
import { ConversationFavoritesService } from 'src/02.-Services/conversation-favorites/conversation-favorites.service';
import { TemporaryRoom } from 'src/02.-Services/temporary-rooms/entities/temporary-room.entity';
import { getPeruDate, formatPeruTime } from '../../utils/date.utils';

interface UserCacheData {
    id: number;
    username: string;
    nombre: string;
    apellido: string;
    role: string;
    numeroAgente: string;
    picture?: string;
    sede?: string;
    sede_id?: number;
    cachedAt: number;
}

@WebSocketGateway({
    cors: {
        origin: '*',
    },
    transports: ['websocket', 'polling'],
    path: '/socket.io/',
    // 🔥 OPTIMIZADO: Timeouts relajados para evitar desconexiones en segundo plano
    pingTimeout: 60000,    //  60 segundos (antes 10s) - mayor tolerancia para pestañas en segundo plano
    pingInterval: 10000,   //  25 segundos (antes 15s)
    maxHttpBufferSize: 10 * 1024 * 1024, // 10MB - límite de tamaño de mensaje
    connectTimeout: 30000, //  30 segundos (antes 45s) - timeout más corto
    upgradeTimeout: 10000, // 10 segundos - timeout de upgrade de polling a websocket
    // ✅ Permitir reconexión después de desconexión temporal
    allowEIO3: true,       // Compatibilidad con clientes Engine.IO v3
})
@Injectable()
export class SocketGateway
    implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
    @WebSocketServer() server: Server;

    // Mapas para el chat
    private users = new Map<
        string,
        { socket: Socket; userData: any; currentRoom?: string }
    >();
    private groups = new Map<string, Set<string>>();
    private temporaryLinks = new Map<string, any>();
    private publicRooms = new Map<string, any>();
    private roomUsers = new Map<string, Set<string>>(); // roomCode -> Set<usernames>
    // ?? NUEVO: Cach� de mensajes recientes para detecci�n de duplicados
    private recentMessages = new Map<string, number>(); // messageHash -> timestamp
    private typingThrottle: Map<string, number> = new Map();

    // ?? OPTIMIZACI�N: �ndice normalizado para b�squedas case-insensitive r�pidas O(1)
    // Mapea username.toLowerCase() -> username original
    private usernameIndex = new Map<string, string>();

    // ?? NUEVO: Tracking de participantes en videollamadas
    private videoRoomParticipants = new Map<
        string,
        Set<{
            username: string;
            nombre?: string;
            apellido?: string;
            picture?: string;
        }>
    >(); // roomID -> Set<participant info>

    // ?? NUEVO: Cach de datos de usuario para evitar consultas repetidas
    private userCache = new Map<string, UserCacheData>();
    private CACHE_TTL = 5 * 60 * 1000; // 5 minutos

    //  NUEVO: Map de admins para broadcasting eficiente
    private adminUsers = new Map<string, { socket: Socket; userData: any }>();

    //  OPTIMIZACIN: Regex precompilado para menciones (evitar recompilar en cada mensaje)
    // Permite caracteres latinos y espacios (para nombres completos)
    private readonly mentionRegex = /@([a-zA-ZáéíóúÁÉÍÓÚñÑ0-9]+(?:\s+[a-zA-ZáéíóúÁÉÍÓÚñÑ0-9]+){0,3})(?=\s|$|[.,!?;:]|\n)/g;

    //  OPTIMIZACIÓN: Caché de salas para evitar consultas repetidas a BD
    private roomCache = new Map<string, { room: any; cachedAt: number }>();
    private ROOM_CACHE_TTL = 60 * 1000; // 🚀 1 minuto (antes: 30s)

    //  OPTIMIZACIÓN: Throttle para broadcastUserList (200+ usuarios)
    private lastBroadcastUserList = 0;
    private BROADCAST_USERLIST_THROTTLE = 10000; // 🚀 10 segundos (antes: 5s)
    private pendingBroadcastUserList = false;

    // 🚀 DEBOUNCE: Retrasar notificación de offline para evitar flapping
    private pendingDisconnects = new Map<string, NodeJS.Timeout>(); // username -> timeout
    private DISCONNECT_DEBOUNCE_MS = 10000; // 10 segundos de gracia antes de marcar offline

    // 🔥 NUEVO: Método público para verificar si un usuario está conectado
    // Primero verifica memoria local, luego Redis (para cluster)
    public isUserOnline(username: string): boolean {
        // 1. Verificar en memoria local (rápido - O(1))
        if (this.users.has(username)) {
            return true;
        }

        // 2. Para el método síncrono, solo podemos verificar memoria local
        // Para verificación completa de cluster, usar isUserOnlineAsync
        return false;
    }

    // 🔥 NUEVO: Versión async que verifica tanto memoria local como Redis (cluster)
    public async isUserOnlineAsync(username: string): Promise<boolean> {
        // 1. Verificar en memoria local (rápido - O(1))
        if (this.users.has(username)) {
            return true;
        }

        // 2. Verificar en Redis para cluster (si está disponible)
        if (this.isRedisReady()) {
            try {
                const userInfo = await this.redisClient.hGet(this.REDIS_ONLINE_USERS_KEY, username);
                if (userInfo) {
                    return true;
                }
            } catch (error) {
                console.error(`❌ Error verificando usuario online en Redis:`, error.message);
            }
        }

        return false;
    }

    // 🔥 NUEVO: Obtener Set de usuarios online para verificaciones batch (más eficiente)
    // Consulta Redis una sola vez y retorna un Set para O(1) lookups
    public async getOnlineUsersSet(): Promise<Set<string>> {
        const onlineSet = new Set<string>();

        // 1. Añadir usuarios de memoria local (username + displayName)
        for (const [username, { userData }] of this.users.entries()) {
            onlineSet.add(username);
            onlineSet.add(username.toLowerCase().trim());
            // 🔥 FIX: También agregar display name (nombre + apellido) para match con participantes de conversaciones
            if (userData?.nombre && userData?.apellido) {
                const displayName = `${userData.nombre} ${userData.apellido}`;
                onlineSet.add(displayName);
                onlineSet.add(displayName.toLowerCase().trim());
            }
        }

        // 2. Añadir usuarios de Redis (para cluster) - username + displayName
        if (this.isRedisReady()) {
            try {
                const usersHash = await this.redisClient.hGetAll(this.REDIS_ONLINE_USERS_KEY);
                for (const [username, jsonData] of Object.entries(usersHash)) {
                    onlineSet.add(username);
                    onlineSet.add(username.toLowerCase().trim());
                    // 🔥 FIX: Parsear datos de Redis para obtener display name
                    try {
                        const userData = JSON.parse(jsonData as string);
                        if (userData?.nombre && userData?.apellido) {
                            const displayName = `${userData.nombre} ${userData.apellido}`;
                            onlineSet.add(displayName);
                            onlineSet.add(displayName.toLowerCase().trim());
                        }
                    } catch { /* ignorar errores de parseo */ }
                }
            } catch (error) {
                console.error(`❌ Error obteniendo usuarios online de Redis:`, error.message);
            }
        }

        return onlineSet;
    }

    // 🔥 NUEVO: Verificar si un usuario está online usando un Set pre-cargado
    // Útil cuando ya tenemos la lista de Redis y queremos evitar re-consultar
    public isUserOnlineWithSet(username: string, onlineSet: Set<string>): boolean {
        return onlineSet.has(username) || onlineSet.has(username.toLowerCase().trim());
    }

    /**
     * ?? OPTIMIZACIN: Bsqueda case-insensitive rpida usando ndice
     * ANTES: O(n) iterando sobre todos los usuarios
     * AHORA: O(1) lookup en el �ndice
     */
    private getUserCaseInsensitive(username: string): { socket: Socket; userData: any; currentRoom?: string } | undefined {
        // Primero intentar b�squeda exacta (caso m�s com�n)
        let user = this.users.get(username);
        if (user) return user;

        // Si no se encuentra, usar �ndice normalizado
        const normalizedKey = username?.toLowerCase().trim();
        const actualUsername = this.usernameIndex.get(normalizedKey);
        if (actualUsername) {
            return this.users.get(actualUsername);
        }

        return undefined;
    }

    /**
     * ?? OPTIMIZACI�N: Detectar menciones en un mensaje usando regex precompilado
     * Evita recompilar el regex en cada mensaje
     */
    private detectMentions(message: string): string[] {
        if (!message) return [];

        const mentions: string[] = [];
        // Resetear el �ndice del regex antes de usarlo
        this.mentionRegex.lastIndex = 0;

        let match;
        while ((match = this.mentionRegex.exec(message)) !== null) {
            mentions.push(match[1].trim());
        }

        return mentions;
    }

    /**
     *  OPTIMIZACIÓN: Obtener sala desde caché o BD
     * Evita consultas repetidas a BD en cada mensaje
     */
    private async getCachedRoom(roomCode: string): Promise<any> {
        const cached = this.roomCache.get(roomCode);
        if (cached && Date.now() - cached.cachedAt < this.ROOM_CACHE_TTL) {
            return cached.room;
        }

        try {
            const room = await this.temporaryRoomsService.findByRoomCode(roomCode);
            if (room) {
                this.roomCache.set(roomCode, { room, cachedAt: Date.now() });
            }
            return room;
        } catch (error) {
            console.error(`❌ Error al obtener sala ${roomCode}:`, error);
            return null;
        }
    }

    /**
     *  OPTIMIZACIÓN: Invalidar caché de una sala (cuando hay cambios)
     */
    private invalidateRoomCache(roomCode: string): void {
        this.roomCache.delete(roomCode);
    }

    /**
     * 🔥 CLUSTER FIX: Obtener datos de múltiples usuarios desde BD
     * Resuelve el problema donde usuarios en otras instancias no tenían datos (solo aparecían como strings)
     */
    private async getBatchUsersData(usernames: string[]): Promise<any[]> {
        if (!usernames || usernames.length === 0) return [];

        try {
            // Normalizar usernames para búsqueda
            const cleanUsernames = usernames.map(u => u.trim());

            // Buscar en BD usando UserRepository inyectado
            const users = await this.userRepository.find({
                where: { username: In(cleanUsernames) },
                select: ['username', 'nombre', 'apellido'] // ❌ FIX: Remover picture que no existe en User entity
            });

            // Map de resultados para acceso rápido (case insensitive keys)
            const usersMap = new Map(users.map(u => [u.username.toLowerCase(), u]));

            // Construir resultado preservando el orden original y manejando faltantes
            return usernames.map(username => {
                const lowerUsername = username.toLowerCase().trim();
                const user = usersMap.get(lowerUsername);

                if (user && user.nombre) {
                    return {
                        username: user.username,
                        nombre: user.nombre,
                        apellido: user.apellido,
                        picture: null // No hay campo picture en BD
                    };
                }

                // Fallback: intentar obtener de this.users (memoria local) por si acaso es un usuario temporal o data reciente
                const localUser = this.users.get(username);
                if (localUser?.userData?.nombre) {
                    return {
                        username,
                        nombre: localUser.userData.nombre,
                        apellido: localUser.userData.apellido,
                        picture: localUser.userData.picture || null
                    };
                }

                return username; // Fallback final a string si no se encuentra
            });
        } catch (error) {
            console.error('❌ Error obteniendo datos batch de usuarios:', error);
            // Fallback: intentar obtener de memoria local aunque sea incompleto
            return usernames.map(username => {
                const localUser = this.users.get(username);
                if (localUser?.userData?.nombre) {
                    return {
                        username,
                        nombre: localUser.userData.nombre,
                        apellido: localUser.userData.apellido,
                        picture: localUser.userData.picture
                    };
                }
                return username;
            });
        }
    }

    /**
     * 🚀 OPTIMIZACIÓN: Broadcast ligero de cambio de estado de usuario
     * En lugar de enviar toda la lista, solo envía el cambio de estado
     *  CLUSTER FIX: Usar server.emit() para broadcast a TODAS las instancias
     */
    private broadcastUserStatusChange(username: string, isOnline: boolean, userData?: any, originalUsername?: string): void {
        const statusUpdate = {
            username,  // displayName (ej: "Juan Pérez")
            originalUsername: originalUsername || username,  //  username original para match
            isOnline,
            nombre: userData?.nombre || null,
            apellido: userData?.apellido || null,
            picture: userData?.picture || null, // 📸 FIX: Enviar foto
        };

        //  CLUSTER FIX: Usar server.emit() para broadcast global
        // Esto funciona con Redis adapter y también sin él (single instance)
        // console.log(`📢 ESTADO: Broadcasting ${originalUsername} isOnline=${isOnline} a todo el cluster`);
        this.server.emit('userStatusChanged', statusUpdate);
    }

    constructor(
        private temporaryRoomsService: TemporaryRoomsService,
        private messagesService: MessagesService,
        private temporaryConversationsService: TemporaryConversationsService,
        private pollsService: PollsService,
        private roomFavoritesService: RoomFavoritesService, //  NUEVO: Inyectar servicio de favoritos
        private conversationFavoritesService: ConversationFavoritesService, // 🔥 NUEVO: Inyectar servicio de favoritos de conversaciones
        @InjectRepository(User)
        private userRepository: Repository<User>,
    ) {
        // Limpiar enlaces expirados cada 5 minutos
        setInterval(() => this.cleanExpiredLinks(), 5 * 60 * 1000);

        // ?? OPTIMIZADO: Limpiar cach� de mensajes cada 30 segundos (antes: 10s)
        // Reducir frecuencia para disminuir consumo de CPU
        setInterval(() => this.cleanRecentMessagesCache(), 30 * 1000);

        // Inyectar referencia del gateway en el servicio para notificaciones
        this.temporaryRoomsService.setSocketGateway(this);

        // ?? OPTIMIZADO: Limpiar conexiones hu�rfanas cada 10 minutos (antes: 5min)
        // Reducir frecuencia ya que las desconexiones se manejan en handleDisconnect
        setInterval(() => this.cleanOrphanedConnections(), 10 * 60 * 1000);

        // ?? OPTIMIZADO: Limpiar cach� de usuarios cada 15 minutos (antes: 10min)
        setInterval(() => this.cleanUserCache(), 15 * 60 * 1000);

        // 🚀 OPTIMIZACIÓN: Limpiar caché de salas cada 5 minutos
        setInterval(() => this.cleanRoomCache(), 5 * 60 * 1000);

        // ?? OPTIMIZADO: Monitorear estad�sticas del sistema cada 60 minutos (antes: 30min)
        setInterval(() => this.logSystemStats(), 60 * 60 * 1000);

    }

    // 🔥 NUEVO: Obtener todas las variantes de identificación de un usuario (DNI y Nombre Completo) para emisión de sockets
    public async getUserIdentifiersArray(username: string): Promise<string[]> {
        if (!username) return [];
        const normalizedInput = username.trim();
        const user = await this.userRepository.findOne({
            where: [
                { username: normalizedInput },
                { nombre: normalizedInput }
            ]
        });

        if (!user) {
            return [normalizedInput];
        }

        const fullName = user.nombre && user.apellido ? `${user.nombre} ${user.apellido}` : user.nombre;
        const identifiers = new Set<string>();
        identifiers.add(normalizedInput);
        if (user.username) identifiers.add(user.username);
        if (fullName) identifiers.add(fullName);

        return Array.from(identifiers);
    }

    //  NUEVO: Cargar grupos al iniciar el servidor y configurar Redis Adapter
    //  Cliente Redis para tracking global de usuarios online
    private redisClient: any = null;
    private readonly REDIS_ONLINE_USERS_KEY = 'chat:online_users';

    async afterInit(server: Server) {
        //  CLUSTER FIX: Configurar Redis Adapter para sincronizar entre instancias
        try {
            const { createClient } = await import('redis');
            const { createAdapter } = await import('@socket.io/redis-adapter');

            const redisUrl = `redis://:${process.env.REDIS_PASSWORD || 'Midas*2025'}@${process.env.REDIS_HOST || '198.46.186.2'}:${process.env.REDIS_PORT || 6379}`;

            const pubClient = createClient({
                url: redisUrl,
                socket: {
                    connectTimeout: 10000,       // 10 segundos para conectar
                    keepAlive: 30000,            // Keep-alive cada 30 segundos
                    reconnectStrategy: (retries) => {
                        // Reconectar con backoff exponencial, máximo 30 segundos
                        const delay = Math.min(retries * 100, 30000);
                        console.log(`🔄 Redis reconectando intento ${retries}, delay: ${delay}ms`);
                        return delay;
                    }
                }
            });

            const subClient = pubClient.duplicate();

            //  Event handlers para monitorear estado de Redis
            pubClient.on('error', (err) => {
                console.error('❌ Redis pubClient error:', err.message);
            });

            pubClient.on('reconnecting', () => {
                console.log('🔄 Redis pubClient reconectando...');
            });

            pubClient.on('ready', () => {
                console.log('✅ Redis pubClient listo');
            });

            subClient.on('error', (err) => {
                console.error('❌ Redis subClient error:', err.message);
            });

            subClient.on('reconnecting', () => {
                console.log('🔄 Redis subClient reconectando...');
            });

            //  Guardar referencia para tracking de usuarios online
            this.redisClient = pubClient;

            await Promise.all([pubClient.connect(), subClient.connect()]);

            server.adapter(createAdapter(pubClient, subClient));
            console.log('✅ Redis Adapter configurado para Socket.IO (Cluster Mode)');
        } catch (error) {
            console.error('⚠️ Redis Adapter no disponible, modo single-instance:', error.message);
            // Continuar sin Redis adapter (modo desarrollo o single instance)
        }

        // Cargar grupos desde BD
        try {
            const rooms = await this.temporaryRoomsService.findAll();

            let totalMembers = 0;
            rooms.forEach((room) => {
                const members = new Set(room.members || []);
                this.groups.set(room.name, members);
                totalMembers += members.size;
                if (process.env.NODE_ENV === 'development') {
                    // console.log(`   ✓ "${room.name}" (${members.size} miembros)`);
                }
            });

            // console.log(
            //    `✅ Socket Gateway inicializado: ${this.groups.size} salas, ${totalMembers} miembros totales`,
            //);
        } catch (error) {
            console.error('❌ Error al cargar grupos en afterInit:', error);
        }
    }

    //  Helper para verificar si Redis está conectado y listo
    private isRedisReady(): boolean {
        return this.redisClient && this.redisClient.isReady;
    }

    //  CLUSTER FIX: Funciones para gestionar usuarios online en Redis
    private async addOnlineUserToRedis(username: string, userData: any): Promise<void> {
        if (!this.isRedisReady()) return;
        try {
            const userInfo = JSON.stringify({
                username,
                nombre: userData?.nombre || null,
                apellido: userData?.apellido || null,
                picture: userData?.picture || null,
            });
            await this.redisClient.hSet(this.REDIS_ONLINE_USERS_KEY, username, userInfo);
        } catch (error) {
            console.error('❌ Error agregando usuario a Redis:', error.message);
        }
    }

    private async removeOnlineUserFromRedis(username: string): Promise<void> {
        if (!this.isRedisReady()) return;
        try {
            await this.redisClient.hDel(this.REDIS_ONLINE_USERS_KEY, username);
        } catch (error) {
            console.error('❌ Error removiendo usuario de Redis:', error.message);
        }
    }

    private async getOnlineUsersFromRedis(): Promise<any[]> {
        if (!this.isRedisReady()) return [];
        try {
            const usersHash = await this.redisClient.hGetAll(this.REDIS_ONLINE_USERS_KEY);
            const users = [];
            for (const [username, jsonData] of Object.entries(usersHash)) {
                try {
                    const userData = JSON.parse(jsonData as string);
                    users.push({ ...userData, isOnline: true });
                } catch {
                    users.push({ username, isOnline: true });
                }
            }
            return users;
        } catch (error) {
            console.error('❌ Error obteniendo usuarios online de Redis:', error.message);
            return [];
        }
    }

    // 🔥 NUEVO: Obtener Mapa de usuarios online (para lookup rápido O(1))
    // Retorna username -> UserData
    private async getOnlineUsersDataMap(): Promise<Map<string, any>> {
        const usersMap = new Map<string, any>();
        if (!this.isRedisReady()) return usersMap;

        try {
            const usersHash = await this.redisClient.hGetAll(this.REDIS_ONLINE_USERS_KEY);
            for (const [username, jsonData] of Object.entries(usersHash)) {
                try {
                    const userData = JSON.parse(jsonData as string);
                    usersMap.set(username, userData);
                    // También mapear minúsculas para lookup case-insensitive
                    usersMap.set(username.toLowerCase(), userData);
                } catch {
                    // Ignorar errores de parseo
                }
            }
        } catch (error) {
            console.error('❌ Error obteniendo mapa de usuarios online de Redis:', error.message);
        }
        return usersMap;
    }

    //  CLUSTER FIX: Enviar estado online (Filtrado por relevancia)
    private async sendInitialOnlineStatuses(
        socket: Socket,
        username: string,
        assignedConversations: any[] = []
    ): Promise<void> {
        if (!this.isRedisReady()) return;
        try {
            const onlineUsers = await this.getOnlineUsersFromRedis();

            // 1. Construir conjunto de usuarios relevantes (Whitelist)
            const relevantUsers = new Set<string>();

            // A. Añadir participantes de conversaciones asignadas
            console.log(`🔍 [WHITELIST-DEBUG] assignedConversations count: ${assignedConversations?.length || 0}`);
            if (assignedConversations && assignedConversations.length > 0) {
                assignedConversations.forEach((conv, idx) => {
                    console.log(`🔍 [WHITELIST-DEBUG] conv[${idx}]: id=${conv.id}, participants=${JSON.stringify(conv.participants)}, keys=${Object.keys(conv).join(',')}`);
                    if (conv.participants && Array.isArray(conv.participants)) {
                        conv.participants.forEach(p => relevantUsers.add(p.toLowerCase().trim()));
                    }
                });
            }

            // B. Añadir compañeros de salas (Grupos)
            // Obtener salas donde está el usuario
            const userRooms = this.users.get(username)?.currentRoom
                ? [this.users.get(username)?.currentRoom] // Si solo tenemos currentRoom
                : [];

            // Buscar en todas las salas en memoria donde este usuario es miembro
            for (const [roomCode, members] of this.roomUsers.entries()) {
                if (members.has(username)) {
                    members.forEach(m => relevantUsers.add(m.toLowerCase().trim()));
                }
            }

            // C. 🔥 NUEVO: Añadir favoritos (para que aparezcan online de inmediato)
            try {
                // 1. Favoritos de salas (Grupos)
                const favoriteRoomCodes = await this.roomFavoritesService.getUserFavoriteRoomCodes(username);
                if (favoriteRoomCodes && favoriteRoomCodes.length > 0) {
                    favoriteRoomCodes.forEach(code => {
                        relevantUsers.add(code.toLowerCase().trim());
                    });
                }

                // 2. 🔥 NUEVO: Favoritos de conversaciones privadas (Karen, etc.)
                const favoriteConversations = await this.conversationFavoritesService.getUserFavoritesWithConversationData(username);
                if (favoriteConversations && favoriteConversations.length > 0) {
                    favoriteConversations.forEach(conv => {
                        if (conv.participants && Array.isArray(conv.participants)) {
                            conv.participants.forEach(p => {
                                // No añadirnos a nosotros mismos (aunque no hace daño, ya está en la whitelist)
                                if (p.toLowerCase().trim() !== username.toLowerCase().trim()) {
                                    relevantUsers.add(p.toLowerCase().trim());
                                }
                            });
                        }
                    });
                }
            } catch (favError) {
                console.error(`❌ Error obteniendo favoritos para whitelist online:`, favError.message);
            }

            // Filtrar y enviar
            let sentCount = 0;
            // 🔍 DEBUG: Mostrar whitelist para diagnóstico
            console.log(`🔍 [ONLINE-DEBUG] Whitelist de usuarios relevantes (${relevantUsers.size}):`, [...relevantUsers].slice(0, 20));
            for (const user of onlineUsers) {
                const targetUsername = user.username?.toLowerCase().trim();
                // 🔥 FIX: Construir display name robusto (permitir nombre o apellido solos)
                const targetDisplayName = (user.nombre || user.apellido)
                    ? `${user.nombre || ''} ${user.apellido || ''}`.toLowerCase().trim()
                    : null;

                //  FILTRO: Solo enviar si es relevante o si es el mismo usuario (para confirmación)
                const isRelevant = relevantUsers.has(targetUsername) ||
                    (targetDisplayName && relevantUsers.has(targetDisplayName)) ||
                    targetUsername === username.toLowerCase().trim();

                if (isRelevant) {
                    const emitDisplayName = (user.nombre || user.apellido)
                        ? `${user.nombre || ''} ${user.apellido || ''}`.trim()
                        : user.username;
                    console.log(`📤 [ONLINE-DEBUG] Enviando estado: ${emitDisplayName} (${user.username}) isOnline=true`);
                    socket.emit('userStatusChanged', {
                        username: emitDisplayName,
                        originalUsername: user.username,
                        isOnline: true,
                        nombre: user.nombre,
                        apellido: user.apellido,
                        picture: user.picture,
                    });
                    sentCount++;
                }
            }
            console.log(`📤 Enviados ${sentCount} estados online iniciales (Filtrados de ${onlineUsers.length})`);
        } catch (error) {
            console.error('❌ Error enviando estados online iniciales:', error.message);
        }
    }

    async handleDisconnect(client: Socket) {
        // Remover usuario del chat si existe
        for (const [username, user] of this.users.entries()) {
            if (user.socket === client) {
                // Si el usuario estaba en una sala, solo removerlo de la memoria (NO de la BD)
                if (user.currentRoom) {
                    const roomCode = user.currentRoom;
                    const roomUsersSet = this.roomUsers.get(roomCode);
                    if (roomUsersSet) {
                        roomUsersSet.delete(username);
                        if (roomUsersSet.size === 0) {
                            this.roomUsers.delete(roomCode);
                        }
                    }
                    // Notificar a otros usuarios de la sala que este usuario se desconectó
                    await this.broadcastRoomUsers(roomCode);
                }

                // Remover usuario del mapa de usuarios conectados (memoria local)
                const userData = user.userData;
                this.users.delete(username);
                this.adminUsers.delete(username);
                this.usernameIndex.delete(username.toLowerCase().trim());

                const displayName = (userData?.nombre || userData?.apellido)
                    ? `${userData.nombre || ''} ${userData.apellido || ''}`.trim()
                    : username;

                // 🚀 DEBOUNCE: No marcar offline inmediatamente, esperar 10 segundos
                // Si el usuario se reconecta antes, cancelamos el timeout y no notificamos offline
                console.log(`⏳ handleDisconnect: ${displayName} (${username}) desconectado - esperando ${this.DISCONNECT_DEBOUNCE_MS / 1000}s antes de marcar offline`);

                // Guardar referencia al socket ID para verificar después
                const disconnectedSocketId = client.id;

                // Crear timeout debounce
                const disconnectTimeout = setTimeout(async () => {
                    try {
                        // 🛡️ RACE CONDITION FIX: Verificar si hay una nueva sesión activa
                        // Si el usuario se reconectó, NO marcar como offline
                        if (this.users.has(username)) {
                            console.log(`✅ DEBOUNCE CANCELADO: ${username} se reconectó antes del timeout`);
                            this.pendingDisconnects.delete(username);
                            return;
                        }

                        // Verificar también en Redis si hay una sesión más nueva
                        if (this.isRedisReady()) {
                            const currentRedisSocketId = await this.redisClient.get(`socket:user:${username}`);
                            if (currentRedisSocketId && currentRedisSocketId !== disconnectedSocketId) {
                                console.log(`🛡️ DEBOUNCE: ${username} tiene nueva sesión (${currentRedisSocketId}). MANTENIENDO ONLINE.`);
                                this.pendingDisconnects.delete(username);
                                return;
                            }
                        }

                        // El usuario NO se reconectó, ahora sí marcar como offline
                        console.log(`👤 DEBOUNCE EXPIRADO: ${displayName} (${username}) marcado como OFFLINE`);

                        // Broadcast ligero: notificar cambio de estado offline
                        this.broadcastUserStatusChange(displayName, false, userData, username);

                        // CLUSTER FIX: Remover usuario de Redis para tracking global
                        await this.removeOnlineUserFromRedis(username);

                        // CLUSTER FIX: Limpiar socket ID de Redis
                        if (this.isRedisReady()) {
                            await this.redisClient.del(`socket:user:${username}`);
                        }

                        this.pendingDisconnects.delete(username);
                    } catch (err) {
                        console.error(`Error en debounce disconnect para ${username}:`, err);
                        this.pendingDisconnects.delete(username);
                    }
                }, this.DISCONNECT_DEBOUNCE_MS);

                // Guardar timeout para poder cancelarlo si el usuario se reconecta
                this.pendingDisconnects.set(username, disconnectTimeout);

                break;
            }
        }
    }

    handleConnection(_client: Socket) {
        // Socket.IO connection established
    }

    // ===== EVENTOS DEL CHAT =====

    @SubscribeMessage('register')
    async handleRegister(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: { username: string; userData: any; assignedConversations?: any[] },
    ) {
        //  PERFORMANCE LOGGING - Diagnosticar picos de CPU
        const perfLabel = `⏱️ handleRegister [${data.username}]`;
        console.time(perfLabel);

        const { username, userData, assignedConversations } = data;

        // 🔍 DEBUG TEMPORAL: Interceptar TODOS los eventos del socket de KAREN
        if (username?.toUpperCase().includes('KAREN')) {
            console.log(`🔍🔍🔍 INTERCEPTANDO TODOS LOS EVENTOS DE KAREN (socket: ${client.id})`);
            const originalOnAny = client.onAny;
            client.onAny((eventName: string, ...args: any[]) => {
                if (eventName !== 'register') {
                    console.log(`🔍🔍🔍 KAREN EMITIÓ EVENTO: "${eventName}" args: ${JSON.stringify(args)?.substring(0, 200)}`);
                }
            });
        }

        //  CLUSTER FIX: Tracking global de sockets via Redis
        // Antes usábamos this.users (local), ahora verificamos en Redis para detectar
        // conexiones duplicadas en CUALQUIER cluster
        if (this.isRedisReady()) {
            try {
                const redisKey = `socket:user:${username}`;
                const existingSocketId = await this.redisClient.get(redisKey);

                // 🛡️ RACE CONDITION FIX: Actualizar Redis ANTES de desconectar el socket anterior
                // Esto asegura que cuando 'handleDisconnect' se ejecute en el socket viejo,
                // vea que ya hay un nuevo ID registrado y NO marque al usuario como offline.
                await this.redisClient.set(redisKey, client.id, { EX: 86400 });

                if (existingSocketId && existingSocketId !== client.id) {
                    // El usuario ya tiene un socket activo en algún cluster
                    // Emitir evento global para desconectarlo (via Redis adapter)
                    console.log(`⚠️ ${username} ya conectado en otro cluster (socket: ${existingSocketId}), forzando desconexión (Nuevo: ${client.id})`);
                    this.server.to(existingSocketId).emit('forceDisconnect', {
                        reason: 'Nueva conexión detectada',
                        newSocketId: client.id
                    });
                }
            } catch (err) {
                console.error(`Error en tracking Redis de ${username}:`, err.message);
            }
        }

        // Verificación local adicional (para el mismo cluster)
        const existingUser = this.users.get(username);
        if (existingUser && existingUser.socket !== client) {
            try {
                if (existingUser.socket.connected) {
                    console.log(`⚠️ ${username} ya conectado localmente, desconectando socket anterior`);
                    existingUser.socket.disconnect(true);
                }
            } catch (err) {
                console.error(`Error desconectando socket local de ${username}:`, err.message);
            }
        }

        // 🚀 DEBOUNCE: Cancelar timeout de desconexión pendiente si el usuario se reconecta
        const pendingTimeout = this.pendingDisconnects.get(username);
        if (pendingTimeout) {
            clearTimeout(pendingTimeout);
            this.pendingDisconnects.delete(username);
            console.log(`✅ DEBOUNCE CANCELADO: ${username} se reconectó antes del timeout`);
        }

        this.users.set(username, { socket: client, userData });

        // 🔥 CLUSTER FIX: Unir socket a salas para TODOS sus alias posibles
        // Esto garantiza que cualquier notificación enviada a un DNI, Nombre o Email
        // llegue a este socket sin importar qué identificador use el emisor.
        const aliases = await this.messagesService.resolveUserAliases(username);

        // Agregar también el nombre actual que viene en userData por si acaso no está en la BD aún
        if (userData?.nombre && userData?.apellido) {
            aliases.push(`${userData.nombre} ${userData.apellido}`);
        }

        const uniqueAliases = Array.from(new Set(aliases.map(a => a?.toLowerCase().trim()).filter(a => !!a)));

        for (const alias of uniqueAliases) {
            await client.join(alias);
            await client.join(alias.toUpperCase());
            // console.log(`🚪 Socket ${client.id} [${username}] unido a sala alias: [${alias}]`);
        }

        // Salas estándar adicionales
        await client.join(username);
        await client.join(`user:${username}`);
        await client.join(client.id);

        console.log(`✅ Registro robusto para ${username}: Unido a ${uniqueAliases.length} salas de alias.`);

        // ?? OPTIMIZACIN: Actualizar ndice normalizado para bsquedas rpidas
        this.usernameIndex.set(username.toLowerCase().trim(), username);

        // 🚀 OPTIMIZADO: Guardar o actualizar usuario en la base de datos con numeroAgente y role
        // Solo si hay cambios significativos (evitar escrituras innecesarias)
        let userCacheData: any = null;

        try {
            // 🚀 REDIS CACHE: Verificar primero en Redis (para cluster) antes de ir a MySQL
            let cachedUser = this.userCache.get(username);

            // Si no está en memoria local, intentar obtener de Redis
            if (!cachedUser && this.isRedisReady()) {
                try {
                    const redisUserData = await this.redisClient.get(`user:cache:${username}`);
                    if (redisUserData) {
                        cachedUser = JSON.parse(redisUserData);
                        // Restaurar a caché local
                        this.userCache.set(username, { ...cachedUser, cachedAt: Date.now() });
                        console.log(`🚀 REDIS CACHE HIT: Datos de ${username} restaurados desde Redis (evitando MySQL)`);
                    }
                } catch (err) {
                    console.error(`Error leyendo caché Redis de ${username}:`, err.message);
                }
            }

            const needsDbUpdate = !cachedUser ||
                cachedUser.role !== userData?.role ||
                cachedUser.numeroAgente !== userData?.numeroAgente ||
                cachedUser.picture !== userData?.picture ||
                cachedUser.sede !== userData?.sede ||
                cachedUser.sede_id !== userData?.sede_id;

            if (needsDbUpdate) {
                let dbUser = await this.userRepository.findOne({ where: { username } });

                // 🛡️ RACE CONDITION / DUPLICATION FIX: Si no se encuentra por username, intentar por email
                if (!dbUser && userData?.email) {
                    dbUser = await this.userRepository.findOne({ where: { email: userData.email } });
                    if (dbUser) {
                        console.log(`♻️ Usuario ${username} recuperado por EMAIL (${userData.email}) - Vinculando a cuenta existente.`);
                    }
                }

                if (dbUser) {
                    // Actualizar usuario existente solo si hay cambios
                    let hasChanges = false;

                    // 🛠️ AUTO-NORMALIZACIÓN: Si el username en BD es un nombre y el que viene es un DNI, actualizar
                    const isNewUsernameNumeric = /^\d+$/.test(username);
                    const isOldUsernameNumeric = /^\d+$/.test(dbUser.username);
                    if (isNewUsernameNumeric && !isOldUsernameNumeric) {
                        console.log(`✅ Normalizando USERNAME de [${dbUser.username}] a [${username}] (DNI)`);
                        dbUser.username = username;
                        hasChanges = true;
                    }

                    if (userData?.nombre && dbUser.nombre !== userData.nombre) {
                        dbUser.nombre = userData.nombre;
                        hasChanges = true;
                    }
                    if (userData?.apellido && dbUser.apellido !== userData.apellido) {
                        dbUser.apellido = userData.apellido;
                        hasChanges = true;
                    }
                    if (userData?.email && dbUser.email !== userData.email) {
                        dbUser.email = userData.email;
                        hasChanges = true;
                    }
                    if (userData?.role && dbUser.role !== userData.role) {
                        dbUser.role = userData.role;
                        hasChanges = true;
                    }
                    if (userData?.numeroAgente && dbUser.numeroAgente !== userData.numeroAgente) {
                        dbUser.numeroAgente = userData.numeroAgente;
                        hasChanges = true;
                    }
                    if (userData?.picture && dbUser.picture !== userData.picture) {
                        dbUser.picture = userData.picture;
                        hasChanges = true;
                    }
                    if (userData?.sede && dbUser.sede !== userData.sede) {
                        dbUser.sede = userData.sede;
                        hasChanges = true;
                    }
                    if (userData?.sede_id && dbUser.sede_id !== userData.sede_id) {
                        dbUser.sede_id = userData.sede_id;
                        hasChanges = true;
                    }

                    if (hasChanges) {
                        await this.userRepository.save(dbUser);
                    }
                } else {
                    // Crear nuevo usuario
                    dbUser = this.userRepository.create({
                        username,
                        nombre: userData?.nombre,
                        apellido: userData?.apellido,
                        email: userData?.email,
                        role: userData?.role,
                        numeroAgente: userData?.numeroAgente,
                        picture: userData?.picture,
                        sede: userData?.sede,
                        sede_id: userData?.sede_id,
                    });
                    await this.userRepository.save(dbUser);
                }

                // 🚀 OPTIMIZACIÓN: Actualizar caché de usuario (local + Redis)
                userCacheData = {
                    id: dbUser.id,
                    username: dbUser.username,
                    nombre: dbUser.nombre,
                    apellido: dbUser.apellido,
                    role: dbUser.role,
                    numeroAgente: dbUser.numeroAgente,
                    picture: userData?.picture || null,
                    sede: dbUser.sede,
                    sede_id: dbUser.sede_id,
                    cachedAt: Date.now(),
                };
                this.userCache.set(username, userCacheData);

                // 🚀 REDIS CACHE: Guardar en Redis para acceso entre clusters (TTL: 30 minutos)
                if (this.isRedisReady()) {
                    try {
                        await this.redisClient.set(
                            `user:cache:${username}`,
                            JSON.stringify(userCacheData),
                            { EX: 1800 } // 30 minutos
                        );
                    } catch (err) {
                        console.error(`Error guardando caché Redis de ${username}:`, err.message);
                    }
                }
            } else {
                // Si no hubo updates, usar el usuario de cache existente
                userCacheData = cachedUser;
            }

            // ?? NUEVO: Agregar a adminUsers si es admin
            if (userData?.role?.toString().toUpperCase().trim() === 'ADMIN') {
                this.adminUsers.set(username, { socket: client, userData });
                // console.log(` Usuario admin agregado al Map: ${username}`);
            }
        } catch (error) {
            console.error(` Error al guardar usuario ${username} en BD:`, error);
        }

        //  🚀 OPTIMIZADO: Restaurar salas del usuario desde BD
        // ANTES: solo buscaba por username. AHORA: busca por username Y displayName (Full Name)
        try {
            const displayName = (userData?.nombre || userData?.apellido)
                ? `${userData.nombre || ''} ${userData.apellido || ''}`.trim()
                : username;

            // Usar método específico para buscar salas del usuario por ambos términos
            // console.log(`🔍 Buscando salas para ${username} y ${displayName}...`);
            const roomsByUsername = await this.temporaryRoomsService.findByMember(username);
            const roomsByDisplayName = (displayName !== username)
                ? await this.temporaryRoomsService.findByMember(displayName)
                : [];

            // Combinar y eliminar duplicados de salas encontradas
            const allUserRoomsMap = new Map<string, TemporaryRoom>();
            roomsByUsername.forEach(r => allUserRoomsMap.set(r.roomCode, r));
            roomsByDisplayName.forEach(r => allUserRoomsMap.set(r.roomCode, r));

            const userRooms = Array.from(allUserRoomsMap.values());
            // console.log(`✅ Salas encontradas para ${username}: ${userRooms.length}`);

            for (const room of userRooms) {
                // Agregar usuario a la sala en memoria
                if (!this.roomUsers.has(room.roomCode)) {
                    this.roomUsers.set(room.roomCode, new Set());
                }
                this.roomUsers.get(room.roomCode)!.add(username);

                //  CLUSTER FIX: Unir socket a la sala Redis para recibir broadcasts
                await client.join(room.roomCode);

                // 🚀 Cachear la sala para evitar consultas futuras
                this.roomCache.set(room.roomCode, { room, cachedAt: Date.now() });
            }

            // Si el usuario estaba en una sala, actualizar su currentRoom
            if (userRooms.length > 0) {
                const user = this.users.get(username);
                if (user) {
                    user.currentRoom = userRooms[0].roomCode;
                }
            }
        } catch (error) {
            console.error(` Error al restaurar salas para ${username}:`, error);
        }

        //  CLUSTER FIX: Restaurar salas FAVORITAS (incluso si no está en members explícitamente)
        try {
            const favoriteRoomCodes = await this.roomFavoritesService.getUserFavoriteRoomCodes(username);

            if (favoriteRoomCodes.length > 0) {
                // console.log(`⭐ Restaurando ${favoriteRoomCodes.length} favoritos para ${username}`);
                for (const code of favoriteRoomCodes) {
                    await client.join(code);

                    // Opcional: Agregar a memoria si queremos trackearlo como "roomUser"
                    if (!this.roomUsers.has(code)) {
                        this.roomUsers.set(code, new Set());
                    }
                    this.roomUsers.get(code)!.add(username);
                }
            }
        } catch (error) {
            console.error(` Error al restaurar favoritos para ${username}:`, error);
        }

        // Enviar confirmación de registro
        client.emit('info', {
            message: `Registrado como ${username}`,
        });

        //  🚀 OPTIMIZACIÓN: Enviar notificación ligera de conexión
        // En lugar de consultar conversaciones y hacer broadcastUserList completo,
        // solo notificar que el usuario se conectó
        const displayName = (userData?.nombre || userData?.apellido)
            ? `${userData.nombre || ''} ${userData.apellido || ''}`.trim()
            : username;

        // Broadcast ligero: solo notificar cambio de estado online
        // 🔥 FIX: Usar userCacheData para asegurar que picture y otros datos actualizados se envíen
        const userToBroadcast = userCacheData || userData;
        this.broadcastUserStatusChange(displayName, true, userToBroadcast, username);

        //  CLUSTER FIX: Agregar usuario a Redis para tracking global
        // 🔥 FIX: Usar userCacheData para asegurar que picture esté en Redis
        await this.addOnlineUserToRedis(username, userToBroadcast);

        // MOVIDO: await this.sendInitialOnlineStatuses(client); (Ahora se llama en setImmediate con datos)

        //  PERFORMANCE LOGGING - Fin (registro base completado)
        console.timeEnd(perfLabel);

        // 🚀 OPTIMIZADO: Enviar lista de usuarios de forma NO BLOQUEANTE
        // Esto permite que handleRegister termine rápido y no bloquee otros registros
        setImmediate(async () => {
            try {
                // 🔥 FIX: Buscar por AMBOS identificadores (DNI y Nombre Completo)
                // porque los participantes pueden estar guardados como DNI o como Nombre
                const resultByDNI = await this.temporaryConversationsService.findAll(username);
                const convsByDNI: any[] = Array.isArray(resultByDNI) ? resultByDNI : (resultByDNI?.data || []);

                let userAssignedConversations = convsByDNI;

                // También buscar por displayName si es diferente al DNI
                if (displayName !== username) {
                    const resultByName = await this.temporaryConversationsService.findAll(displayName);
                    const convsByName: any[] = Array.isArray(resultByName) ? resultByName : (resultByName?.data || []);
                    // Merge y deduplicar por ID
                    const existingIds = new Set(convsByDNI.map(c => c.id));
                    for (const conv of convsByName) {
                        if (!existingIds.has(conv.id)) {
                            userAssignedConversations.push(conv);
                        }
                    }
                }
                console.log(`🔍 [ASSIGNED-FIX] Encontradas ${userAssignedConversations.length} conversaciones (byDNI: ${convsByDNI.length}, total dedup: ${userAssignedConversations.length})`);

                //  CLUSTER FIX: Unir socket a las salas de conversaciones asignadas
                // Esto permite recibir eventos 'typing' si el frontend usa el ID de conversación
                if (userAssignedConversations.length > 0 && client.connected) {
                    for (const conv of userAssignedConversations) {
                        if (conv.id) {
                            await client.join(conv.id.toString());
                        }
                    }
                }

                // Enviar lista solo al usuario que se conectó
                if (client.connected) {
                    await this.sendUserListToSingleUser(client, userData, userAssignedConversations);

                    //  NUEVO: Enviar estados online filtrados (Ahora que tenemos las conversaciones)
                    await this.sendInitialOnlineStatuses(client, username, userAssignedConversations);
                }
            } catch (error) {
                console.error('❌ Error al enviar lista de usuarios al nuevo usuario:', error);
            }
        });
    }

    /**
     * 🚀 OPTIMIZACIÓN: Enviar lista de usuarios a un solo usuario
     * En lugar de broadcast a todos, solo envía al usuario específico
     */
    private async sendUserListToSingleUser(
        socket: Socket,
        userData: any,
        assignedConversations: any[]
    ): Promise<void> {
        // Crear lista de usuarios conectados
        const connectedUsersMap = new Map<string, any>();
        const userListWithData = Array.from(this.users.entries()).map(
            ([username, { userData: ud }]) => {
                const userInfo = {
                    id: ud?.id || null,
                    username: username,
                    nombre: ud?.nombre || null,
                    apellido: ud?.apellido || null,
                    email: ud?.email || null,
                    role: ud?.role || 'USER',
                    picture: ud?.picture || null,
                    sede: ud?.sede || null,
                    sede_id: ud?.sede_id || null,
                    numeroAgente: ud?.numeroAgente || null,
                    isOnline: true,
                };
                connectedUsersMap.set(username, userInfo);
                // 🔥 FIX: También indexar por display name (nombre + apellido)
                // Los participantes de conversaciones se guardan como display name
                if (ud?.nombre || ud?.apellido) {
                    const displayName = `${ud.nombre || ''} ${ud.apellido || ''}`.trim();
                    connectedUsersMap.set(displayName, userInfo);
                }
                return userInfo;
            },
        );

        const isAdmin = userData?.role?.toString().toUpperCase().trim() === 'ADMIN';

        if (isAdmin) {
            // Admin: enviar usuarios paginados
            const pageSize = 50;
            const firstPage = userListWithData.slice(0, pageSize);
            socket.emit('userList', {
                users: firstPage,
                page: 0,
                pageSize: pageSize,
                totalUsers: userListWithData.length,
                hasMore: userListWithData.length > pageSize,
            });
        } else {
            // Usuario normal: enviar solo su info + participantes de conversaciones
            const usersToSend = [];
            const ownUserData = connectedUsersMap.get(userData?.username);
            if (ownUserData) usersToSend.push(ownUserData);

            // 🔥 NUEVO: Agregar usuarios de conversaciones FAVORITAS (aunque no estén asignadas activamente)
            try {
                const favoriteConversations = await this.conversationFavoritesService.getUserFavoritesWithConversationData(userData?.username);
                if (favoriteConversations && favoriteConversations.length > 0) {
                    const currentUserFullName =
                        userData?.nombre && userData?.apellido
                            ? `${userData.nombre} ${userData.apellido}`
                            : userData?.username;

                    for (const conv of favoriteConversations) {
                        if (conv.participants && Array.isArray(conv.participants)) {
                            for (const participantName of conv.participants) {
                                if (participantName !== currentUserFullName) {
                                    if (!usersToSend.some((u) => u.username === participantName)) {
                                        const participantData = connectedUsersMap.get(participantName);
                                        if (participantData) {
                                            usersToSend.push(participantData);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (favError) {
                console.error(`❌ Error obteniendo favoritos para userList individual:`, favError.message);
            }

            socket.emit('userList', { users: usersToSend });
        }
    }

    @SubscribeMessage('requestUserListPage')
    handleRequestUserListPage(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { page: number; pageSize: number },
    ) {
        // console.log(
        //     ` WS: requestUserListPage - P�gina: ${data.page}, Tama�o: ${data.pageSize}`,
        // );

        // Obtener el usuario que hace la petici�n
        let requestingUser = null;
        for (const [username, { socket, userData }] of this.users.entries()) {
            if (socket.id === client.id) {
                requestingUser = { username, userData };
                break;
            }
        }

        if (!requestingUser) {
            // console.log('? Usuario no encontrado');
            return;
        }

        // Verificar que sea admin
        const isAdmin =
            requestingUser.userData?.role &&
            requestingUser.userData.role.toString().toUpperCase().trim() === 'ADMIN';

        if (!isAdmin) {
            // console.log('? Usuario no es admin');
            return;
        }

        // Crear lista de usuarios con toda su informaci�n
        const userListWithData = Array.from(this.users.entries()).map(
            ([username, { userData }]) => ({
                id: userData?.id || null,
                username: username,
                nombre: userData?.nombre || null,
                apellido: userData?.apellido || null,
                email: userData?.email || null,
                role: userData?.role || 'USER',
                picture: userData?.picture || null,
                sede: userData?.sede || null,
                sede_id: userData?.sede_id || null,
                numeroAgente: userData?.numeroAgente || null,
            }),
        );

        // Paginar
        const page = data.page || 0;
        const pageSize = data.pageSize || 10;
        const start = page * pageSize;
        const end = start + pageSize;
        const paginatedUsers = userListWithData.slice(start, end);

        // Enviar p�gina solicitada
        client.emit('userListPage', {
            users: paginatedUsers,
            page: page,
            pageSize: pageSize,
            totalUsers: userListWithData.length,
            hasMore: end < userListWithData.length,
        });
    }

    @SubscribeMessage('updateAssignedConversations')
    async handleUpdateAssignedConversations(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { username: string; assignedConversations: any[] },
    ) {
        // console.log(
        //     `?? WS: updateAssignedConversations - Usuario: ${data.username}`,
        // );

        // Actualizar la lista de usuarios para este usuario espec�fico
        const userConnection = this.users.get(data.username);
        if (userConnection && userConnection.socket.connected) {
            //  CLUSTER FIX: Unir socket a las nuevas salas de conversaciones asignadas
            // Esto asegura que el 'typing' funcione para las nuevas asignaciones
            if (data.assignedConversations && data.assignedConversations.length > 0) {
                const client = userConnection.socket;
                data.assignedConversations.forEach(async (conv) => {
                    if (conv.id) {
                        try {
                            await client.join(conv.id.toString());
                        } catch (e) {
                            console.error(`Error uniendo a sala asignada ${conv.id}:`, e);
                        }
                    }
                });
            }

            // Crear lista de usuarios conectados con toda su información
            const connectedUsersMap = new Map<string, any>();
            Array.from(this.users.entries()).forEach(([uname, { userData }]) => {
                const userInfo = {
                    id: userData?.id || null,
                    username: uname,
                    nombre: userData?.nombre || null,
                    apellido: userData?.apellido || null,
                    email: userData?.email || null,
                    role: userData?.role || 'USER',
                    picture: userData?.picture || null,
                    sede: userData?.sede || null,
                    sede_id: userData?.sede_id || null,
                    numeroAgente: userData?.numeroAgente || null,
                    isOnline: true, // Usuario conectado
                };
                connectedUsersMap.set(uname, userInfo);
                // 🔥 FIX: También indexar por display name (nombre + apellido)
                // Los participantes de conversaciones se guardan como display name
                if (userData?.nombre && userData?.apellido) {
                    const displayName = `${userData.nombre} ${userData.apellido}`;
                    connectedUsersMap.set(displayName, userInfo);
                }
            });

            // Incluir informacin del usuario actual + usuarios de conversaciones asignadas
            const usersToSend = [];

            // Agregar informaci�n del usuario actual
            const ownUserData = connectedUsersMap.get(data.username);
            if (ownUserData) {
                usersToSend.push(ownUserData);
            }

            // Agregar informaci�n de los otros usuarios en las conversaciones asignadas
            if (data.assignedConversations && data.assignedConversations.length > 0) {
                // 🚀 OPTIMIZACIÓN: Recolectar todos los participantes primero
                const participantsToFind: string[] = [];

                for (const conv of data.assignedConversations) {
                    if (conv.participants && Array.isArray(conv.participants)) {
                        for (const participantName of conv.participants) {
                            if (participantName !== data.username) {
                                // Verificar si ya está en la lista o ya lo agregamos
                                if (!usersToSend.some((u) => u.username === participantName) &&
                                    !participantsToFind.includes(participantName)) {

                                    // Primero buscar en usuarios conectados
                                    const participantData = connectedUsersMap.get(participantName);
                                    if (participantData) {
                                        usersToSend.push(participantData);
                                    } else {
                                        // No conectado, agregar para batch query
                                        participantsToFind.push(participantName);
                                    }
                                }
                            }
                        }
                    }
                }

                // 🚀 OPTIMIZACIÓN: UNA sola query para todos los participantes offline
                if (participantsToFind.length > 0) {
                    try {
                        // 🔥 CLUSTER FIX: Obtener Set de usuarios online (incluye Redis)
                        const onlineUsersSet = await this.getOnlineUsersSet();

                        const dbUsers = await this.userRepository
                            .createQueryBuilder('user')
                            .where(
                                'CONCAT(user.nombre, " ", user.apellido) IN (:...names)',
                                { names: participantsToFind },
                            )
                            .orWhere('user.username IN (:...usernames)', {
                                usernames: participantsToFind,
                            })
                            .getMany();

                        // Procesar resultados de batch
                        dbUsers.forEach((dbUser) => {
                            const fullName =
                                dbUser.nombre && dbUser.apellido
                                    ? `${dbUser.nombre} ${dbUser.apellido}`
                                    : dbUser.username;

                            // 🔥 CLUSTER FIX: Verificar estado online usando Set que incluye Redis
                            const isUserConnected = this.isUserOnlineWithSet(fullName, onlineUsersSet) ||
                                this.isUserOnlineWithSet(dbUser.username, onlineUsersSet);

                            usersToSend.push({
                                id: dbUser.id || null,
                                username: fullName,
                                nombre: dbUser.nombre || null,
                                apellido: dbUser.apellido || null,
                                email: dbUser.email || null,
                                role: dbUser.role || 'USER',
                                picture: null,
                                sede: null,
                                sede_id: null,
                                numeroAgente: dbUser.numeroAgente || null,
                                isOnline: isUserConnected,
                            });
                        });
                    } catch (error) {
                        console.error(`❌ Error en batch query de usuarios:`, error);
                    }
                }
            }

            // console.log(
            //     `?? Enviando lista de usuarios a ${data.username}:`,
            //     usersToSend.map(
            //         (u) => `${u.username} (${u.isOnline ? 'online' : 'offline'})`,
            //     ),
            // );
            userConnection.socket.emit('userList', { users: usersToSend });
        }
    }

    @SubscribeMessage('conversationAssigned')
    handleConversationAssigned(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            user1: string;
            user2: string;
            conversationName: string;
            linkId: string;
            assignedConversations?: any[];
        },
    ) {
        // console.log(
        //     `?? WS: conversationAssigned - ${data.conversationName} entre ${data.user1} y ${data.user2}`,
        // );

        // Notificar a ambos usuarios
        const user1Connection = this.users.get(data.user1);
        const user2Connection = this.users.get(data.user2);

        const notificationData = {
            conversationName: data.conversationName,
            linkId: data.linkId,
            otherUser: '',
            message: `Se te ha asignado una conversaci�n: ${data.conversationName}`,
        };

        // 🚀 CLUSTER FIX: Usar server.to() para que pase por Redis Adapter
        this.server.to(data.user1).emit('newConversationAssigned', {
            ...notificationData,
            otherUser: data.user2,
        });

        this.server.to(data.user2).emit('newConversationAssigned', {
            ...notificationData,
            otherUser: data.user1,
        });

        //  NUEVO: Actualizar la lista de usuarios de ambos participantes para que se vean mutuamente
        // Esto asegura que ambos usuarios vean al otro en su lista inmediatamente despu�s de la asignaci�n
        const userListWithData = Array.from(this.users.entries()).map(
            ([username, { userData }]) => {
                // Calcular el nombre completo para comparaci�n
                const fullName =
                    userData?.nombre && userData?.apellido
                        ? `${userData.nombre} ${userData.apellido}`
                        : username;

                return {
                    id: userData?.id || null,
                    username: username,
                    fullName: fullName, // Agregar fullName para comparaci�n
                    nombre: userData?.nombre || null,
                    apellido: userData?.apellido || null,
                    email: userData?.email || null,
                    role: userData?.role || 'USER',
                    picture: userData?.picture || null,
                    sede: userData?.sede || null,
                    sede_id: userData?.sede_id || null,
                    numeroAgente: userData?.numeroAgente || null,
                };
            },
        );

        // Actualizar lista de user1 para incluir a user2
        if (user1Connection && user1Connection.socket.connected) {
            const isAdmin =
                user1Connection.userData?.role?.toString().toUpperCase().trim() ===
                'ADMIN';

            if (!isAdmin) {
                // Para usuarios no admin, enviar lista actualizada con el otro participante
                const usersToSend = [];

                // Agregar informaci�n del usuario actual (buscar por username o fullName)
                const ownUserData = userListWithData.find(
                    (u) => u.username === data.user1 || u.fullName === data.user1,
                );
                if (ownUserData) {
                    // Remover fullName antes de enviar
                    const { fullName: _fullName1, ...userDataToSend } = ownUserData;
                    usersToSend.push(userDataToSend);
                }

                // Agregar informaci�n del otro participante (buscar por username o fullName)
                const user2Data = userListWithData.find(
                    (u) => u.username === data.user2 || u.fullName === data.user2,
                );
                if (user2Data) {
                    // Remover fullName antes de enviar
                    const { fullName: _fullName2, ...userDataToSend } = user2Data;
                    usersToSend.push(userDataToSend);
                }

                // console.log(
                //     `?? Actualizando lista de usuarios para ${data.user1}:`,
                //     usersToSend.map((u) => u.username),
                // );
                user1Connection.socket.emit('userList', { users: usersToSend });
            }
        }

        // Actualizar lista de user2 para incluir a user1
        if (user2Connection && user2Connection.socket.connected) {
            const isAdmin =
                user2Connection.userData?.role?.toString().toUpperCase().trim() ===
                'ADMIN';

            if (!isAdmin) {
                // Para usuarios no admin, enviar lista actualizada con el otro participante
                const usersToSend = [];

                // Agregar informaci�n del usuario actual (buscar por username o fullName)
                const ownUserData = userListWithData.find(
                    (u) => u.username === data.user2 || u.fullName === data.user2,
                );
                if (ownUserData) {
                    // Remover fullName antes de enviar
                    const { fullName: _fullName3, ...userDataToSend } = ownUserData;
                    usersToSend.push(userDataToSend);
                }

                // Agregar informaci�n del otro participante (buscar por username o fullName)
                const user1Data = userListWithData.find(
                    (u) => u.username === data.user1 || u.fullName === data.user1,
                );
                if (user1Data) {
                    // Remover fullName antes de enviar
                    const { fullName: _fullName4, ...userDataToSend } = user1Data;
                    usersToSend.push(userDataToSend);
                }

                // console.log(
                //     `?? Actualizando lista de usuarios para ${data.user2}:`,
                //     usersToSend.map((u) => u.username),
                // );
                user2Connection.socket.emit('userList', { users: usersToSend });
            }
        }
    }

    @SubscribeMessage('conversationRemoved')
    handleConversationRemoved(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            conversationId: number;
            conversationName: string;
            participants: string[];
        },
    ) {
        // console.log(
        //     `??? WS: conversationRemoved - ID: ${data.conversationId}, Name: ${data.conversationName}, Participants: ${data.participants?.length || 0}`,
        // );

        // Notificar a todos los participantes
        // 🚀 CLUSTER FIX: Usar server.to() para que pase por Redis Adapter
        const participants = data.participants || [];
        participants.forEach((participantName) => {
            this.server.to(participantName).emit('conversationRemoved', {
                conversationId: data.conversationId,
                conversationName: data.conversationName,
            });
        });
    }

    @SubscribeMessage('conversationUpdated')
    handleConversationUpdated(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            participants: string[];
            conversationName: string;
            conversationId: string;
        },
    ) {
        // console.log(
        //     `?? WS: conversationUpdated - ${data.conversationName} (ID: ${data.conversationId})`,
        // );

        // Notificar a todos los participantes que la conversación fue actualizada
        // 🚀 CLUSTER FIX: Usar server.to() para que pase por Redis Adapter
        if (data.participants && Array.isArray(data.participants)) {
            data.participants.forEach((participantName) => {
                this.server.to(participantName).emit('conversationDataUpdated', {
                    conversationId: data.conversationId,
                    conversationName: data.conversationName,
                    message: `La conversación "${data.conversationName}" ha sido actualizada`,
                });
            });
        }

        // Tambi�n notificar a todos los ADMIN
        // ?? OPTIMIZADO: Usar adminUsers en lugar de iterar todos los usuarios
        this.adminUsers.forEach(({ socket }) => {
            if (socket.connected) {
                socket.emit('conversationDataUpdated', {
                    conversationId: data.conversationId,
                    conversationName: data.conversationName,
                    message: `La conversaci�n "${data.conversationName}" ha sido actualizada`,
                });
            }
        });
    }

    @SubscribeMessage('typing')
    async handleTyping(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: { from: string; to: string; isTyping: boolean; roomCode?: string },
    ) {
        const now = Date.now();

        // Clave única por usuario y sala o chat
        const throttleKey = data.roomCode
            ? `${data.from}:${data.roomCode}`
            : `${data.from}:${data.to}`;

        const lastSent = this.typingThrottle.get(throttleKey) || 0;

        // ⛔️ Si han pasado menos de 500 ms desde el último envío → IGNORAR
        if (now - lastSent < 500) {
            return;
        }

        // Actualizar momento del último envío
        this.typingThrottle.set(throttleKey, now);

        // 🔥 FIX: Obtener el NOMBRE COMPLETO para mostrar en lugar del DNI
        let fromName = data.from;
        const senderData = await this.getSenderData(data.from);
        if (senderData?.fullName) {
            fromName = senderData.fullName;
        }

        // ----------------------------------------
        // Lógica optimizada para Cluster (Redis Adapter)
        // ----------------------------------------

        if (data.roomCode) {
            // Broadcast a la sala de grupo (gestionada por Redis)
            this.server.to(data.roomCode).emit('roomTyping', {
                from: fromName,
                roomCode: data.roomCode,
                isTyping: data.isTyping,
            });
            // console.log(`⌨️ Typing broadcast a sala ${data.roomCode}`);
        } else {
            //  CLUSTER FIX: Broadcast dirigido al usuario (gestionado por Redis)
            // Enviar a variantes normalizadas también para asegurar entrega
            const targetRooms = [data.to, data.to?.toLowerCase?.()].filter(Boolean);

            console.log(`⌨️ Typing broadcast a salas: ${JSON.stringify(targetRooms)}, from: ${fromName}, isTyping: ${data.isTyping}`);

            for (const room of targetRooms) {
                this.server.to(room).emit('userTyping', {
                    from: fromName,
                    to: data.to,  //  FIX: Incluir 'to' para que el frontend valide correctamente
                    isTyping: data.isTyping,
                });
            }
        }
    }


    @SubscribeMessage('message')
    async handleMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: any,
    ) {
        //  PERFORMANCE LOGGING - Diagnosticar picos de CPU
        const msgPerfLabel = `⏱️ handleMessage [${data.isGroup ? 'GROUP' : 'DM'}:${data.from}]`;
        console.time(msgPerfLabel);

        // ?? NUEVO: Verificar si es un mensaje duplicado
        // 🚀 FIX: Si viene con ID, confiamos en que es único (del frontend) y saltamos check
        if (!data.id && this.isDuplicateMessage(data)) {
            console.timeEnd(msgPerfLabel);
            return; // Ignorar el mensaje duplicado
        }

        //  FIX: Ignorar mensajes de hilo - se manejan en handleThreadMessage
        if (data.threadId) {
            console.log(`⚠️ handleMessage: Ignorando mensaje con threadId=${data.threadId} (debe usar handleThreadMessage)`);
            console.timeEnd(msgPerfLabel);
            return;
        }

        // Log removido para optimización - datos del mensaje

        const {
            to,
            message,
            isGroup,
            time,
            from,
            mediaType,
            mediaData,
            fileName,
            fileSize,
            replyToMessageId,
            replyToSender,
            replyToText,
            roomCode: messageRoomCode, //  roomCode del mensaje (si viene del frontend)
        } = data;

        //  Obtener información del remitente (role y numeroAgente)
        const senderData = await this.getSenderData(from);
        const resolvedFrom = senderData?.username || from; // Si resolvemos a DNI, lo usamos para consistencia
        const senderFullName = senderData?.fullName || from;
        const senderRole = senderData?.role || null;
        const senderNumeroAgente = senderData?.numeroAgente || null;

        //  CRÍTICO: Determinar el roomCode ANTES de guardar en BD
        const user = this.users.get(resolvedFrom); // Usar DNI resuelto para lookup local
        const finalRoomCode = messageRoomCode || user?.currentRoom;

        // 🚀 OPTIMIZACIÓN: GUARDADO NO BLOQUEANTE
        // Generar datos del mensaje INMEDIATAMENTE sin esperar BD
        const peruDate = getPeruDate();
        const calculatedTime = formatPeruTime(peruDate);

        // 🚀 ID temporal para emisión inmediata (se actualizará cuando BD responda)
        const tempId = data.id || `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Mensaje "optimista" para emisión inmediata
        const optimisticMessage = {
            ...data,
            from: senderFullName, // 🔥 Usar Nombre Completo para consistencia real-time (para el frontend)
            id: tempId,
            sentAt: data.sentAt || peruDate,
            time: data.time || calculatedTime,
            senderRole,
            senderNumeroAgente,
            roomCode: finalRoomCode,
        };

        //  PERFORMANCE LOGGING - Fin de parte crítica (preparación)
        console.timeEnd(msgPerfLabel);

        // 🚀 GUARDADO EN BD EN PARALELO (no bloquea la emisión)
        // Solo si no tiene ID real (no guardado por frontend)
        if (!data.id) {
            // Guardar en background sin await - USAR DNI resuelto para la base de datos
            this.saveMessageInBackground(data, finalRoomCode, senderRole, senderNumeroAgente, tempId, resolvedFrom);
        }

        // 🚀 OPTIMIZADO: Broadcast INMEDIATO (sin esperar BD)
        // Capturar variables necesarias para el closure
        const msgContext = { savedMessage: optimisticMessage, isGroup, to, from: resolvedFrom, message, time: calculatedTime, mediaType, mediaData, fileName, fileSize, replyToMessageId, replyToSender, replyToText, senderRole, senderNumeroAgente, finalRoomCode, data };

        setImmediate(async () => {
            try {
                if (msgContext.isGroup) {
                    console.log(`📡 [DEBUG] Procesando mensaje de GRUPO - De: ${from}, Para: ${to}, roomCode: ${finalRoomCode}`);
                    // console.log(`?? Procesando mensaje de GRUPO`);

                    if (finalRoomCode) {
                        // Es una sala temporal
                        let roomUsers = this.roomUsers.get(finalRoomCode);
                        // console.log(
                        //     `🔔 Enviando a sala temporal: ${finalRoomCode}, Miembros en memoria: ${roomUsers?.size || 0}`,
                        // );

                        // 🚀 CLUSTER FIX: SIEMPRE obtener miembros de la BD/caché
                        // Los usuarios locales (this.users) solo representan conexiones de ESTE nodo
                        // En un cluster, los usuarios pueden estar en otros nodos
                        const room = await this.getCachedRoom(finalRoomCode);
                        if (room && room.connectedMembers && room.connectedMembers.length > 0) {
                            // 🚀 CLUSTER FIX: Usar TODOS los miembros de la BD, NO filtrar por conexión local

                            // 🔥 MEJORADO: Incluir tanto miembros conectados como miembros históricos (aprobados)
                            // para asegurar que todos reciban el mensaje/notificación
                            const allMembers = Array.from(new Set([
                                ...(room.members || []),
                                ...(room.connectedMembers || []),
                                ...(room.assignedMembers || [])
                            ]));

                            roomUsers = new Set([
                                ...(roomUsers ? Array.from(roomUsers) : []),
                                ...allMembers, // 🔥 NO filtrar por this.users.has()
                            ]);

                            console.log(`👥 [handleMessage] Sala ${finalRoomCode}: ${allMembers.length} miembros totales para broadcast`);
                            // console.log(`🔔 CLUSTER FIX: roomUsers actualizado desde BD: ${roomUsers.size} miembros`);
                        }

                        if (roomUsers && roomUsers.size > 0) {
                            // console.log(
                            //     `?? Lista completa de usuarios en sala ${finalRoomCode}:`,
                            //     Array.from(roomUsers),
                            // );

                            // ?? OPTIMIZADO: Detectar menciones usando m�todo helper con regex precompilado
                            const mentions = this.detectMentions(message);
                            // console.log(`?? Menciones detectadas en mensaje:`, mentions);

                            // 🔥 FIX: Obtener nombre de la sala para mostrar en toast del frontend
                            const cachedRoom = await this.getCachedRoom(finalRoomCode);
                            const roomName = cachedRoom?.name || to; // Fallback al destinatario si no hay nombre

                            // 🚀 OPTIMIZADO: Crear objeto base UNA vez fuera del loop (reduce allocations)
                            const baseGroupMessage = {
                                id: msgContext.savedMessage?.id,
                                from: from || 'Usuario Desconocido',
                                senderRole,
                                senderNumeroAgente,
                                group: to,
                                groupName: to,
                                roomCode: finalRoomCode,
                                roomName, // 🔥 NUEVO: Nombre real de la sala para mostrar en toast
                                message,
                                isGroup: true,
                                time: time || formatPeruTime(),
                                sentAt: msgContext.savedMessage?.sentAt,
                                mediaType,
                                mediaData,
                                fileName,
                                fileSize,
                                replyToMessageId,
                                replyToSender,
                                replyToText,
                                type: data.type,
                                videoCallUrl: data.videoCallUrl,
                                videoRoomID: data.videoRoomID,
                                metadata: data.metadata,
                                attachments: data.attachments, // 🔥 NUEVO: Enviar adjuntos en tiempo real
                            };

                            // 🚀 CLUSTER FIX: Broadcast global a la sala vía Redis
                            // Mantenemos esto para que los que están en la sala vean el mensaje al instante
                            this.server.to(finalRoomCode).emit('message', {
                                ...baseGroupMessage,
                                hasMention: false,
                                mentions: mentions
                            });

                            // 🚀 CLUSTER FIX: Notificaciones individuales y Menciones
                            roomUsers.forEach((member) => {
                                if (member !== from) {
                                    const memberUser = this.users.get(member);
                                    const isViewingThisRoom = memberUser?.currentRoom === finalRoomCode;

                                    //  NUEVO: Calcular mención específica para este miembro
                                    const isMentioned = mentions.some(
                                        (mention) => {
                                            const normalizedMention = mention.toUpperCase().trim();

                                            // 1. Match Directo por DNI/Username
                                            if (member.toUpperCase().includes(normalizedMention) || normalizedMention.includes(member.toUpperCase())) {
                                                return true;
                                            }

                                            // 2. Match por Nombre Profesional
                                            if (memberUser?.userData) {
                                                const { nombre, apellido } = memberUser.userData;
                                                const fullName = `${nombre || ''} ${apellido || ''}`.toUpperCase().trim();
                                                if (fullName.includes(normalizedMention) || normalizedMention.includes(fullName)) {
                                                    return true;
                                                }
                                            }
                                            return false;
                                        }
                                    );

                                    // Si NO está viendo la sala, o si hay una mención (para asegurar alerta), enviar mensaje individual
                                    if (!isViewingThisRoom || isMentioned) {
                                        this.server.to(member).emit('message', {
                                            ...baseGroupMessage,
                                            hasMention: isMentioned,
                                            mentions: mentions
                                        });
                                    }

                                    const lastMessageData = {
                                        text: message,
                                        from: from,
                                        time: time || formatPeruTime(),
                                        sentAt: msgContext.savedMessage?.sentAt || new Date().toISOString(),
                                        mediaType,
                                        fileName,
                                    };

                                    const shouldIncrement = !isViewingThisRoom;
                                    this.emitUnreadCountUpdateForUser(
                                        finalRoomCode,
                                        member,
                                        shouldIncrement ? 1 : 0,
                                        lastMessageData,
                                    );
                                }
                            });
                        } else {
                            //  NUEVO: Log cuando no hay usuarios en la sala
                            // console.warn(`?? No hay usuarios en la sala ${finalRoomCode}`);
                        }
                    } else {
                        // Es un grupo normal
                        const group = this.groups.get(to);
                        // console.log(
                        //     `?? Enviando a grupo normal: ${to}, Miembros: ${group?.size || 0}`,
                        // );
                        if (group) {
                            //  Obtener el roomCode del grupo (buscar en roomUsers)
                            let groupRoomCode = null;
                            for (const [code, users] of this.roomUsers.entries()) {
                                if (users.has(from)) {
                                    groupRoomCode = code;
                                    break;
                                }
                            }

                            // ?? OPTIMIZADO: Detectar menciones usando mtodo helper con regex precompilado
                            const mentions = this.detectMentions(message);
                            // console.log(`?? Menciones detectadas en mensaje de grupo:`, mentions);

                            const groupMembers = Array.from(group);

                            // 🚀 CROSS-CHAT FIX: Desactivar broadcast por roomCode "adivinada".
                            // Forzamos el envío individual (Fallback) para asegurar que solo los miembros
                            // REALES del grupo reciban el mensaje, evitando cruces de salas.
                            if (false && groupRoomCode) {
                                // 🚀 CLUSTER FIX: Broadcast optimizado si tenemos roomCode
                                this.server.to(groupRoomCode).emit('message', {
                                    id: msgContext.savedMessage?.id,
                                    from: senderFullName || 'Usuario Desconocido',
                                    senderRole,
                                    senderNumeroAgente,
                                    group: to,
                                    groupName: to,
                                    roomCode: groupRoomCode,
                                    message,
                                    isGroup: true,
                                    time: time || formatPeruTime(),
                                    sentAt: msgContext.savedMessage?.sentAt,
                                    mediaType,
                                    mediaData,
                                    fileName,
                                    fileSize,
                                    replyToMessageId,
                                    replyToSender,
                                    replyToText,
                                    hasMention: false, // Simplificado para broadcast
                                    mentions: mentions, // Para que el cliente procese
                                    type: data.type, // Campos de videollamada
                                    videoCallUrl: data.videoCallUrl,
                                    videoRoomID: data.videoRoomID,
                                    metadata: data.metadata,
                                    attachments: data.attachments, // 🔥 NUEVO: Enviar adjuntos en tiempo real
                                });
                                // console.log(`🚀 DEBUG: Mensaje enviado a sala ${groupRoomCode} (Redis Broadcast)`);
                            } else {
                                // Fallback: Iterar miembros usando comunicación directa (Redis friendly)
                                groupMembers.forEach((member) => {
                                    const isMentioned = mentions.some(
                                        (mention) => {
                                            const normalizedMention = mention.toUpperCase().trim();
                                            const memberLower = member.toLowerCase().trim();

                                            // 1. Match Directo por DNI/Username
                                            if (member.toUpperCase().includes(normalizedMention) || normalizedMention.includes(member.toUpperCase())) {
                                                return true;
                                            }

                                            // 2. Match por Nombre Profesional (desde memoria local)
                                            const memberUser = this.users.get(member);
                                            if (memberUser?.userData) {
                                                const { nombre, apellido } = memberUser.userData;
                                                const fullName = `${nombre || ''} ${apellido || ''}`.toUpperCase().trim();
                                                if (fullName.includes(normalizedMention) || normalizedMention.includes(fullName)) {
                                                    return true;
                                                }
                                            }

                                            return false;
                                        }
                                    );

                                    // Usar broadcast dirigido a la sala del usuario (client.join(username))
                                    this.server.to(member).emit('message', {
                                        id: msgContext.savedMessage?.id,
                                        from: senderFullName || 'Usuario Desconocido',
                                        senderRole,
                                        senderNumeroAgente,
                                        group: to,
                                        groupName: to,
                                        roomName: to, // 🔥 AGREGADO: Para alerts de SweetAlert
                                        roomCode: groupRoomCode,
                                        message,
                                        isGroup: true,
                                        time: time || formatPeruTime(),
                                        sentAt: msgContext.savedMessage?.sentAt,
                                        mediaType,
                                        mediaData,
                                        fileName,
                                        fileSize,
                                        replyToMessageId,
                                        replyToSender,
                                        replyToText,
                                        hasMention: isMentioned,
                                        type: data.type,
                                        videoCallUrl: data.videoCallUrl,
                                        videoRoomID: data.videoRoomID,
                                        metadata: data.metadata,
                                        attachments: data.attachments, // 🔥 NUEVO: Enviar adjuntos en tiempo real
                                    });
                                });
                            }
                        }
                    }
                } else {
                    console.log(`🚀 DEBUG: Procesando mensaje INDIVIDUAL (1-a-1)`);
                    // Mensaje individual
                    let recipientUsername = to;

                    // Si es una conversación asignada, obtener el destinatario real
                    if (data.isAssignedConversation && data.actualRecipient) {
                        recipientUsername = data.actualRecipient;
                        console.log(
                            `🚀 DEBUG: Conversación asignada detectada. Destinatario real: ${recipientUsername}`,
                        );
                    }

                    // 🛡️ SECURITY FIX: Validar que exista un destinatario
                    if (!recipientUsername) {
                        console.warn(`⚠️ handleMessage: Mensaje ignorado - Sin destinatario (to: ${to})`);
                        return;
                    }

                    // ?? OPTIMIZADO: Búsqueda case-insensitive rápida usando índice (O(1) en lugar de O(n))
                    const recipient = this.getUserCaseInsensitive(recipientUsername);
                    console.log(`🚀 DEBUG: Destinatario ${recipientUsername} encontrado? ${!!recipient} - Conectado? ${recipient?.socket?.connected}`);

                    // Preparar el objeto del mensaje para enviar
                    const messageToSend = {
                        id: msgContext.savedMessage?.id, // Incluir ID del mensaje guardado en BD
                        from: senderFullName || 'Usuario Desconocido',
                        senderRole, // Incluir role del remitente
                        senderNumeroAgente, // Incluir numeroAgente del remitente
                        to: recipientUsername,
                        message,
                        isGroup: false,
                        time: time || formatPeruTime(),
                        sentAt: msgContext.savedMessage?.sentAt, //  Incluir sentAt para extraer hora correcta en frontend
                        mediaType,
                        mediaData,
                        fileName,
                        fileSize,
                        replyToMessageId,
                        replyToSender,
                        replyToText,
                        conversationId: msgContext.savedMessage?.conversationId, //  Incluir conversationId para chats asignados
                        //  NUEVO: Campos de videollamada
                        type: data.type,
                        videoCallUrl: data.videoCallUrl,
                        videoRoomID: data.videoRoomID,
                        metadata: data.metadata,
                        attachments: data.attachments, // 🔥 NUEVO: Enviar adjuntos en tiempo real
                    };

                    //  Enviar mensaje al destinatario
                    // 🚀 CLUSTER FIX: Usar Redis Broadcast (server.to) en lugar de socket directo
                    // Esto permite alcanzar usuarios conectados en OTROS nodos/clusters
                    try {
                        this.server.to(recipientUsername).emit('message', messageToSend);
                        console.log(`🚀 DEBUG: Mensaje enviado a ${recipientUsername} vía Redis Broadcast`);
                    } catch (emitError) {
                        console.error(`❌ Error crítico al enviar mensaje a ${recipientUsername}:`, emitError);
                        // No repulsar el error para evitar desconexión del remitente
                    }

                    // ?? NUEVO: Enviar mensaje de vuelta al remitente para que vea su propio mensaje
                    const sender = this.users.get(from);
                    if (sender && sender.socket.connected) {
                        // console.log(
                        //     `? Enviando confirmaci�n de mensaje al remitente: ${from}`,
                        // );
                        sender.socket.emit('message', messageToSend);
                    }

                    //  Emitir evento de monitoreo a todos los ADMIN/JEFEPISO
                    this.broadcastMonitoringMessage({
                        id: msgContext.savedMessage?.id,
                        from: senderFullName || 'Usuario Desconocido',
                        to: recipientUsername,
                        message,
                        isGroup: false,
                        time: time || formatPeruTime(),
                        sentAt: msgContext.savedMessage?.sentAt, //  Incluir sentAt para extraer hora correcta en frontend
                        mediaType,
                        mediaData,
                        fileName,
                        fileSize,
                        senderRole,
                        senderNumeroAgente,
                        replyToMessageId,
                        replyToSender,
                        replyToText,
                        attachments: data.attachments, // 🔥 NUEVO: Enviar adjuntos en tiempo real
                    });

                    // assignedConversationUpdated se emite en saveMessageInBackground()
                    // para evitar duplicación y para incluir el messageId real de BD

                }
            } catch (broadcastError) {
                console.error('❌ Error en broadcast de mensaje:', broadcastError);
            }
        }); // Fin de setImmediate
    }

    // 🚀 NUEVO: Guardado en background (no bloqueante)
    // Guarda el mensaje en BD sin bloquear la emisión al usuario
    private saveMessageInBackground(
        data: any,
        finalRoomCode: string,
        senderRole: string,
        senderNumeroAgente: string,
        tempId: string,
        from: string
    ): void {
        // Ejecutar en el siguiente tick del event loop
        setImmediate(async () => {
            const bgPerfLabel = `🔄 saveMessageInBackground [${tempId}]`;
            console.time(bgPerfLabel);

            try {
                const savedMessage = await this.saveMessageToDatabase({
                    ...data,
                    roomCode: finalRoomCode,
                    senderRole,
                    senderNumeroAgente,
                });

                if (savedMessage) {
                    // 🚀 Emitir actualización con ID real para sincronización
                    // Solo si el ID temporal era diferente al real
                    if (tempId !== savedMessage.id?.toString()) {
                        const updatePayload = {
                            tempId,
                            realId: savedMessage.id,
                            roomCode: finalRoomCode,
                        };

                        // Notificar a la sala para que actualicen el ID temporal
                        if (data.isGroup && finalRoomCode) {
                            this.server.to(finalRoomCode).emit('messageIdUpdate', updatePayload);
                        }
                    }

                    // 🔥 NUEVO: Emitir assignedConversationUpdated con ID real si es chat asignado
                    // Esto asegura que el evento se emita incluso si el mensaje se guardó en background
                    if (savedMessage.conversationId && !data.isGroup) {
                        let messageText = data.message;
                        if (!messageText && data.mediaType) {
                            if (data.mediaType === 'image') messageText = '📷 Imagen';
                            else if (data.mediaType === 'video') messageText = '🎥 Video';
                            else if (data.mediaType === 'audio') messageText = '🎵 Audio';
                            else if (data.mediaType === 'document') messageText = '📄 Documento';
                            else messageText = '📎 Archivo';
                        } else if (!messageText && data.fileName) {
                            messageText = '📎 Archivo';
                        }

                        const conversationUpdateData = {
                            conversationId: savedMessage.conversationId,
                            lastMessage: messageText,
                            lastMessageTime: savedMessage.sentAt || new Date().toISOString(),
                            lastMessageFrom: from,
                            lastMessageMediaType: data.mediaType,
                            messageId: savedMessage.id // Incluir ID real del mensaje
                        };

                        // Emitir a ambos participantes (a todas sus variantes DNI/Nombre)
                        const recipientUsername = data.actualRecipient || data.to;
                        const participants = [from, recipientUsername].filter(Boolean);

                        for (const participantName of participants) {
                            const identifiers = await this.getUserIdentifiersArray(participantName);
                            identifiers.forEach(identifier => {
                                this.server.to(identifier).emit('assignedConversationUpdated', conversationUpdateData);
                            });
                        }
                    }

                    // 🚀 Si es encuesta, crearla después de guardar
                    if (data.isPoll && data.poll) {
                        try {
                            await this.pollsService.createPoll(
                                {
                                    question: data.poll.question,
                                    options: data.poll.options,
                                },
                                savedMessage.id,
                                from,
                            );
                        } catch (pollError) {
                            console.error('❌ Error al crear encuesta:', pollError);
                        }
                    }
                }

                console.timeEnd(bgPerfLabel);
            } catch (error) {
                console.error(`❌ Error en saveMessageInBackground:`, error);
                console.timeEnd(bgPerfLabel);
            }
        });
    }

    private async saveMessageToDatabase(data: any) {
        const {
            to,
            message,
            isGroup,
            from,
            fromId,
            senderRole, //  Extraer role del remitente
            senderNumeroAgente, //  Extraer numeroAgente del remitente
            roomCode, //  CRÍTICO: Extraer roomCode del data
            groupName, //  NUEVO: Extraer explícitamente el nombre del grupo
            mediaType,
            mediaData,
            fileName,
            fileSize,
            replyToMessageId,
            replyToSender,
            replyToText,
            isAssignedConversation,
            actualRecipient,
            //  NUEVO: Campos de videollamada
            type,
            videoCallUrl,
            videoRoomID,
            metadata,
            attachments, // 🔥 NUEVO: Extraer lista de adjuntos
        } = data;

        try {
            // Si es una conversaci�n asignada, usar el destinatario real
            let recipientForDB = to;
            if (isAssignedConversation && actualRecipient) {
                recipientForDB = actualRecipient;
            }

            // 🔒 SERVER-SIDE fromId RESOLUTION: No confiar en el fromId del cliente
            // Resolver el fromId correcto buscando el usuario en la BD por su username (from)
            let resolvedFromId = fromId; // Fallback al valor del cliente
            try {
                const senderUser = await this.userRepository.findOne({
                    where: { username: from },
                    select: ['id']
                });
                if (senderUser) {
                    if (resolvedFromId !== senderUser.id) {
                        console.warn(`⚠️ fromId MISMATCH detectado: cliente envió fromId=${fromId}, pero el usuario '${from}' tiene id=${senderUser.id}. Usando id correcto.`);
                    }
                    resolvedFromId = senderUser.id;
                } else {
                    console.warn(`⚠️ No se encontró usuario con username='${from}' en BD. Usando fromId del cliente: ${fromId}`);
                }
            } catch (lookupError) {
                console.error(`❌ Error al resolver fromId para '${from}':`, lookupError);
                // Mantener el fromId del cliente como fallback
            }

            // CRÍTICO: Calcular sentAt y time desde el servidor (no confiar en el cliente)
            const peruDate = getPeruDate();
            const calculatedTime = formatPeruTime(peruDate);

            const messageData = {
                from,
                fromId: resolvedFromId, // 🔒 Usar el ID resuelto del servidor, no el del cliente
                senderRole, //  Incluir role del remitente
                senderNumeroAgente, // Incluir numeroAgente del remitente
                to: isGroup ? null : recipientForDB,
                message,
                isGroup,
                groupName: isGroup ? (groupName || to) : null,
                roomCode: isGroup ? (roomCode || this.getRoomCodeFromUser(from)) : null, //  USAR roomCode del data primero
                mediaType,
                mediaData,
                fileName,
                fileSize,
                sentAt: peruDate,
                time: calculatedTime, //  SIEMPRE calcular desde sentAt, no usar el time del cliente
                replyToMessageId,
                replyToSender,
                replyToText,
                // NUEVO: Campos de videollamada
                type,
                videoCallUrl,
                videoRoomID,
                metadata,
                attachments, // 🔥 NUEVO: Pasar adjuntos al servicio para persistencia
            };

            // console.log(`?? Guardando mensaje en BD:`, messageData);
            // console.log(`?? DEBUG - senderNumeroAgente antes de guardar:`, {
            //     senderNumeroAgente,
            //     senderRole,
            //     fromId,
            //     from,
            // });
            const savedMessage = await this.messagesService.create(messageData);
            // console.log(
            //     `? Mensaje guardado exitosamente en BD con ID: ${savedMessage.id}`,
            // );
            return savedMessage; // ?? Retornar el mensaje guardado con su ID
        } catch (error) {
            console.error(`? Error al guardar mensaje en BD:`, error);
            return null;
        }
    }

    @SubscribeMessage('editMessage')
    async handleEditMessage(
        @ConnectedSocket() _client: Socket,
        @MessageBody()
        data: {
            messageId: number;
            username: string;
            newText: string;
            mediaType?: string;
            mediaData?: string;
            fileName?: string;
            fileSize?: number;
            to: string;
            isGroup: boolean;
            roomCode?: string;
        },
    ) {
        // console.log(
        //     `?? WS: editMessage - ID: ${data.messageId}, Usuario: ${data.username} (solo broadcast)`,
        // );

        try {
            // OPTIMIZACI�N: El mensaje ya fue editado en la BD por el endpoint HTTP
            // Solo necesitamos hacer broadcast del evento a los dem�s usuarios
            const editEvent: any = {
                messageId: data.messageId,
                newText: data.newText,
                editedAt: new Date(),
                isEdited: true,
            };

            // Incluir campos multimedia si se proporcionan
            if (data.mediaType !== undefined) editEvent.mediaType = data.mediaType;
            if (data.mediaData !== undefined) editEvent.mediaData = data.mediaData;
            if (data.fileName !== undefined) editEvent.fileName = data.fileName;
            if (data.fileSize !== undefined) editEvent.fileSize = data.fileSize;

            if (data.isGroup && data.roomCode) {
                // 🚀 CLUSTER FIX: Emitir directamente a la sala (gestionado por Redis Adapter)
                // Se envía a todos los que estén en la sala sin importar la instancia.
                this.server.to(data.roomCode).emit('messageEdited', editEvent);
                // console.log(
                //     `🚀 [CLUSTER] Broadcast de edición enviado a sala ${data.roomCode}`,
                // );
            } else {
                // 🚀 CLUSTER FIX: Usar emisión a salas de alias (DNI/Nombre)
                // Enviar al destinatario y al remitente
                this.server.to(data.to).emit('messageEdited', editEvent);
                this.server.to(data.username).emit('messageEdited', editEvent);

                // console.log(
                //     `🚀 [CLUSTER] Notificación de edición enviada a ${data.to} y ${data.username} vía Redis`,
                // );
            }
        } catch (error) {
            console.error('? Error al hacer broadcast de mensaje editado:', error);
        }
    }

    @SubscribeMessage('deleteMessage')
    async handleDeleteMessage(
        @ConnectedSocket() _client: Socket,
        @MessageBody()
        data: {
            messageId: number;
            username: string;
            to: string;
            isGroup: boolean;
            roomCode?: string;
            isAdmin?: boolean;
            deletedBy?: string;
        },
    ) {
        // console.log(
        //     `??? WS: deleteMessage - ID: ${data.messageId}, Usuario: ${data.username}${data.isAdmin ? ' (ADMIN)' : ''}`,
        // );

        try {
            // El mensaje ya fue eliminado en la BD por el endpoint HTTP
            // Solo necesitamos hacer broadcast del evento a los dem�s usuarios
            const deleteEvent: any = {
                messageId: data.messageId,
                isDeleted: true,
                deletedAt: new Date(),
                deletedBy: data.deletedBy || null,
            };

            if (data.isGroup && data.roomCode) {
                // Broadcast a todos los usuarios de la sala
                const roomUsersSet = this.roomUsers.get(data.roomCode);
                if (roomUsersSet) {
                    roomUsersSet.forEach((user) => {
                        const userConnection = this.users.get(user);
                        if (userConnection && userConnection.socket.connected) {
                            userConnection.socket.emit('messageDeleted', deleteEvent);
                        }
                    });
                    // console.log(
                    //     `? Broadcast de eliminaci�n enviado a ${roomUsersSet.size} usuarios en sala ${data.roomCode}`,
                    // );
                }
            } else {
                // Enviar al destinatario individual
                const recipient = this.users.get(data.to);
                if (recipient && recipient.socket.connected) {
                    recipient.socket.emit('messageDeleted', deleteEvent);
                }
                // Tambi�n enviar al remitente para sincronizar
                const sender = this.users.get(data.username);
                if (sender && sender.socket.connected) {
                    sender.socket.emit('messageDeleted', deleteEvent);
                }
                // console.log(
                //     `? Notificaci�n de eliminaci�n enviada a ${data.to} y ${data.username}`,
                // );
            }
        } catch (error) {
            console.error('? Error al hacer broadcast de mensaje eliminado:', error);
        }
    }

    @SubscribeMessage('createGroup')
    async handleCreateGroup(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { groupName: string; members: string[]; from: string },
    ) {
        // console.log(`?? WS: createGroup - Grupo: ${data.groupName}`);
        const groupMembers = new Set(data.members);
        groupMembers.add(data.from || 'Usuario');
        this.groups.set(data.groupName, groupMembers);

        // ?? NUEVO: Persistir grupo en BD como sala temporal
        try {
            const createRoomDto = {
                name: data.groupName,
                maxCapacity: data.members.length + 10,
                creatorUsername: data.from,
            };

            await this.temporaryRoomsService.create(
                createRoomDto,
                1, // userId por defecto
                data.from,
            );
            // console.log(`? Grupo "${data.groupName}" persistido en BD`);
        } catch (error) {
            console.error(`? Error al persistir grupo en BD:`, error);
        }

        this.broadcastGroupList();
    }

    @SubscribeMessage('joinGroup')
    async handleJoinGroup(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { groupName: string; from: string },
    ) {
        // console.log(
        //     `? WS: joinGroup - Usuario: ${data.from}, Grupo: ${data.groupName}`,
        // );
        const groupToJoin = this.groups.get(data.groupName);
        if (groupToJoin) {
            groupToJoin.add(data.from || 'Usuario');

            // ?? NUEVO: Sincronizar cambios en BD
            try {
                const room = await this.temporaryRoomsService.findByName(
                    data.groupName,
                );
                if (room) {
                    const updatedMembers = Array.from(groupToJoin);
                    await this.temporaryRoomsService.updateRoomMembers(room.id, {
                        members: updatedMembers,
                        currentMembers: updatedMembers.length,
                    } as any);
                    // console.log(`? Grupo "${data.groupName}" actualizado en BD`);
                }
            } catch (error) {
                console.error(`? Error al actualizar grupo en BD:`, error);
            }

            this.broadcastGroupList();
        }
    }

    @SubscribeMessage('leaveGroup')
    async handleLeaveGroup(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { groupName: string; from: string },
    ) {
        // console.log(
        //     `? WS: leaveGroup - Usuario: ${data.from}, Grupo: ${data.groupName}`,
        // );
        const groupToLeave = this.groups.get(data.groupName);
        if (groupToLeave) {
            groupToLeave.delete(data.from || 'Usuario');

            // ?? NUEVO: Sincronizar cambios en BD
            try {
                const room = await this.temporaryRoomsService.findByName(
                    data.groupName,
                );
                if (room) {
                    const updatedMembers = Array.from(groupToLeave);
                    await this.temporaryRoomsService.updateRoomMembers(room.id, {
                        members: updatedMembers,
                        currentMembers: updatedMembers.length,
                    } as any);
                    // console.log(`? Grupo "${data.groupName}" actualizado en BD`);
                }
            } catch (error) {
                console.error(`? Error al actualizar grupo en BD:`, error);
            }

            this.broadcastGroupList();
        }
    }

    @SubscribeMessage('createTemporaryLink')
    handleCreateTemporaryLink(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            linkType: string;
            participants: string[];
            roomName?: string;
            from: string;
        },
    ) {
        // console.log(
        //     `?? WS: createTemporaryLink - Tipo: ${data.linkType}, De: ${data.from}`,
        // );
        const linkId = this.generateTemporaryLink(
            data.linkType,
            data.participants,
            data.from,
        );
        //const linkUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/#/join/${linkId}`;
        const linkUrl = `${process.env.FRONTEND_URL || 'https://chat.mass34.com'}/#/join/${linkId}`;

        client.emit('temporaryLinkCreated', {
            linkId,
            linkUrl,
            linkType: data.linkType,
            participants: data.participants || [],
            roomName: data.roomName || null,
        });
    }

    @SubscribeMessage('joinTemporaryLink')
    handleJoinTemporaryLink(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { linkId: string; from: string },
    ) {
        const { linkId, from } = data;
        const link = this.temporaryLinks.get(linkId);

        if (link && link.isActive) {
            if (link.type === 'conversation') {
                const groupName = `Conversaci�n Temporal ${linkId.substring(0, 8)}`;
                const tempGroup = new Set<string>(
                    (link.participants || []) as string[],
                );
                tempGroup.add(from || 'Usuario');
                this.groups.set(groupName, tempGroup);

                client.emit('joinedTemporaryConversation', {
                    groupName,
                    participants: Array.from(tempGroup),
                });

                this.broadcastGroupList();
            } else if (link.type === 'room') {
                client.emit('joinedTemporaryRoom', {
                    roomName: link.roomName || 'Sala Temporal',
                });
            }
        } else {
            client.emit('error', {
                message: 'Enlace temporal no v�lido o expirado',
            });
        }
    }

    @SubscribeMessage('joinRoom')
    async handleJoinRoom(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomCode: string;
            roomName: string;
            from: string;
            isMonitoring?: boolean;
        },
    ) {
        // console.log(
        //     `?? WS: joinRoom - Usuario: ${data.from}, Sala: ${data.roomCode}, Monitoreo: ${data.isMonitoring || false}`,
        // );

        //  Si es monitoreo (ADMIN/JEFEPISO), NO actualizar BD, solo memoria
        if (!data.isMonitoring) {
            try {
                // Actualizar la base de datos usando el servicio
                const joinDto = { roomCode: data.roomCode, username: data.from };
                await this.temporaryRoomsService.joinRoom(joinDto, data.from);
                // console.log(`? Usuario ${data.from} unido a sala en BD`);
            } catch (error) {
                // NUEVO: Notificar al cliente del error
                console.error(
                    `? Error al unir usuario ${data.from} a sala en BD:`,
                    error,
                );
                client.emit('joinRoomError', {
                    roomCode: data.roomCode,
                    message: error.message || 'Error al unirse a la sala',
                });
                return; // No continuar si falla en BD
            }
        } else {
            // console.log(
            //     `??? Usuario ${data.from} uni�ndose como MONITOR (solo en memoria)`,
            // );
        }

        // Agregar usuario a la sala en memoria
        if (!this.roomUsers.has(data.roomCode)) {
            this.roomUsers.set(data.roomCode, new Set());
        }
        this.roomUsers.get(data.roomCode)!.add(data.from);

        //  CLUSTER FIX: Unir socket a sala Redis para broadcast global
        await client.join(data.roomCode);

        // console.log(`? Usuario ${data.from} agregado a sala en memoria`);

        // Actualizar la sala actual del usuario
        const user = this.users.get(data.from);
        if (user) {
            user.currentRoom = data.roomCode;
            // console.log(`? Sala actual del usuario actualizada a ${data.roomCode}`);
        }

        // Notificar a todos en la sala
        await this.broadcastRoomUsers(data.roomCode);

        // Obtener TODOS los usuarios a�adidos a la sala para roomJoined
        const connectedUsernamesList = Array.from(
            this.roomUsers.get(data.roomCode) || [],
        );

        let allUsernames: string[] = [];
        // NUEVO: Variable para guardar el ID del mensaje fijado
        let currentPinnedMessageId: number | null = null;

        try {
            const room = await this.getCachedRoom(
                data.roomCode,
            );
            // MODIFICADO: Usar TODOS los usuarios a�adidos (members)
            allUsernames = room.members || [];

            //  NUEVO: Capturar el mensaje fijado de la base de datos
            currentPinnedMessageId = room.pinnedMessageId;

        } catch (error) {
            console.error(`? Error al obtener sala ${data.roomCode}:`, error);
            allUsernames = connectedUsernamesList;
        }

        // 🔥 CLUSTER FIX: Obtener Set de usuarios online (incluye Redis)
        const onlineUsersSet = await this.getOnlineUsersSet();

        // Crear lista con TODOS los usuarios añadidos a la sala y su estado de conexión
        const roomUsersList = allUsernames.map((username) => {
            const user = this.users.get(username);
            // 🔥 CLUSTER FIX: Verificar estado online usando Set que incluye Redis
            const isOnline = this.isUserOnlineWithSet(username, onlineUsersSet);
            return {
                id: user?.userData?.id || null,
                username: username,
                picture: user?.userData?.picture || null,
                nombre: user?.userData?.nombre || null,
                apellido: user?.userData?.apellido || null,
                sede: user?.userData?.sede || null,
                sede_id: user?.userData?.sede_id || null,
                isOnline: isOnline,
            };
        });

        // Confirmar al usuario que se uni�
        client.emit('roomJoined', {
            roomCode: data.roomCode,
            roomName: data.roomName,
            users: roomUsersList,
            // NUEVO: Enviar el ID del mensaje fijado al frontend
            pinnedMessageId: currentPinnedMessageId
        });

        // console.log(`? Confirmaci�n enviada a ${data.from}. PinnedMsg: ${currentPinnedMessageId}`);

        // NUEVO: Resetear contador de mensajes no le�dos para este usuario en esta sala
        if (!data.isMonitoring) {
            this.emitUnreadCountReset(data.roomCode, data.from);
        }
    }

    @SubscribeMessage('kickUser')
    async handleKickUser(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: { roomCode: string; username: string; kickedBy: string },
    ) {
        // console.log(
        //     `?? WS: kickUser - Usuario: ${data.username}, Sala: ${data.roomCode}, Expulsado por: ${data.kickedBy}`,
        // );

        // Verificar que quien expulsa sea admin
        const kickerUser = this.users.get(data.kickedBy);
        if (!kickerUser || !kickerUser.userData) {
            // console.log('? Usuario que intenta expulsar no encontrado');
            return;
        }

        const kickerRole = kickerUser.userData.role
            ?.toString()
            .toUpperCase()
            .trim();
        if (kickerRole !== 'ADMIN' && kickerRole !== 'JEFEPISO') {
            // console.log('? Usuario no tiene permisos para expulsar');
            return;
        }

        try {
            // Remover usuario de la base de datos
            await this.temporaryRoomsService.leaveRoom(data.roomCode, data.username);
        } catch (error) {
            console.error('? Error al remover usuario de BD:', error);
        }

        // Remover usuario de la sala en memoria
        const roomUsersSet = this.roomUsers.get(data.roomCode);
        if (roomUsersSet) {
            roomUsersSet.delete(data.username);
        }

        // Notificar al usuario expulsado
        const kickedUser = this.users.get(data.username);
        if (kickedUser && kickedUser.socket) {
            kickedUser.socket.emit('kicked', {
                roomCode: data.roomCode,
                message: `Has sido expulsado de la sala por ${data.kickedBy}`,
            });
        }

        // Actualizar lista de usuarios en la sala usando broadcastRoomUsers
        await this.broadcastRoomUsers(data.roomCode);

        // console.log(
        //     `? Usuario ${data.username} expulsado de la sala ${data.roomCode}`,
        // );
    }

    @SubscribeMessage('leaveRoom')
    async handleLeaveRoom(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { roomCode: string; from: string },
    ) {
        // console.log(
        //     `?? WS: leaveRoom - Usuario: ${data.from}, Sala: ${data.roomCode}`,
        // );

        try {
            // Remover usuario de la base de datos
            await this.temporaryRoomsService.leaveRoom(data.roomCode, data.from);
        } catch (error) {
            // Error al remover de BD
        }

        // Remover usuario de la sala en memoria
        const roomUsersSet = this.roomUsers.get(data.roomCode);
        if (roomUsersSet) {
            roomUsersSet.delete(data.from);
            if (roomUsersSet.size === 0) {
                this.roomUsers.delete(data.roomCode);
            }
        }

        // Limpiar sala actual del usuario
        const user = this.users.get(data.from);
        if (user) {
            user.currentRoom = undefined;
        }

        // Notificar a todos en la sala
        await this.broadcastRoomUsers(data.roomCode);

        // Reenviar lista general de usuarios (ya que sali� de la sala)
        this.broadcastUserList();
    }

    // ===== M�TODOS PRIVADOS DEL CHAT =====

    private getRoomCodeFromUser(username: string): string | null {
        const user = this.users.get(username);
        return user?.currentRoom || null;
    }

    private generateTemporaryLink(
        type: string,
        participants: string[],
        createdBy: string,
    ): string {
        const linkId = crypto.randomBytes(16).toString('hex');

        this.temporaryLinks.set(linkId, {
            type,
            participants,
            createdBy,
            isActive: true,
            createdAt: getPeruDate(),
        });

        return linkId;
    }

    private cleanExpiredLinks() {
        // Obsoleto, ya no hay expiración
    }

    private async broadcastUserList(assignedConversations?: any[]) {
        // 🚀 OPTIMIZACIÓN: Throttle para evitar broadcasts excesivos
        const now = Date.now();
        if (now - this.lastBroadcastUserList < this.BROADCAST_USERLIST_THROTTLE) {
            // Si ya hay un broadcast pendiente, no programar otro
            if (!this.pendingBroadcastUserList) {
                this.pendingBroadcastUserList = true;
                setTimeout(() => {
                    this.pendingBroadcastUserList = false;
                    this.broadcastUserList(assignedConversations);
                }, this.BROADCAST_USERLIST_THROTTLE);
            }
            return;
        }
        this.lastBroadcastUserList = now;

        // Crear lista de usuarios conectados con toda su información
        const connectedUsersMap = new Map<string, any>();
        const userListWithData = Array.from(this.users.entries()).map(
            ([username, { userData }]) => {
                const userInfo = {
                    id: userData?.id || null,
                    username: username,
                    nombre: userData?.nombre || null,
                    apellido: userData?.apellido || null,
                    email: userData?.email || null,
                    role: userData?.role || 'USER',
                    picture: userData?.picture || null,
                    sede: userData?.sede || null,
                    sede_id: userData?.sede_id || null,
                    numeroAgente: userData?.numeroAgente || null,
                    isOnline: true, // Usuario conectado
                };
                connectedUsersMap.set(username, userInfo);
                // 🔥 FIX: También indexar por display name (nombre + apellido)
                // Los participantes de conversaciones se guardan como display name
                if (userData?.nombre && userData?.apellido) {
                    const displayName = `${userData.nombre} ${userData.apellido}`;
                    connectedUsersMap.set(displayName, userInfo);
                }
                return userInfo;
            },
        );

        // Log optimizado: evitar log por cada broadcast
        // console.log(`?? broadcastUserList - Total usuarios conectados: ${this.users.size}`);

        // Procesar cada usuario conectado
        for (const [
            _username,
            { socket, userData, currentRoom },
        ] of this.users.entries()) {
            // Log eliminado para optimizaci�n

            if (socket.connected) {
                // COMENTADO: Ahora enviamos la lista incluso si el usuario est� en una sala
                // para que reciban actualizaciones de estado online/offline en tiempo real
                // if (currentRoom) {
                //   console.log(
                //     `?? Usuario ${userData?.username || 'Usuario'} est� en sala ${currentRoom}, no enviar lista general`,
                //   );
                //   continue;
                // }

                // Solo enviar lista completa a usuarios admin
                const isAdmin =
                    userData?.role &&
                    userData.role.toString().toUpperCase().trim() === 'ADMIN';

                // Log eliminado para optimizaci�n

                if (isAdmin) {
                    //  ADMIN: Enviar usuarios conectados + usuarios de conversaciones (offline)
                    // Esto asegura que vean cambios de estado en tiempo real
                    const adminUsersToSend = [...userListWithData]; // Usuarios conectados

                    // Agregar usuarios offline de conversaciones
                    if (assignedConversations && assignedConversations.length > 0) {
                        const allParticipants = new Set<string>();
                        assignedConversations.forEach((conv) => {
                            conv.participants?.forEach((p) => allParticipants.add(p));
                        });

                        // OPTIMIZADO: Filtrar participantes que NO est�n conectados
                        const offlineParticipants = Array.from(allParticipants).filter(
                            (p) => !adminUsersToSend.some((u) => u.username === p),
                        );

                        if (offlineParticipants.length > 0) {
                            // Log eliminado para optimizaci�n

                            //  PASO 1: Verificar caché primero
                            // 🔥 CLUSTER FIX: Pre-fetch online users set
                            const onlineUsersSet = await this.getOnlineUsersSet();
                            const uncachedParticipants: string[] = [];
                            offlineParticipants.forEach((participantName) => {
                                const cached = this.userCache.get(participantName);
                                if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL) {
                                    // Usar datos del caché
                                    // 🔥 CLUSTER FIX: Verificar estado online usando Set que incluye Redis
                                    const isUserConnected = this.isUserOnlineWithSet(cached.username, onlineUsersSet) ||
                                        this.isUserOnlineWithSet(participantName, onlineUsersSet);

                                    adminUsersToSend.push({
                                        id: cached.id || null,
                                        username: cached.username,
                                        nombre: cached.nombre || null,
                                        apellido: cached.apellido || null,
                                        email: null,
                                        role: cached.role || 'USER',
                                        picture: null,
                                        sede: null,
                                        sede_id: null,
                                        numeroAgente: cached.numeroAgente || null,
                                        isOnline: isUserConnected,
                                    });
                                } else {
                                    uncachedParticipants.push(participantName);
                                }
                            });

                            // Log eliminado para optimizaci�n

                            // PASO 2: Consulta masiva para usuarios NO en cach�
                            if (uncachedParticipants.length > 0) {
                                try {
                                    // console.log(
                                    //     `?? Consultando BD para ${uncachedParticipants.length} usuarios no cacheados`,
                                    // );

                                    // UNA SOLA CONSULTA para todos los participantes offline
                                    const dbUsers = await this.userRepository
                                        .createQueryBuilder('user')
                                        .where(
                                            'CONCAT(user.nombre, " ", user.apellido) IN (:...names)',
                                            { names: uncachedParticipants },
                                        )
                                        .orWhere('user.username IN (:...usernames)', {
                                            usernames: uncachedParticipants,
                                        })
                                        .getMany(); // ? getMany() en lugar de getOne() en loop

                                    // console.log(
                                    //     `? Consulta masiva completada: ${dbUsers.length} usuarios encontrados`,
                                    // );

                                    // PASO 3: Procesar resultados y cachear
                                    dbUsers.forEach((dbUser) => {
                                        const fullName =
                                            dbUser.nombre && dbUser.apellido
                                                ? `${dbUser.nombre} ${dbUser.apellido}`
                                                : dbUser.username;

                                        // 🔥 CLUSTER FIX: Verificar estado online usando Set que incluye Redis
                                        const isUserConnected = this.isUserOnlineWithSet(fullName, onlineUsersSet) ||
                                            this.isUserOnlineWithSet(dbUser.username, onlineUsersSet);

                                        adminUsersToSend.push({
                                            id: dbUser.id || null,
                                            username: fullName,
                                            nombre: dbUser.nombre || null,
                                            apellido: dbUser.apellido || null,
                                            email: dbUser.email || null,
                                            role: dbUser.role || 'USER',
                                            picture: null,
                                            sede: null,
                                            sede_id: null,
                                            numeroAgente: dbUser.numeroAgente || null,
                                            isOnline: isUserConnected,
                                        });

                                        // CACHEAR para futuras consultas
                                        this.userCache.set(fullName, {
                                            id: dbUser.id,
                                            username: fullName,
                                            nombre: dbUser.nombre,
                                            apellido: dbUser.apellido,
                                            role: dbUser.role,
                                            numeroAgente: dbUser.numeroAgente,
                                            cachedAt: Date.now(),
                                        });
                                    });
                                } catch (error) {
                                    console.error(
                                        `? Error en consulta masiva de usuarios:`,
                                        error,
                                    );
                                }
                            }
                        }
                    }

                    // console.log(
                    //     `    ?? ADMIN: Enviando ${adminUsersToSend.length} usuarios (${userListWithData.length} online + ${adminUsersToSend.length - userListWithData.length} offline)`,
                    // );

                    // Enviar todos los usuarios (paginado)
                    const pageSize = 50; // Aumentar tama�o de p�gina para admins
                    const firstPage = adminUsersToSend.slice(0, pageSize);
                    socket.emit('userList', {
                        users: firstPage,
                        page: 0,
                        pageSize: pageSize,
                        totalUsers: adminUsersToSend.length,
                        hasMore: adminUsersToSend.length > pageSize,
                    });
                } else {
                    // console.log(
                    //     `    ?? Procesando usuario NO ADMIN: ${userData?.username}`,
                    // );

                    // Para usuarios no admin, incluir su propia informaci�n + usuarios de conversaciones asignadas
                    const usersToSend = [];

                    // Agregar informaci�n del usuario actual
                    const ownUserData = connectedUsersMap.get(userData?.username);
                    if (ownUserData) {
                        usersToSend.push(ownUserData);
                    }

                    // console.log(
                    //     `    ?? Usuario actual agregado: ${ownUserData?.username || 'none'}`,
                    // );

                    //  CORREGIDO: Obtener conversaciones del usuario actual
                    // IMPORTANTE: Las conversaciones guardan participantes con NOMBRE COMPLETO, no username
                    let userConversations = [];
                    if (assignedConversations && assignedConversations.length > 0) {
                        // Calcular nombre completo del usuario actual
                        const currentUserFullName =
                            userData?.nombre && userData?.apellido
                                ? `${userData.nombre} ${userData.apellido}`
                                : userData?.username;

                        // Filtrar conversaciones donde este usuario es participante (por nombre completo)
                        userConversations = assignedConversations.filter((conv) =>
                            conv.participants?.includes(currentUserFullName),
                        );

                        // console.log(
                        //     `?? Usuario ${currentUserFullName} tiene ${userConversations.length} conversaciones asignadas`,
                        // );
                    } else {
                        // Buscar en BD si no se pasaron conversaciones
                        try {
                            const userConversationsResult =
                                await this.temporaryConversationsService.findAll(
                                    userData?.username,
                                );
                            //  FIX: findAll devuelve { data, total, page, totalPages }, extraer .data
                            userConversations = Array.isArray(userConversationsResult)
                                ? userConversationsResult
                                : (userConversationsResult?.data || []);
                        } catch (error) {
                            console.error(
                                `? Error al obtener conversaciones de ${userData?.username}:`,
                                error,
                            );
                            userConversations = [];
                        }
                    }

                    // Si tiene conversaciones asignadas, agregar informaci�n de los otros usuarios
                    if (userConversations && userConversations.length > 0) {
                        // Calcular nombre completo del usuario actual (de nuevo, para usarlo en comparaciones)
                        const currentUserFullName =
                            userData?.nombre && userData?.apellido
                                ? `${userData.nombre} ${userData.apellido}`
                                : userData?.username;

                        // 🚀 OPTIMIZACIÓN: Recolectar participantes offline primero
                        const participantsToFind: string[] = [];

                        for (const conv of userConversations) {
                            if (conv.participants && Array.isArray(conv.participants)) {
                                for (const participantName of conv.participants) {
                                    // No agregar al usuario actual (comparar por nombre completo)
                                    if (participantName !== currentUserFullName) {
                                        // Verificar si ya est� en la lista
                                        if (!usersToSend.some((u) => u.username === participantName) &&
                                            !participantsToFind.includes(participantName)) {

                                            // Primero buscar en usuarios conectados
                                            const participantData = connectedUsersMap.get(participantName);
                                            if (participantData) {
                                                usersToSend.push(participantData);
                                            } else {
                                                // No conectado, agregar para batch query
                                                participantsToFind.push(participantName);
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // 🚀 OPTIMIZACIÓN: UNA sola query para todos los participantes offline
                        if (participantsToFind.length > 0) {
                            try {
                                const dbUsers = await this.userRepository
                                    .createQueryBuilder('user')
                                    .where(
                                        'CONCAT(user.nombre, " ", user.apellido) IN (:...names)',
                                        { names: participantsToFind },
                                    )
                                    .orWhere('user.username IN (:...usernames)', {
                                        usernames: participantsToFind,
                                    })
                                    .getMany();

                                // 🔥 CLUSTER FIX: Obtener Set de usuarios online ANTES del forEach
                                const onlineUsersSet2 = await this.getOnlineUsersSet();

                                dbUsers.forEach((dbUser) => {
                                    const fullName =
                                        dbUser.nombre && dbUser.apellido
                                            ? `${dbUser.nombre} ${dbUser.apellido}`
                                            : dbUser.username;

                                    // 🔥 CLUSTER FIX: Verificar estado online usando Set pre-cargado
                                    const isUserConnected = this.isUserOnlineWithSet(fullName, onlineUsersSet2) ||
                                        this.isUserOnlineWithSet(dbUser.username, onlineUsersSet2);

                                    usersToSend.push({
                                        id: dbUser.id || null,
                                        username: fullName,
                                        nombre: dbUser.nombre || null,
                                        apellido: dbUser.apellido || null,
                                        email: dbUser.email || null,
                                        role: dbUser.role || 'USER',
                                        picture: dbUser.picture || null, // 🔥 FIX: Usar picture de BD
                                        sede: userConversations.find(c => c.participants.includes(fullName))?.sede || null, // Intentar obtener sede de conversación si no está en BD
                                        sede_id: null,
                                        numeroAgente: dbUser.numeroAgente || null,
                                        isOnline: isUserConnected,
                                    });
                                });
                            } catch (error) {
                                console.error(`❌ Error en batch query de usuarios:`, error);
                            }
                        }
                    }

                    // console.log(`?? Enviando informaci�n a usuario: ${userData?.username}`, usersToSend);
                    socket.emit('userList', { users: usersToSend });
                }
            }
        }
    }

    private broadcastGroupList() {
        const groupList = Array.from(this.groups.entries()).map(
            ([name, members]) => ({
                name,
                members: Array.from(members),
            }),
        );

        this.users.forEach(({ socket }) => {
            if (socket.connected) {
                socket.emit('groupList', { groups: groupList });
            }
        });
    }

    private async broadcastRoomUsers(roomCode: string) {
        const connectedUsernamesList = Array.from(
            this.roomUsers.get(roomCode) || [],
        );

        // Obtener TODOS los usuarios a�adidos a la sala (historial)
        let allUsernames: string[] = [];
        let memberCount: number = 0;
        try {
            const room = await this.getCachedRoom(roomCode);
            // MODIFICADO: Usar TODOS los usuarios a�adidos (members) para mostrar en la lista
            allUsernames = room.members || [];
            // El contador debe ser el total de usuarios a�adidos a la sala
            memberCount = room.members?.length || 0;
        } catch (error) {
            // Si hay error, usar solo los usuarios conectados
            allUsernames = connectedUsernamesList;
            memberCount = connectedUsernamesList.length;
        }

        // 🔥 CLUSTER FIX: Obtener Set de usuarios online (incluye Redis)
        const onlineUsersSet = await this.getOnlineUsersSet();

        // 🔥 CLUSTER FIX: Obtener datos completos de usuarios online desde Redis
        const onlineUsersDataMap = await this.getOnlineUsersDataMap();

        // Crear lista con TODOS los usuarios añadidos a la sala y su estado de conexión
        const roomUsersList = allUsernames.map((username) => {
            let user = this.users.get(username);
            let userData = user?.userData;

            // 🔥 FIX: Si no está conectado localmente, buscar en caché (local o lo que se haya traído de Redis)
            if (!userData) {
                const cached = this.userCache.get(username);
                if (cached) {
                    userData = cached;
                }
            }

            // 🔥 FIX: Si aún no tenemos datos pero está online en Redis, usar datos de Redis
            if (!userData) {
                const redisData = onlineUsersDataMap.get(username);
                if (redisData) {
                    userData = redisData;
                }
            }

            // 🔥 CLUSTER FIX: Verificar estado online usando Set que incluye Redis
            const isOnline = this.isUserOnlineWithSet(username, onlineUsersSet);

            return {
                id: userData?.id || null,
                username: username,
                picture: userData?.picture || null,
                nombre: userData?.nombre || null,
                apellido: userData?.apellido || null,
                sede: userData?.sede || null,
                sede_id: userData?.sede_id || null,
                role: userData?.role || null,
                numeroAgente: userData?.numeroAgente || null,
                isOnline: isOnline,
            };
        });

        // Enviar a TODOS los usuarios conectados (para que vean actualizaciones en tiempo real)
        // Esto permite que usuarios que salieron de la sala vean cuando otros entran/salen
        // 🔥 CLUSTER FIX: Usar server.to(roomCode).emit() para Redis
        this.server.to(roomCode).emit('roomUsers', {
            roomCode,
            users: roomUsersList,
        });
        console.log(`✅ [CLUSTER] roomUsers emitido vía Redis para ${roomCode}`);


        // ?? MODIFICADO: Usar members.length para el contador (total de usuarios a�adidos a la sala)
        // Notificar a todos los ADMIN y JEFEPISO sobre el cambio en el contador de usuarios
        this.broadcastRoomCountUpdate(roomCode, memberCount);
    }

    private broadcastRoomCountUpdate(roomCode: string, currentMembers: number) {
        // Enviar actualizaci�n del contador a todos los ADMIN y JEFEPISO
        this.users.forEach(({ socket, userData }) => {
            const role = userData?.role?.toString().toUpperCase().trim();
            if (socket.connected && (role === 'ADMIN' || role === 'JEFEPISO')) {
                socket.emit('roomCountUpdate', {
                    roomCode,
                    currentMembers,
                });
            }
        });
    }

    // ==================== EVENTOS WEBRTC (SIMPLE-PEER) ====================

    @SubscribeMessage('callUser')
    handleCallUser(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            userToCall: string;
            signalData: any;
            from: string;
            callType: string;
        },
    ) {
        // console.log(
        //     `?? WS: callUser - De: ${data.from}, Para: ${data.userToCall}, Tipo: ${data.callType}`,
        // );

        // 🚀 CLUSTER FIX: Broadcast directed via Redis
        this.server.to(data.userToCall).emit('callUser', {
            signal: data.signalData,
            from: data.from,
            callType: data.callType,
        });
    }

    @SubscribeMessage('answerCall')
    handleAnswerCall(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { signal: any; to: string },
    ) {
        // console.log(`?? WS: answerCall - Para: ${data.to}`);

        this.server.to(data.to).emit('callAccepted', {
            signal: data.signal,
        });
    }

    @SubscribeMessage('callRejected')
    handleCallRejected(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { to: string; from: string },
    ) {
        // console.log(`? WS: callRejected - De: ${data.from}`);

        this.server.to(data.to).emit('callRejected', {
            from: data.from,
        });
    }

    // ?? NUEVO: Manejar candidatos ICE para trickling
    @SubscribeMessage('iceCandidate')
    handleIceCandidate(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { candidate: any; to: string },
    ) {
        // console.log(`?? WS: iceCandidate - Para: ${data.to}`);

        this.server.to(data.to).emit('iceCandidate', {
            candidate: data.candidate,
        });
    }

    @SubscribeMessage('callEnded')
    handleCallEnded(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { to: string },
    ) {
        // console.log(`?? WS: callEnded - Para: ${data.to}`);

        this.server.to(data.to).emit('callEnded');
    }

    // ==================== VIDEOLLAMADAS (ZEGOCLOUD) ====================

    @SubscribeMessage('joinVideoRoom')
    handleJoinVideoRoom(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { roomID: string; username: string },
    ) {
        // console.log(
        //     `?? WS: joinVideoRoom - Usuario: ${data.username} uni�ndose a sala de video: ${data.roomID}`,
        // );

        // Unir el socket a la sala de video
        client.join(data.roomID);

        // console.log(
        //     `? Usuario ${data.username} unido a sala de video ${data.roomID}`,
        // );
    }

    @SubscribeMessage('startVideoCall')
    handleStartVideoCall(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomID: string;
            callType: string;
            chatId: string;
            initiator: string;
            callUrl: string;
            participants: string[];
        },
    ) {
        // console.log(
        //     `?? WS: startVideoCall - Iniciador: ${data.initiator}, Tipo: ${data.callType}, Sala: ${data.roomID}`,
        // );

        // Notificar a todos los participantes
        if (data.callType === 'group' && data.participants) {
            // Videollamada grupal
            data.participants.forEach((participant) => {
                const targetUser = this.users.get(participant);
                if (targetUser && targetUser.socket.connected) {
                    targetUser.socket.emit('incomingVideoCall', {
                        roomID: data.roomID,
                        initiator: data.initiator,
                        callUrl: data.callUrl,
                        callType: 'group',
                    });
                }
            });
        } else if (data.callType === 'individual' && data.participants[0]) {
            // Videollamada individual
            const targetUser = this.users.get(data.participants[0]);
            if (targetUser && targetUser.socket.connected) {
                targetUser.socket.emit('incomingVideoCall', {
                    roomID: data.roomID,
                    initiator: data.initiator,
                    callUrl: data.callUrl,
                    callType: 'individual',
                });
            }
        }
    }

    @SubscribeMessage('endVideoCall')
    async handleEndVideoCall(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomID: string;
            roomCode?: string;
            participants?: string[];
            closedBy: string;
            isGroup?: boolean;
        },
    ) {
        // console.log(
        //   `?? WS: endVideoCall - Sala: ${data.roomID}, RoomCode: ${data.roomCode}, Cerrada por: ${data.closedBy}`,
        // );

        // NUEVO: Marcar la videollamada como inactiva en la BD
        try {
            // Buscar el mensaje de videollamada por videoRoomID usando el servicio
            let videoCallMessage = await this.messagesService.findByVideoRoomID(
                data.roomID,
            );

            // FALLBACK: Mensajes antiguos sin videoRoomID (solo tienen URL y roomCode)
            if (!videoCallMessage && data.roomCode) {
                videoCallMessage =
                    await this.messagesService.findLatestVideoCallByRoomCode(
                        data.roomCode,
                    );
                // if (videoCallMessage) {
                //   console.log(
                //     `?? Videollamada encontrada por roomCode (sin videoRoomID): ${videoCallMessage.id}`,
                //   );
                // }
            }

            if (videoCallMessage) {
                // Actualizar metadata para marcar como inactiva
                const metadata = videoCallMessage.metadata || {};
                metadata.isActive = false;
                metadata.closedBy = data.closedBy;
                metadata.closedAt = new Date().toISOString();

                const updatePayload: any = {
                    metadata,
                };

                // ?? Si el mensaje no ten�a videoRoomID, guardarlo ahora para futuras b�squedas
                if (!videoCallMessage.videoRoomID && data.roomID) {
                    updatePayload.videoRoomID = data.roomID;
                }

                await this.messagesService.update(videoCallMessage.id, updatePayload);

                // console.log(
                //   `? Videollamada marcada como inactiva en BD: ${videoCallMessage.id}`,
                // );
            } else {
                // console.warn(
                //   `?? No se encontr� mensaje de videollamada para roomID=${data.roomID} / roomCode=${data.roomCode}`,
                // );
            }
        } catch (error) {
            console.error('? Error al marcar videollamada como inactiva:', error);
        }

        // ?? CR�TICO: Obtener TODOS los miembros del grupo desde la BD
        let groupMembers: string[] = [];

        if (data.roomCode) {
            try {
                // ?? PRIMERO: Buscar en la base de datos para obtener TODOS los miembros
                const room = await this.getCachedRoom(
                    data.roomCode,
                );
                if (room && room.members && room.members.length > 0) {
                    groupMembers = room.members;
                    // console.log(
                    //     `?? Miembros de la sala ${data.roomCode} desde BD:`,
                    //     groupMembers,
                    // );
                } else {
                    // console.warn(
                    //     `?? No se encontraron miembros en BD para sala ${data.roomCode}`,
                    // );
                }
            } catch (error) {
                console.error(
                    `? Error al obtener sala ${data.roomCode} desde BD:`,
                    error,
                );
            }

            // ?? FALLBACK: Si no se encontraron miembros en BD, intentar desde memoria
            if (groupMembers.length === 0) {
                const roomUsersSet = this.roomUsers.get(data.roomCode);
                if (roomUsersSet && roomUsersSet.size > 0) {
                    groupMembers = Array.from(roomUsersSet);
                    // console.log(
                    //     `?? Miembros activos en sala ${data.roomCode} desde memoria:`,
                    //     groupMembers,
                    // );
                }
            }
        }

        // Notificar a todos los miembros del grupo
        if (groupMembers.length > 0) {
            // console.log(
            //     `?? Notificando cierre de videollamada a ${groupMembers.length} miembros`,
            // );
            groupMembers.forEach((member) => {
                const targetUser = this.users.get(member);
                if (targetUser && targetUser.socket.connected) {
                    // console.log(`   ? Notificando a: ${member}`);
                    targetUser.socket.emit('videoCallEnded', {
                        roomID: data.roomID,
                        roomCode: data.roomCode,
                        closedBy: data.closedBy,
                        message: `La videollamada fue cerrada por ${data.closedBy}`,
                    });
                } else {
                    // console.log(`   ? Usuario no conectado: ${member}`);
                }
            });
        }

        // ?? NUEVO: Si es grupo, emitir a toda la sala por roomCode (por si acaso)
        if (data.isGroup && data.roomCode) {
            // console.log(`?? Emitiendo a sala ${data.roomCode} via broadcast`);
            this.server.to(data.roomCode).emit('videoCallEnded', {
                roomID: data.roomID,
                roomCode: data.roomCode,
                closedBy: data.closedBy,
                message: `La videollamada fue cerrada por ${data.closedBy}`,
            });
        }

        // Tambi�n emitir a toda la sala de video por si acaso
        // console.log(`?? Emitiendo a sala de video ${data.roomID} via broadcast`);
        this.server.to(data.roomID).emit('videoCallEnded', {
            roomID: data.roomID,
            roomCode: data.roomCode,
            closedBy: data.closedBy,
            message: `La videollamada fue cerrada por ${data.closedBy}`,
        });
    }

    // ==================== MENSAJES LE�DOS ====================

    @SubscribeMessage('markAsRead')
    async handleMarkAsRead(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { messageId: number; username: string; from: string },
    ) {
        // 🔍 DEBUG: Log para detectar quién marca mensajes como leídos
        if (data.username?.toUpperCase().includes('KAREN')) {
            console.log(`🚨🚨🚨 handleMarkAsRead (genérico) KAREN - msgId: ${data.messageId}, from: ${data.from}`);
        }

        try {
            // Marcar el mensaje como le�do en la base de datos
            const message = await this.messagesService.markAsRead(
                data.messageId,
                data.username,
            );

            if (message) {
                //  CLUSTER FIX: Usar server.to() en lugar de socket.emit()
                const senderRoom = data.from?.toLowerCase?.();
                const readerRoom = data.username?.toLowerCase?.();

                const readPayload = {
                    messageId: data.messageId,
                    readBy: data.username,
                    readAt: message.readAt,
                };

                // Notificar al remitente que su mensaje fue leído
                if (senderRoom) {
                    console.log(`👁️ Emitiendo messageRead a sala: ${senderRoom}`);
                    this.server.to(senderRoom).emit('messageRead', readPayload);
                }

                // Confirmar al lector también
                if (readerRoom && readerRoom !== senderRoom) {
                    this.server.to(readerRoom).emit('messageReadConfirmed', {
                        messageId: data.messageId,
                        readAt: message.readAt,
                    });
                }
            }
        } catch (error) {
            console.error('Error al marcar mensaje como le�do:', error);
            client.emit('error', { message: 'Error al marcar mensaje como le�do' });
        }
    }

    @SubscribeMessage('markConversationAsRead')
    async handleMarkConversationAsRead(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { from: string; to: string; conversationId?: number },
    ) {
        // console.log(
        //     `? WS: markConversationAsRead - Conversaci�n de ${data.from} a ${data.to} marcada como le�da`,
        // );

        try {
            // Marcar todos los mensajes de la conversaci�n como le�dos
            const messages = await this.messagesService.markConversationAsRead(
                data.from,
                data.to,
            );

            if (messages.length > 0) {
                // 🔥 NUEVO: Emitir reset de contador para conversación asignada
                // Esto asegura que el contador se resetee en favoritos y en la lista normal
                if (data.conversationId) {
                    console.log(`📬 Emitiendo unreadCountReset para conversación ${data.conversationId} a ${data.to}`);

                    // Emitir a TODAS las variantes del nombre del usuario (igual que en assignedConversationUpdated)
                    this.server.to(data.to).emit('unreadCountReset', {
                        conversationId: data.conversationId,
                    });
                    this.server.to(data.to.toLowerCase()).emit('unreadCountReset', {
                        conversationId: data.conversationId,
                    });
                    this.server.to(data.to.toUpperCase()).emit('unreadCountReset', {
                        conversationId: data.conversationId,
                    });
                }

                // ?? B�squeda case-insensitive del remitente
                let senderUser = this.users.get(data.from);

                if (!senderUser) {
                    const senderNormalized = data.from?.toLowerCase().trim();
                    const foundUsername = Array.from(this.users.keys()).find(
                        (key) => key?.toLowerCase().trim() === senderNormalized,
                    );
                    if (foundUsername) {
                        senderUser = this.users.get(foundUsername);
                        // console.log(
                        //     `? Remitente encontrado con b�squeda case-insensitive: ${foundUsername}`,
                        // );
                    }
                }

                // Notificar al remitente que sus mensajes fueron ledos
                if (senderUser && senderUser.socket.connected) {
                    // console.log(
                    //     `?? Notificando a ${data.from} que sus mensajes fueron ledos por ${data.to}`,
                    // );
                    senderUser.socket.emit('conversationRead', {
                        readBy: data.to,
                        messageIds: messages.map((m) => m.id),
                        readAt: getPeruDate(),
                        conversationId: messages[0]?.conversationId // 🔥 Incluir ID de conversación
                    });
                } else {
                    // console.log(
                    //     `? No se pudo notificar a ${data.from} (usuario no conectado o no encontrado)`,
                    // );
                }

                // Confirmar al lector
                client.emit('conversationReadConfirmed', {
                    messagesUpdated: messages.length,
                    readAt: getPeruDate(),
                });
            }
        } catch (error) {
            console.error('Error al marcar conversaci�n como le�da:', error);
            client.emit('error', {
                message: 'Error al marcar conversaci�n como le�da',
            });
        }
    }

    @SubscribeMessage('markRoomMessageAsRead')
    async handleMarkRoomMessageAsRead(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: { messageId: number; username: string; roomCode: string },
    ) {
        // 🔍 DEBUG: Log para detectar quién marca mensajes como leídos
        if (data.username?.toUpperCase().includes('KAREN')) {
            console.log(`🚨🚨🚨 handleMarkRoomMessageAsRead KAREN - msgId: ${data.messageId}, room: ${data.roomCode}, stack: ${new Error().stack?.split('\n').slice(1, 4).join(' | ')}`);
        }

        // 🔥 DEDUPLICACIÓN: Bloquear eventos duplicados del frontend viejo (cacheado)
        const dedupeKey = `markRead:${data.messageId}:${data.username}`;

        try {
            // Verificar si ya fue procesado recientemente
            if (this.isRedisReady()) {
                const exists = await this.redisClient.get(dedupeKey);
                if (exists) {
                    // Ya procesado, ignorar silenciosamente
                    return;
                }
                // Marcar como procesado con TTL de 5 segundos
                await this.redisClient.set(dedupeKey, '1', { EX: 5 });
            }

            // Marcar el mensaje como leído en la base de datos
            const message = await this.messagesService.markAsRead(
                data.messageId,
                data.username,
            );

            if (message) {
                // 🔥 FIX CLUSTER: Obtener datos completos de usuarios desde BD
                const readByData = await this.getBatchUsersData(message.readBy || []);

                // Broadcast a la sala - SIN log para evitar spam
                this.server.to(data.roomCode).emit('roomMessageRead', {
                    messageId: data.messageId,
                    readBy: message.readBy, // Array de usernames (compatibilidad)
                    readByData, // 🔥 NUEVO: Array con datos completos
                    readAt: message.readAt,
                    roomCode: data.roomCode,
                });
            }
        } catch (error) {
            console.error('Error al marcar mensaje de sala como leído:', error);
            client.emit('error', {
                message: 'Error al marcar mensaje de sala como leído',
            });
        }
    }

    @SubscribeMessage('markRoomMessagesAsRead')
    async handleMarkRoomMessagesAsRead(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { roomCode: string; username: string },
    ) {
        try {
            // Marcar todos los mensajes de la sala como leídos en la base de datos
            const { updatedCount, updatedMessages } = await this.messagesService.markAllMessagesAsReadInRoom(
                data.roomCode,
                data.username,
            );

            // Confirmar al usuario que la acción fue exitosa
            client.emit('roomMessagesReadConfirmed', {
                roomCode: data.roomCode,
                updatedCount,
            });

            // 🚀 OPTIMIZADO: Emitir UN SOLO evento batch en lugar de N eventos individuales
            // Antes: N loops = N queries a getBatchUsersData + N eventos socket
            // Ahora: 1 query + 1 evento socket
            if (updatedMessages.length > 0) {
                // Recolectar todos los usuarios únicos que leyeron mensajes
                const allReadByUsers = new Set<string>();
                updatedMessages.forEach(msg => {
                    (msg.readBy || []).forEach(user => allReadByUsers.add(user));
                });

                // Una sola llamada para obtener datos de todos los usuarios
                const readByData = await this.getBatchUsersData(Array.from(allReadByUsers));

                // Emitir UN SOLO evento batch con todos los mensajes actualizados
                this.server.to(data.roomCode).emit('roomMessagesReadBatch', {
                    messages: updatedMessages.map(msg => ({
                        messageId: msg.id,
                        readBy: msg.readBy,
                        readAt: msg.readAt,
                    })),
                    readByData, // Datos de usuarios compartidos para todos
                    roomCode: data.roomCode,
                    updatedCount,
                });
            }

            // Emitir reset de contador para asegurar que el frontend se actualice
            this.emitUnreadCountReset(data.roomCode, data.username);

            // También emitir actualización de contador a 0 explícitamente
            this.emitUnreadCountUpdateForUser(data.roomCode, data.username, 0);

        } catch (error) {
            console.error('Error al marcar mensajes de sala como leídos:', error);
            client.emit('error', {
                message: 'Error al marcar mensajes de sala como leídos',
            });
        }
    }

    @SubscribeMessage('threadMessage')
    async handleThreadMessage(
        @ConnectedSocket() _client: Socket,
        @MessageBody() data: any,
    ) {
        // 🚀 OPTIMIZADO: Ahora el backend maneja TODO el flujo de mensajes de hilo
        // Antes: Frontend hacía POST /messages + PATCH /increment-thread + 2 eventos WS
        // Ahora: Frontend solo emite 'threadMessage', backend hace el resto

        try {
            const { threadId, from, to, isGroup, roomCode } = data;

            console.log('🧵 handleThreadMessage recibido:', {
                from,
                to,
                isGroup,
                roomCode,
                threadId,
                hasId: !!data.id,
            });

            // 🔥 RESOLVER DATOS DEL REMITENTE SIEMPRE (para real-time display)
            const senderData = await this.getSenderData(from);
            const resolvedFrom = senderData?.username || from;
            const senderFullName = senderData?.fullName || from;
            const senderRole = senderData?.role || null;
            const senderNumeroAgente = senderData?.numeroAgente || null;

            let savedMessage = data;

            // 🚀 PASO 1: Guardar mensaje en BD si no tiene ID (no fue guardado por frontend)
            if (!data.id && threadId) {
                try {
                    // Si resolvemos a un DNI diferente al que vino, lo actualizamos en data para el guardado
                    if (resolvedFrom !== from) {
                        data.from = resolvedFrom;
                    }

                    // Guardar mensaje de hilo en BD
                    savedMessage = await this.messagesService.create({
                        ...data,
                        threadId,
                        senderRole,
                        senderNumeroAgente,
                    });

                    console.log(`🧵 Mensaje de hilo guardado con ID: ${savedMessage?.id}`);
                } catch (saveError) {
                    console.error('❌ Error al guardar mensaje de hilo:', saveError);
                    // Continuar con el data original para no bloquear la UI
                }
            }

            // 🚀 PASO 2: Incrementar threadCount del mensaje padre O del adjunto específico
            if (threadId) {
                try {
                    // 🔥 FIX: Pasar replyToAttachmentId para separar contadores
                    await this.messagesService.incrementThreadCount(threadId, data.replyToAttachmentId);
                    console.log(`🔢 threadCount incrementado para ${data.replyToAttachmentId ? `adjunto ${data.replyToAttachmentId}` : `mensaje ${threadId}`}`);
                } catch (incError) {
                    console.error('❌ Error al incrementar threadCount:', incError);
                }
            }

            // 🚀 PASO 3: Preparar payload con datos actualizados
            const messagePayload = {
                ...data,
                from: senderFullName, // 🔥 Usar Nombre Completo para consistencia real-time
                id: savedMessage?.id || data.id,
                sentAt: savedMessage?.sentAt || data.sentAt,
                time: savedMessage?.time || data.time,
            };

            // 🚀 PASO 4: Emitir threadMessage a destinatarios
            if (isGroup && roomCode) {
                console.log(`🧵 Emitiendo threadMessage a sala de grupo: ${roomCode} (Payload con threadId=${messagePayload.threadId})`);
                this.server.to(roomCode).emit('threadMessage', messagePayload);
            } else {
                const fromRoom = from?.toLowerCase?.();
                const toRoom = to?.toLowerCase?.();

                if (fromRoom) {
                    this.server.to(fromRoom).emit('threadMessage', messagePayload);
                }
                if (toRoom && toRoom !== fromRoom) {
                    this.server.to(toRoom).emit('threadMessage', messagePayload);
                }
            }

            // 🚀 PASO 5: Emitir threadCountUpdated automáticamente (antes era otro evento separado)
            let roomName = '';
            if (isGroup && roomCode) {
                const room = await this.getCachedRoom(roomCode);
                roomName = room?.name || '';
            }

            // 🔥 FIX: Obtener conteo REAL desde BD para evitar desincronización
            const realThreadCount = await this.messagesService.getThreadCount(threadId);

            const updatePayload = {
                messageId: threadId,
                lastReplyFrom: senderFullName, // 🔥 Usar Nombre Completo
                lastReplyText: data.message?.substring(0, 100), // Preview del mensaje
                from: senderFullName, // 🔥 Usar Nombre Completo
                to,
                isGroup,
                roomCode,
                roomName,
                threadCount: realThreadCount, // 🔥 ENVIAR TOTAL ABSOLUTO
            };

            if (isGroup && roomCode) {
                this.server.to(roomCode).emit('threadCountUpdated', updatePayload);
            } else {
                const fromRoom = from?.toLowerCase?.();
                const toRoom = to?.toLowerCase?.();
                if (toRoom) {
                    this.server.to(toRoom).emit('threadCountUpdated', updatePayload);
                }
                if (fromRoom && fromRoom !== toRoom) {
                    this.server.to(fromRoom).emit('threadCountUpdated', updatePayload);
                }
            }

            // 🔥 NUEVO: Emitir assignedConversationUpdated si es un chat asignado
            if (!isGroup && savedMessage?.conversationId) {
                const messageText = data.message || (data.mediaType ? `📎 ${data.mediaType}` : '📎 Archivo');

                const conversationUpdateData = {
                    conversationId: savedMessage.conversationId,
                    lastMessage: messageText,
                    lastMessageTime: savedMessage.sentAt || new Date().toISOString(),
                    lastMessageFrom: senderFullName, // 🔥 Usar Nombre Completo
                    lastMessageMediaType: data.mediaType
                };

                // Emitir a ambos participantes (remitente y destinatario)
                const participants = [from, to].filter(Boolean);
                participants.forEach(participantName => {
                    this.server.to(participantName).emit('assignedConversationUpdated', conversationUpdateData);
                });
            }

            console.log('✅ threadMessage procesado completamente');
        } catch (error) {
            console.error('❌ Error al manejar threadMessage:', error);
        }
    }

    // 🔥 NUEVO: Método público para notificar que un mensaje fue leído (Read Receipt)
    // Se llama desde MessagesController
    public async notifyMessageRead(message: any, readByUsername: string) {
        if (!message) return;

        console.log(`👁️ Notificando lectura de mensaje ${message.id} por ${readByUsername}`);

        const payload = {
            messageId: message.id,
            readBy: [readByUsername], // Enviamos array para compatibilidad
            readAt: new Date(),
            roomCode: message.roomCode,
            isGroup: message.isGroup,
            threadId: message.threadId // Importante para actualizar estado dentro del hilo
        };

        // 1. Si es grupo, emitir a la sala
        if (message.isGroup && message.roomCode) {
            this.server.to(message.roomCode).emit('messageRead', payload);
        }
        // 2. Si es DM, emitir a ambos usuarios
        else {
            const fromRoom = message.from?.toLowerCase?.();
            const toRoom = message.to?.toLowerCase?.();

            if (fromRoom) {
                this.server.to(fromRoom).emit('messageRead', payload);
            }
            if (toRoom && toRoom !== fromRoom) {
                this.server.to(toRoom).emit('messageRead', payload);
            }
        }
    }

    // 🔥 DESHABILITADO: Este handler es redundante.
    // La lógica de threadCountUpdated ya se maneja en handleThreadMessage.
    // Mantener este handler causaba emisiones duplicadas.
    /*
    @SubscribeMessage('threadCountUpdated')
    async handleThreadCountUpdated(
        @ConnectedSocket() _client: Socket,
        @MessageBody() data: any,
    ) {
        // ... código eliminado para evitar duplicados ...
    }
    */
    // ==================== REACCIONES A MENSAJES ====================

    @SubscribeMessage('toggleReaction')
    async handleToggleReaction(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            messageId: number;
            username: string;
            emoji: string;
            roomCode?: string;
            to?: string;
            threadId?: number; //  Para reacciones en mensajes de hilo
        },
    ) {
        // 🔥 DEDUPLICACIÓN: Evitar procesamiento múltiple del mismo evento
        const dedupeKey = `reaction:${data.messageId}:${data.username}:${data.emoji}`;

        try {
            if (this.isRedisReady()) {
                const exists = await this.redisClient.get(dedupeKey);
                if (exists) {
                    // Ya procesado recientemente, ignorar
                    return;
                }
                // Marcar como procesado con TTL de 2 segundos (reacciones son rápidas)
                await this.redisClient.set(dedupeKey, '1', { EX: 2 });
            }

            const message = await this.messagesService.toggleReaction(
                data.messageId,
                data.username,
                data.emoji,
            );

            if (message) {
                //  CLUSTER FIX: Usar server.to().emit() en lugar de socket.emit()

                // Preparar payload
                const reactionPayload = {
                    messageId: data.messageId,
                    reactions: message.reactions,
                    roomCode: data.roomCode || null,
                    to: data.to || null,
                    threadId: data.threadId || null, //  Para saber si es reacción en hilo
                };

                if (data.roomCode) {
                    //  CLUSTER: Broadcast a sala de grupo via Redis (sin log)
                    this.server.to(data.roomCode).emit('reactionUpdated', reactionPayload);
                } else if (data.to) {
                    //  CLUSTER: Broadcast a participantes del chat 1:1 via Redis
                    const toRoom = data.to?.toLowerCase?.();
                    const fromRoom = data.username?.toLowerCase?.();

                    if (toRoom) {
                        this.server.to(toRoom).emit('reactionUpdated', reactionPayload);
                    }
                    if (fromRoom && fromRoom !== toRoom) {
                        this.server.to(fromRoom).emit('reactionUpdated', reactionPayload);
                    }
                }
            }
        } catch (error) {
            console.error('Error al alternar reacción:', error);
            client.emit('error', { message: 'Error al alternar reacción' });
        }
    }

    /**
     * ?? OPTIMIZADO: Notificar solo a usuarios ADMIN/JEFEPISO usando adminUsers Map
     * En lugar de iterar sobre todos los 400 usuarios, iteramos solo sobre los ~5 admins
     */
    broadcastRoomCreated(room: any) {
        // Usar adminUsers Map para O(k) en lugar de O(n)
        this.adminUsers.forEach(({ socket }) => {
            if (socket.connected) {
                socket.emit('roomCreated', {
                    id: room.id,
                    name: room.name,
                    roomCode: room.roomCode,
                    maxCapacity: room.maxCapacity,
                    currentMembers: room.currentMembers,
                    createdAt: room.createdAt,
                    isActive: room.isActive,
                });
            }
        });
    }

    /**
     * ?? OPTIMIZADO: Notificar solo a admins + miembros de la sala
     */
    broadcastRoomDeleted(roomCode: string, roomId: number) {
        // Usar adminUsers Map para O(k) en lugar de O(n)
        this.adminUsers.forEach(({ socket }) => {
            if (socket.connected) {
                socket.emit('roomDeleted', {
                    roomCode,
                    roomId,
                });
            }
        });

        // ?? NUEVO: Notificar a todos los miembros de la sala que fue desactivada
        const roomMembers = this.roomUsers.get(roomCode);
        if (roomMembers) {
            // console.log(
            //     `?? Notificando a ${roomMembers.size} miembros de la sala ${roomCode}`,
            // );

            roomMembers.forEach((username) => {
                const userConnection = this.users.get(username);
                if (userConnection && userConnection.socket.connected) {
                    // console.log(
                    //     `? Notificando a ${username} que la sala fue desactivada`,
                    // );
                    userConnection.socket.emit('roomDeactivated', {
                        roomCode,
                        roomId,
                        message: 'La sala ha sido desactivada por el administrador',
                    });
                }
            });

            // Limpiar el mapa de usuarios de la sala
            this.roomUsers.delete(roomCode);
        }
    }

    /**
     * Notificar a un usuario específico que fue agregado a una sala
     * 🔥 CLUSTER FIX: Emitir a la sala del 'username' o alias.
     */
    notifyUserAddedToRoom(username: string, roomCode: string, roomName: string) {
        // console.log(`📢 Notificando adición a sala a ${username}`);

        // 🔥 NO verificar localmente this.users.get(username)
        // Emitir a la sala del usuario (que puede ser DNI, Nombre o Email)
        // Como el usuario se unió a todas sus salas de alias al registrarse,
        // esto llegará a su socket sin importar en qué instancia esté.
        this.server.to(username.toLowerCase().trim()).emit('addedToRoom', {
            username: username, // Para filtrado en frontend
            roomCode,
            roomName,
            message: `Has sido agregado a la sala: ${roomName}`,
        });

        console.log(`✅ [CLUSTER] addedToRoom emitido vía Redis/Rooms para ${username}`);
    }

    /**
     * Notificar cuando un usuario es eliminado de una sala
     */
    async handleUserRemovedFromRoom(roomCode: string, username: string, roomName?: string, removedBy?: string) {
        // console.log(`👋 Usuario ${username} eliminado de la sala ${roomCode}`);

        // 1. Remover del mapa local (si existe en esta instancia)
        const roomUserSet = this.roomUsers.get(roomCode);
        if (roomUserSet) {
            roomUserSet.delete(username);
            if (roomUserSet.size === 0) {
                this.roomUsers.delete(roomCode);
            }
        }

        // 2. Notificar al usuario (vía Sala Redis/Cluster)
        // 🔥 CLUSTER FIX: No depender de userConnection local
        this.server.to(username.toLowerCase().trim()).emit('removedFromRoom', {
            username: username,
            roomCode,
            roomName: roomName || roomCode,
            removedBy: removedBy || 'Administrador',
            message: `Has sido eliminado de la sala "${roomName || roomCode}"${removedBy ? ` por ${removedBy}` : ''}`,
        });

        // 3. Limpiar sala actual si está conectado localmente
        const userConnection = this.users.get(username);
        if (userConnection?.userData) {
            userConnection.userData.currentRoom = undefined;
        }

        console.log(`✅ [CLUSTER] removedFromRoom emitido vía Redis/Rooms para ${username}`);

        // Notificar a todos los usuarios de la sala sobre la actualización
        await this.broadcastRoomUsers(roomCode);

        // Reenviar lista general de usuarios
        this.broadcastUserList();
    }

    /**
     *  OPTIMIZADO: Emitir evento de monitoreo solo a ADMIN/JEFEPISO usando adminUsers Map
     * Cuando se env�a un mensaje entre dos usuarios, notificar a los monitores
     * ANTES: O(n) iterando sobre 200+ usuarios
     * AHORA: O(k) iterando solo sobre ~5 admins
     */
    private broadcastMonitoringMessage(messageData: any) {
        // console.log(
        //     `?? Broadcasting monitoringMessage a ADMIN/JEFEPISO - De: ${messageData.from}, Para: ${messageData.to}`,
        // );

        // ?? OPTIMIZADO: Usar adminUsers Map en lugar de iterar todos los usuarios
        this.adminUsers.forEach(({ socket }) => {
            if (socket.connected) {
                socket.emit('monitoringMessage', messageData);
            }
        });
    }

    //  NUEVO: Emitir actualizaci�n de contador de mensajes no le�dos para un usuario espec�fico
    public emitUnreadCountUpdateForUser(
        roomCode: string,
        username: string,
        count: number,
        lastMessage?: {
            text: string;
            from: string;
            time: string;
            sentAt: string;
            mediaType?: string;
            fileName?: string;
        },
    ) {
        // 🚀 CLUSTER FIX: Usar server.to() para que pase por Redis Adapter
        const payload = {
            roomCode,
            count,
            lastMessage,
        };
        this.server.to(username).emit('unreadCountUpdate', payload);
    }

    //  NUEVO: Emitir reset de contador cuando usuario entra a sala
    public emitUnreadCountReset(roomCode: string, username: string) {
        // console.log(
        //     `?? Emitiendo reset de contador no le�do - Sala: ${roomCode}, Usuario: ${username}`,
        // );

        // 🚀 CLUSTER FIX: Usar server.to() para que pase por Redis Adapter
        this.server.to(username).emit('unreadCountReset', {
            roomCode,
        });
    }

    /**
     *  OPTIMIZADO: M�todo p�blico para emitir evento de monitoreo desde el controller HTTP
     * Se usa cuando se crea un mensaje a trav�s del endpoint POST /api/messages
     * ANTES: O(n) iterando sobre 200+ usuarios
     * AHORA: O(k) iterando solo sobre ~5 admins
     */
    public broadcastMonitoringMessagePublic(messageData: any) {
        // console.log(
        //     `?? Broadcasting monitoringMessage (PUBLIC) a ADMIN/JEFEPISO - De: ${messageData.from}, Para: ${messageData.to}`,
        // );

        // ?? OPTIMIZADO: Usar adminUsers Map en lugar de iterar todos los usuarios
        this.adminUsers.forEach(({ socket }) => {
            if (socket.connected) {
                socket.emit('monitoringMessage', messageData);
            }
        });
    }

    // Generar hash de mensaje para detecci�n de duplicados
    private createMessageHash(data: any): string {
        const hashContent = `${data.from}-${data.to}-${data.message || ''}-${data.isGroup}`;
        return crypto.createHash('sha256').update(hashContent).digest('hex');
    }

    // Limpiar cach� de mensajes antiguos (m�s de 5 segundos)
    private cleanRecentMessagesCache() {
        const now = Date.now();
        const CACHE_EXPIRY = 5000; // 5 segundos

        for (const [hash, timestamp] of this.recentMessages.entries()) {
            if (now - timestamp > CACHE_EXPIRY) {
                this.recentMessages.delete(hash);
            }
        }
    }

    // NUEVO: Verificar si un mensaje es duplicado
    private isDuplicateMessage(data: any): boolean {
        const messageHash = this.createMessageHash(data);
        const now = Date.now();
        const lastSent = this.recentMessages.get(messageHash);
        const DUPLICATE_WINDOW = 2000; // 2 segundos

        // Si el mismo mensaje se envi� en los �ltimos 2 segundos, es duplicado
        if (lastSent && (now - lastSent) < DUPLICATE_WINDOW) {
            // console.log('?? Mensaje duplicado detectado en backend:', {
            //     hash: messageHash.substring(0, 8) + '...',
            //     timeSinceLastSend: now - lastSent,
            //     from: data.from,
            //     to: data.to,
            // });
            return true;
        }

        // Registrar este mensaje
        this.recentMessages.set(messageHash, now);
        return false;
    }

    // ===== EVENTOS DE ENCUESTAS =====

    @SubscribeMessage('pollVote')
    async handlePollVote(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            messageId: number;
            optionIndex: number;
            username: string;
            roomCode?: string;
            to?: string;
        },
    ) {
        // console.log(
        //     `?? WS: pollVote - Usuario: ${data.username}, MessageID: ${data.messageId}, Opci�n: ${data.optionIndex}`,
        // );

        try {
            // Obtener la encuesta asociada al mensaje
            const poll = await this.pollsService.getPollByMessageId(data.messageId);

            if (!poll) {
                console.error(`? Encuesta no encontrada para mensaje ${data.messageId}`);
                client.emit('error', { message: 'Encuesta no encontrada' });
                return;
            }

            // Validar que el �ndice de opci�n sea v�lido
            if (data.optionIndex < 0 || data.optionIndex >= poll.options.length) {
                console.error(`? �ndice de opci�n inv�lido: ${data.optionIndex}`);
                client.emit('error', { message: 'Opci�n inv�lida' });
                return;
            }

            // Registrar o actualizar el voto
            await this.pollsService.vote(poll.id, data.username, data.optionIndex);
            // console.log(`? Voto registrado: ${data.username} vot� por opci�n ${data.optionIndex}`);

            // Obtener la encuesta actualizada con todos los votos
            const updatedPoll = await this.pollsService.getPollWithVotes(poll.id);

            // Preparar datos de la encuesta para el frontend
            // Mapear entidades PollOption a estructura simple para frontend
            const optionsText = updatedPoll.options.map(o => o.text);

            const pollData = {
                question: updatedPoll.question,
                options: optionsText,
                votes: updatedPoll.options.flatMap((option, index) =>
                    option.votes ? option.votes.map(v => ({
                        username: v.username,
                        optionIndex: index
                    })) : []
                ),
            };

            // Emitir actualizacin en tiempo real
            if (data.roomCode) {
                // Es una sala de grupo
                const roomUsers = this.roomUsers.get(data.roomCode);
                if (roomUsers) {
                    roomUsers.forEach((member) => {
                        const memberUser = this.users.get(member);
                        if (memberUser && memberUser.socket.connected) {
                            memberUser.socket.emit('pollUpdated', {
                                messageId: data.messageId,
                                poll: pollData,
                            });
                        }
                    });
                }
            } else if (data.to) {
                // Es un chat privado
                const recipientConnection = this.users.get(data.to);
                if (recipientConnection && recipientConnection.socket.connected) {
                    recipientConnection.socket.emit('pollUpdated', {
                        messageId: data.messageId,
                        poll: pollData,
                    });
                }

                // Tambi�n emitir al remitente
                const senderConnection = this.users.get(data.username);
                if (senderConnection && senderConnection.socket.connected) {
                    senderConnection.socket.emit('pollUpdated', {
                        messageId: data.messageId,
                        poll: pollData,
                    });
                }
            }
        } catch (error) {
            console.error('? Error al procesar voto de encuesta:', error);
            client.emit('error', { message: 'Error al procesar voto' });
        }
    }

    // ==================== TRACKING DE PARTICIPANTES EN VIDEOLLAMADAS ====================

    /**
     * Modificar joinVideoRoom para trackear participantes
     * Este m�todo se llamar� cuando un usuario se una una videollamada
     */
    @SubscribeMessage('joinVideoRoomList')
    handleJoinVideoRoomList(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { roomID: string; username: string },
    ) {
        // console.log(
        //     `?? WS: joinVideoRoom - Usuario: ${data.username} uni�ndose a sala de video: ${data.roomID}`,
        // );

        // Unir el socket a la sala de video
        client.join(data.roomID);

        // ?? NUEVO: Agregar participante al tracking
        if (!this.videoRoomParticipants.has(data.roomID)) {
            this.videoRoomParticipants.set(data.roomID, new Set());
        }

        // Obtener informaci�n completa del usuario
        const userInfo = this.users.get(data.username);
        const participantInfo = {
            username: data.username,
            nombre: userInfo?.userData?.nombre || null,
            apellido: userInfo?.userData?.apellido || null,
            picture: userInfo?.userData?.picture || null,
        };

        // Agregar al Set (si ya existe, Set lo ignora)
        const participants = this.videoRoomParticipants.get(data.roomID);
        // Remover participante existente con mismo username primero (para actualizar info)
        const existingParticipant = Array.from(participants).find(
            (p) => p.username === data.username,
        );
        if (existingParticipant) {
            participants.delete(existingParticipant);
        }
        participants.add(participantInfo);

        // console.log(
        //     `? Usuario ${data.username} unido a sala de video ${data.roomID} - Total: ${participants.size}`,
        // );

        // Emitir lista actualizada de participantes
        this.broadcastVideoRoomParticipants(data.roomID);
    }

    /**
     * NUEVO: Handler para cuando un usuario sale de la videollamada
     */
    @SubscribeMessage('leaveVideoRoomList')
    handleLeaveListVideoRoom(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { roomID: string; username: string },
    ) {
        // console.log(
        //     `?? WS: leaveVideoRoom - Usuario: ${data.username} saliendo de sala de video: ${data.roomID}`,
        // );

        // Remover del socket room
        client.leave(data.roomID);

        // ?? Remover del tracking
        const participants = this.videoRoomParticipants.get(data.roomID);
        if (participants) {
            const participantToRemove = Array.from(participants).find(
                (p) => p.username === data.username,
            );
            if (participantToRemove) {
                participants.delete(participantToRemove);
                // console.log(
                //     `? Usuario ${data.username} removido de sala ${data.roomID} - Quedan: ${participants.size}`,
                // );

                // Si no quedan participantes, limpiar el Set
                if (participants.size === 0) {
                    this.videoRoomParticipants.delete(data.roomID);
                    // console.log(`?? Sala ${data.roomID} eliminada (sin participantes)`);
                }
            }
        }

        // Emitir lista actualizada de participantes
        this.broadcastVideoRoomParticipants(data.roomID);
    }

    /**
     * NUEVO: M�todo helper para broadcast de participantes
     */
    private broadcastVideoRoomParticipants(roomID: string) {
        const participants = this.videoRoomParticipants.get(roomID) || new Set();
        const participantsList = Array.from(participants);

        // Extraer roomCode del roomID si es grupal (formato: "group_ROOMCODE")
        let roomCode: string | null = null;
        if (roomID.startsWith('group_')) {
            roomCode = roomID.replace('group_', '');
        }

        // Emitir a todos los usuarios de la sala de video
        this.server.to(roomID).emit('videoRoomParticipantsUpdated', {
            roomID,
            roomCode,
            participants: participantsList,
        });

        // Si es un grupo, tambi�n emitir a todos los miembros del grupo
        // (incluso si no est�n en la videollamada, para que vean el banner actualizado)
        if (roomCode) {
            const roomUsers = this.roomUsers.get(roomCode);
            if (roomUsers) {
                roomUsers.forEach((username) => {
                    const user = this.users.get(username);
                    if (user && user.socket.connected) {
                        user.socket.emit('videoRoomParticipantsUpdated', {
                            roomID,
                            roomCode,
                            participants: participantsList,
                        });
                    }
                });
            }
        }

        // console.log(
        //     `?? Broadcast participantes de ${roomID}: ${participantsList.length} usuarios`,
        // );
    }

    /**
     * ?? NUEVO: Handler para fijar/desfijar mensajes en salas grupales
     */
    @SubscribeMessage('pinMessage')
    async handlePinMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        data: {
            roomCode: string;
            to?: string;
            messageId: number | null;
            isGroup: boolean;
            pinnedBy: string;
        },
    ) {
        // console.log(
        //     `?? WS: pinMessage - RoomCode: ${data.roomCode}, MessageId: ${data.messageId}, PinnedBy: ${data.pinnedBy}`,
        // );

        const { roomCode, messageId, pinnedBy, isGroup } = data;

        if (!isGroup) {
            // console.warn('?? Pin message solo est� disponible para grupos');
            return;
        }

        if (!roomCode) {
            // console.warn('?? roomCode es requerido para fijar mensajes');
            return;
        }

        try {
            // 1. Actualizar mensaje fijado en la base de datos
            await this.temporaryRoomsService.updatePinnedMessage(roomCode, messageId);

            // 2. Emitir a todos los usuarios de la sala que el mensaje fue fijado/desfijado
            const roomUsers = this.roomUsers.get(roomCode);
            if (roomUsers) {
                roomUsers.forEach((memberUsername) => {
                    const memberUser = this.users.get(memberUsername);
                    if (memberUser && memberUser.socket.connected) {
                        memberUser.socket.emit('messagePinned', {
                            roomCode,
                            messageId,
                            pinnedBy,
                        });
                    }
                });
            }

            // console.log(
            //     `? Mensaje ${messageId ? 'fijado' : 'desfijado'} en sala ${roomCode} por ${pinnedBy}`,
            // );
        } catch (error) {
            console.error('? Error al fijar mensaje:', error);
            // Notificar al cliente que hubo un error
            const userConnection = this.users.get(pinnedBy);
            if (userConnection && userConnection.socket.connected) {
                userConnection.socket.emit('pinMessageError', {
                    message: 'Error al fijar el mensaje',
                });
            }
        }
    }

    // ?? OPTIMIZADO: M�todo para limpiar conexiones hu�rfanas
    private cleanOrphanedConnections() {
        let cleaned = 0;
        for (const [username, user] of this.users.entries()) {
            if (!user.socket.connected) {
                this.users.delete(username);
                this.adminUsers.delete(username);
                // ?? OPTIMIZACI�N: Limpiar tambi�n del �ndice normalizado
                this.usernameIndex.delete(username.toLowerCase().trim());
                cleaned++;
                // console.log(`?? Limpiando conexi�n hu�rfana: ${username}`);
            }
        }
        if (cleaned > 0) {
            // console.log(`? Limpiadas ${cleaned} conexiones hu�rfanas en total`);
        }
    }

    // M�todo para limpiar cach� de usuarios expirado
    private cleanUserCache() {
        const now = Date.now();
        let cleaned = 0;
        for (const [username, cachedUser] of this.userCache.entries()) {
            if (now - cachedUser.cachedAt > this.CACHE_TTL) {
                this.userCache.delete(username);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            // console.log(
            //     `?? Limpiadas ${cleaned} entradas del cach� de usuarios (${this.userCache.size} restantes)`,
            // );
        }
    }

    // 🚀 OPTIMIZACIÓN: Método para limpiar caché de salas expirado
    private cleanRoomCache() {
        const now = Date.now();
        let cleaned = 0;
        for (const [roomCode, cached] of this.roomCache.entries()) {
            if (now - cached.cachedAt > this.ROOM_CACHE_TTL) {
                this.roomCache.delete(roomCode);
                cleaned++;
            }
        }
        // Log silencioso para no llenar logs
    }

    // M�todo para monitorear estad�sticas del sistema
    private logSystemStats() {
        const stats = {
            timestamp: new Date().toISOString(),
            connections: {
                total: this.users.size,
                admins: this.adminUsers.size,
                regular: this.users.size - this.adminUsers.size,
            },
            cache: {
                userCacheSize: this.userCache.size,
                userCacheLimit: Math.floor(this.CACHE_TTL / 60000) + ' minutos TTL',
            },
            groups: {
                total: this.groups.size,
                activeRooms: this.roomUsers.size,
            },
            memory: {
                estimatedCacheKB: Math.round((this.userCache.size * 0.1)), // ~0.1KB por usuario
            },
        };

        // console.log('?? ==================== SYSTEM STATS ====================');
        // console.log(`? Timestamp: ${stats.timestamp}`);
        // console.log(`?? Conexiones: ${stats.connections.total} total (${stats.connections.admins} admins, ${stats.connections.regular} regulares)`);
        // console.log(`?? Cach�: ${stats.cache.userCacheSize} usuarios cacheados (TTL: ${stats.cache.userCacheLimit})`);
        // console.log(`?? Grupos: ${stats.groups.total} grupos, ${stats.groups.activeRooms} salas activas`);
        // console.log(`?? Memoria estimada del cach�: ~${stats.memory.estimatedCacheKB}KB`);
        // console.log('=======================================================');
    }

    // Método público para obtener estadísticas (útil para endpoints de admin)
    public getSystemStats() {
        return {
            timestamp: new Date().toISOString(),
            connections: {
                total: this.users.size,
                admins: this.adminUsers.size,
                regular: this.users.size - this.adminUsers.size,
            },
            cache: {
                userCacheSize: this.userCache.size,
                userCacheTTL: this.CACHE_TTL,
            },
            groups: {
                total: this.groups.size,
                activeRooms: this.roomUsers.size,
            },
        };
    }

    // 🔥 NUEVO: Notificar a todos los administradores de una solicitud de ingreso
    public notifyAdminJoinRequest(roomCode: string, username: string) {
        // Emitir a todos los sockets conectados que pertenezcan a administradores
        this.adminUsers.forEach((adminData, adminUsername) => {
            if (adminData.socket?.connected) {
                adminData.socket.emit('adminJoinRequest', {
                    roomCode,
                    username,
                    timestamp: new Date().toISOString()
                });
            }
        });

        // Broadcast general a canal de admins (si existiera lógica de room 'admin')
        // this.server.to('admin-room').emit('adminJoinRequest', { roomCode, username });
    }

    // 🔥 NUEVO: Notificar al usuario que su solicitud fue aprobada
    public notifyUserApproved(roomCode: string, username: string) {
        const target = username.toLowerCase().trim();

        // Enviar evento al room personal del usuario (creado en handleRegister)
        this.server.to(target).emit('userApproved', {
            roomCode,
            username,
            message: 'Tu solicitud ha sido aprobada. Ahora puedes unirte a la sala.',
            timestamp: new Date().toISOString()
        });

        console.log(`✅ [CLUSTER] Notificación de aprobación enviada a ${username} para sala ${roomCode}`);
    }

    // 3. Notificar a usuario que fue rechazado
    public notifyUserRejected(roomCode: string, username: string) {
        const target = username.toLowerCase().trim();

        this.server.to(target).emit('joinRequestRejected', {
            roomCode,
            message: 'Tu solicitud para unirte ha sido rechazada por un administrador.',
            timestamp: new Date().toISOString()
        });

        console.log(`✅ [CLUSTER] Notificación de rechazo enviada a ${username} para sala ${roomCode}`);
    }

    // ✅ [CLUSTER] Notificación de cambio de estado de favorito
    public notifyFavoriteChanged(username: string, data: any) {
        const target = username.toLowerCase().trim();
        this.server.to(target).emit('favoriteStatusChanged', {
            ...data,
            timestamp: new Date().toISOString()
        });
        console.log(`✅ [CLUSTER] Notificación favoriteStatusChanged enviada a ${username}`);
    }

    // 🔥 NUEVO: Método robusto para obtener datos del remitente por DNI o Nombre Completo
    private async getSenderData(identifier: string): Promise<{
        username: string,
        role: string,
        numeroAgente: string,
        fullName: string,
        socketId?: string
    } | null> {
        if (!identifier) return null;
        const normalizedInput = identifier.trim();

        // 1. Intentar lookup rápido en users Map (username exacto/DNI)
        const localUser = this.users.get(normalizedInput);
        if (localUser?.userData) {
            return {
                username: normalizedInput,
                role: localUser.userData.role,
                numeroAgente: localUser.userData.numeroAgente,
                fullName: `${localUser.userData.nombre || ''} ${localUser.userData.apellido || ''}`.trim(),
                socketId: localUser.socket.id
            };
        }

        // 2. Intentar lookup en userCache (memoria local o Redis)
        const cached = this.userCache.get(normalizedInput);
        if (cached && (Date.now() - cached.cachedAt < this.CACHE_TTL)) {
            return {
                username: cached.username,
                role: cached.role,
                numeroAgente: cached.numeroAgente,
                fullName: `${cached.nombre || ''} ${cached.apellido || ''}`.trim()
            };
        }

        // 3. Buscar por Nombre Completo en el índice case-insensitive si existe (opcional)

        // 4. Búsqueda robusta en Base de Datos (Último recurso)
        try {
            let dbUser = await this.userRepository.findOne({
                where: { username: normalizedInput },
                select: ['id', 'username', 'role', 'numeroAgente', 'nombre', 'apellido']
            });

            if (!dbUser) {
                // Buscar por Nombre Completo
                dbUser = await this.userRepository.createQueryBuilder('user')
                    .where("CONCAT(user.nombre, ' ', user.apellido) = :fullName", { fullName: normalizedInput })
                    .getOne();
            }

            if (dbUser) {
                const userData = {
                    username: dbUser.username,
                    role: dbUser.role,
                    numeroAgente: dbUser.numeroAgente,
                    fullName: `${dbUser.nombre || ''} ${dbUser.apellido || ''}`.trim()
                };

                // Cachear para futuras consultas
                this.userCache.set(dbUser.username, {
                    id: dbUser.id,
                    username: dbUser.username,
                    nombre: dbUser.nombre,
                    apellido: dbUser.apellido,
                    role: dbUser.role,
                    numeroAgente: dbUser.numeroAgente,
                    cachedAt: Date.now()
                });

                if (normalizedInput !== dbUser.username) {
                    this.userCache.set(normalizedInput, {
                        id: dbUser.id,
                        username: dbUser.username,
                        nombre: dbUser.nombre,
                        apellido: dbUser.apellido,
                        role: dbUser.role,
                        numeroAgente: dbUser.numeroAgente,
                        cachedAt: Date.now()
                    });
                }

                return userData;
            }
        } catch (error) {
            console.error(`❌ Error en getSenderData para ${normalizedInput}:`, error);
        }

        return null;
    }
}
