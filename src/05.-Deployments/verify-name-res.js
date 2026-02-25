const mysql = require('mysql2/promise');

async function testResolution() {
    const connection = await mysql.createConnection({
        host: '198.46.186.2',
        user: 'usuarioCrm2',
        password: 'Midas*2025%',
        database: 'chat_midas'
    });

    const namesToTest = [
        'ELCIRA MARITZA GARCIA CASTRO',
        'MOISES MARIN TANTALEAN'
    ];

    console.log('--- Testing Fuzzy Name to DNI Resolution ---');

    for (const name of namesToTest) {
        const trimmed = name.trim();
        const words = trimmed.split(/\s+/);
        const pattern = `%${words.join('%')}%`;

        const [rows] = await connection.execute(
            "SELECT username, nombre, apellido FROM chat_users WHERE CONCAT(nombre, ' ', apellido) = ? OR CONCAT(nombre, ' ', apellido) LIKE ?",
            [trimmed, pattern]
        );

        if (rows.length > 0) {
            console.log(`\nPASS for "${name}":`);
            rows.forEach(r => console.log(` - ${r.nombre} ${r.apellido} (DNI: ${r.username})`));

            const dni = rows[0].username;
            const [rooms] = await connection.execute(
                "SELECT id, name FROM temporary_rooms WHERE members LIKE ? OR connectedMembers LIKE ? OR assignedMembers LIKE ?",
                [`%${dni}%`, `%${dni}%`, `%${dni}%`]
            );
            console.log(`Rooms found for first match (${dni}): ${rooms.length}`);
        } else {
            console.log(`\nFAIL: Could not resolve "${name}" to any DNI`);
        }
    }

    await connection.end();
}

testResolution().catch(console.error);
