const mysql = require('mysql2/promise');

async function main() {
    const connection = await mysql.createConnection({
        host: '198.46.186.2',
        user: 'usuarioCrm2',
        password: 'Midas*2025%',
        database: 'chat_midas'
    });

    console.log('--- DB NORMALIZATION (PART 2): FUZZY NAME -> DNI (IDEMPOTENT) ---');

    const manualTargets = [
        { name: 'enrique v3 piscoya ferreñan', dni: '74362949' },
        { name: 'MOISES FERNANDO', dni: '73221305' },
        { name: 'MOISES MARIN TANTALEAN', dni: '73221305' },
        { name: 'SMART MASS34 (2)', dni: '74954458' }
    ];

    for (const target of manualTargets) {
        const { name, dni } = target;
        console.log(`Migrating "${name}" -> ${dni}`);

        // Update favorites (Handle duplicates)
        for (const table of ['room_favorites', 'conversation_favorites', 'recent_searches']) {
            try {
                await connection.execute(`UPDATE ${table} SET username = ? WHERE username = ?`, [dni, name]);
            } catch (e) {
                if (e.code === 'ER_DUP_ENTRY') {
                    console.log(`[${table}] Duplicate found for ${dni}, removing name-based entry "${name}"`);
                    await connection.execute(`DELETE FROM ${table} WHERE username = ?`, [name]);
                } else {
                    console.error(`Error updating ${table}:`, e.message);
                }
            }
        }

        // Update temporary_rooms (members list)
        const [rooms] = await connection.execute(
            'SELECT id, members, connectedMembers, assignedMembers FROM temporary_rooms WHERE members LIKE ? OR connectedMembers LIKE ? OR assignedMembers LIKE ?',
            [`%${name}%`, `%${name}%`, `%${name}%`]
        );

        for (const room of rooms) {
            let updated = false;
            const updateFields = {};
            ['members', 'connectedMembers', 'assignedMembers'].forEach(field => {
                let list = room[field];
                if (list) {
                    if (typeof list === 'string') {
                        try { list = JSON.parse(list); } catch (e) { list = []; }
                    }
                    if (Array.isArray(list)) {
                        const index = list.indexOf(name);
                        if (index !== -1) {
                            list[index] = dni;
                            updateFields[field] = JSON.stringify([...new Set(list)]);
                            updated = true;
                        }
                    }
                }
            });
            if (updated) {
                let updateSql = 'UPDATE temporary_rooms SET ';
                const params = [];
                const entries = Object.entries(updateFields);
                updateSql += entries.map(([k, v]) => `${k} = ?`).join(', ');
                updateSql += ' WHERE id = ?';
                params.push(...entries.map(([k, v]) => v), room.id);
                await connection.execute(updateSql, params);
                console.log(`[temporary_rooms] Updated room ID ${room.id} for "${name}" -> ${dni}`);
            }
        }
    }

    console.log('\n--- NORMALIZATION PART 2 COMPLETED ---');
    await connection.end();
}

main().catch(console.error);
