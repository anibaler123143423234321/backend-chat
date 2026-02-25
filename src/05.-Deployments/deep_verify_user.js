
const mysql = require('mysql2/promise');
require('dotenv').config();

async function verifyUser(dni, name) {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        port: process.env.DB_PORT
    });

    console.log(`--- Verificando Usuario: ${dni} (${name}) ---`);

    // 1. Verificar existencia del usuario
    const [userRows] = await connection.execute("SELECT * FROM chat_users WHERE username = ?", [dni]);
    if (userRows.length > 0) {
        console.log('Registro en tabla usuarios: ENCONTRADO');
        console.log('ID:', userRows[0].id, 'Role:', userRows[0].role);
        const dbName = `${userRows[0].nombre} ${userRows[0].apellido}`;
        console.log('Nombre Completo en DB:', dbName);
    } else {
        console.log('Registro en tabla usuarios: NO ENCONTRADO');
    }

    // 2. Buscar en temporary_rooms (Salas)
    const [rooms] = await connection.execute("SELECT id, name, members, assignedMembers, connectedMembers FROM temporary_rooms WHERE isActive = 1");
    const matchingRooms = rooms.filter(r => {
        const m = (r.members || '');
        const a = (r.assignedMembers || '');
        const c = (r.connectedMembers || '');
        return m.includes(dni) || m.includes(name) || a.includes(dni) || a.includes(name) || c.includes(dni) || c.includes(name);
    });
    console.log('Salas grupales encontradas:', matchingRooms.length);
    matchingRooms.forEach(r => console.log(` - Sala [${r.id}]: ${r.name} (Members: ${r.members})`));

    // 3. Buscar en temporary_conversations (Chats asignados)
    const [convs] = await connection.execute("SELECT id, name, participants FROM temporary_conversations WHERE isActive = 1");
    const matchingConvs = convs.filter(c => {
        const p = (c.participants || '');
        return p.includes(dni) || p.includes(name);
    });
    console.log('Conversaciones asignadas encontradas:', matchingConvs.length);
    matchingConvs.forEach(c => console.log(` - Conv [${c.id}]: ${c.name} (Participants: ${c.participants})`));

    await connection.end();
}

const dni = "76354306";
const name = "JEAR CHRISTIAN CAMPOVERDE CUNYA";
verifyUser(dni, name).catch(console.error);
