
const mysql = require('mysql2/promise');
require('dotenv').config();

async function finalInvestigate() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        port: process.env.DB_PORT
    });

    const identifiers = ["10203010", "JEAR CHRISTIAN CAMPOVERDE CUNYA", "76354306"];
    const ids = [8, 341, 461];

    const [rooms] = await connection.execute("SELECT id, name, members, assignedMembers FROM temporary_rooms WHERE isActive = 1");

    console.log('--- Salas encontradas para JEAR CHRISTIAN (Búsqueda exhaustiva) ---');
    rooms.forEach(r => {
        const m = r.members || '';
        const a = r.assignedMembers || '';
        const matchedIdent = identifiers.find(ident => m.includes(ident) || a.includes(ident));
        const matchedId = ids.find(id => m.includes(`\"${id}\"`) || m.includes(String(id)));

        if (matchedIdent || matchedId) {
            console.log(`Sala [${r.id}]: ${r.name}`);
            if (matchedIdent) console.log(`   - Coincidencia por Username: ${matchedIdent}`);
            if (matchedId) console.log(`   - Coincidencia por ID: ${matchedId}`);
            console.log(`   - Members Raw: ${m}`);
        }
    });

    await connection.end();
}

finalInvestigate().catch(console.error);
