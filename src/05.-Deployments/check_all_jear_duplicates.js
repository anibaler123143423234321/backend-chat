
const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkAllDuplicates() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        port: process.env.DB_PORT
    });

    const identifiers = ["10203010", "JEAR CHRISTIAN CAMPOVERDE CUNYA", "76354306"];
    const ids = [8, 341, 461];

    console.log('--- Verificando asignaciones para todos los identificadores posibles ---');

    // Rooms
    const [rooms] = await connection.execute("SELECT id, name, members, assignedMembers FROM temporary_rooms WHERE isActive = 1");
    const matchingRooms = rooms.filter(r => {
        const all = (r.members || '') + (r.assignedMembers || '');
        return identifiers.some(ident => all.includes(ident)) || ids.some(id => all.includes(`\"${id}\"`) || all.includes(String(id)));
    });

    console.log('\nSalas encontradas:', matchingRooms.length);
    matchingRooms.forEach(r => console.log(` - Sala [${r.id}]: ${r.name} | Members: ${r.members}`));

    // Conversations
    const [convs] = await connection.execute("SELECT id, name, participants FROM temporary_conversations WHERE isActive = 1");
    const matchingConvs = convs.filter(c => {
        const p = (c.participants || '');
        return identifiers.some(ident => p.includes(ident)) || ids.some(id => p.includes(`\"${id}\"`) || p.includes(String(id)));
    });

    console.log('\nConversaciones encontradas:', matchingConvs.length);
    matchingConvs.forEach(c => console.log(` - Conv [${c.id}]: ${c.name} | Participants: ${c.participants}`));

    await connection.end();
}

checkAllDuplicates().catch(console.error);
