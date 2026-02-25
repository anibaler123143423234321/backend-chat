
const mysql = require('mysql2/promise');
require('dotenv').config();

async function deepInvestigate(dni) {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        port: process.env.DB_PORT
    });

    console.log(`--- Investigando Usuario: ${dni} ---`);

    // 1. Buscar todos los usuarios con ese username
    const [users] = await connection.execute("SELECT * FROM chat_users WHERE username = ?", [dni]);
    console.log(`Se encontraron ${users.length} registros para el username ${dni}`);

    users.forEach(u => {
        console.log(`ID: ${u.id}, Nombre: ${u.nombre} ${u.apellido}, Email: ${u.email}, Role: ${u.role}`);
    });

    const ids = users.map(u => u.id);
    const names = users.map(u => `${u.nombre} ${u.apellido}`.trim());

    // 2. Buscar en temporary_rooms por DNI, Nombre o ID (como string)
    const [rooms] = await connection.execute("SELECT id, name, members, assignedMembers, connectedMembers FROM temporary_rooms WHERE isActive = 1");
    const matchingRooms = rooms.filter(r => {
        const allFields = (r.members || '') + (r.assignedMembers || '') + (r.connectedMembers || '');
        return ids.some(id => allFields.includes(`\"${id}\"`) || allFields.includes(String(id))) ||
            names.some(name => allFields.includes(name)) ||
            allFields.includes(dni);
    });

    console.log('\nSalas grupales donde aparece el DNI, Nombre o algún ID:', matchingRooms.length);
    matchingRooms.forEach(r => console.log(` - Sala [${r.id}]: ${r.name} | Members: ${r.members}`));

    // 3. Buscar en temporary_conversations
    const [convs] = await connection.execute("SELECT id, name, participants FROM temporary_conversations WHERE isActive = 1");
    const matchingConvs = convs.filter(c => {
        const p = (c.participants || '');
        return ids.some(id => p.includes(`\"${id}\"`) || p.includes(String(id))) ||
            names.some(name => p.includes(name)) ||
            p.includes(dni);
    });

    console.log('\nConversaciones asignadas donde aparece el DNI, Nombre o algún ID:', matchingConvs.length);
    matchingConvs.forEach(c => console.log(` - Conv [${c.id}]: ${c.name} | Participants: ${c.participants}`));

    await connection.end();
}

deepInvestigate("76354306").catch(console.error);
