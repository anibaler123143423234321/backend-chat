const mysql = require('mysql2/promise');

async function main() {
    const connection = await mysql.createConnection({
        host: '198.46.186.2',
        user: 'usuarioCrm2',
        password: 'Midas*2025%',
        database: 'chat_midas'
    });

    console.log('--- DB NORMALIZATION: NAME -> DNI ---');

    // 1. Fetch all users with names
    const [users] = await connection.execute(
        'SELECT username as dni, nombre, apellido FROM chat_users WHERE nombre IS NOT NULL AND apellido IS NOT NULL'
    );

    console.log(`Found ${users.length} users to check.`);

    for (const user of users) {
        const dni = user.dni;
        const fullName = `${user.nombre} ${user.apellido}`.trim();
        if (!fullName || fullName.length < 5) continue; // Skip suspicious/empty names

        // a. Update room_favorites
        const [res1] = await connection.execute(
            'UPDATE room_favorites SET username = ? WHERE username = ?',
            [dni, fullName]
        );
        if (res1.affectedRows > 0) console.log(`[room_favorites] Migrated "${fullName}" -> ${dni} (${res1.affectedRows} rows)`);

        // b. Update conversation_favorites
        const [res2] = await connection.execute(
            'UPDATE conversation_favorites SET username = ? WHERE username = ?',
            [dni, fullName]
        );
        if (res2.affectedRows > 0) console.log(`[conversation_favorites] Migrated "${fullName}" -> ${dni} (${res2.affectedRows} rows)`);

        // c. Update recent_searches
        const [res3] = await connection.execute(
            'UPDATE recent_searches SET username = ? WHERE username = ?',
            [dni, fullName]
        );
        if (res3.affectedRows > 0) console.log(`[recent_searches] Migrated "${fullName}" -> ${dni} (${res3.affectedRows} rows)`);

        // d. Update temporary_rooms (JSON columns)
        // This is more complex since they are JSON arrays. We'll use JSON_REPLACE if possible,
        // but since we want to replace an element in an unknown position, we'll fetch and update.

        // We'll search for the name in the JSON column using LIKE
        const [rooms] = await connection.execute(
            'SELECT id, members, connectedMembers, assignedMembers FROM temporary_rooms WHERE members LIKE ? OR connectedMembers LIKE ? OR assignedMembers LIKE ?',
            [`%${fullName}%`, `%${fullName}%`, `%${fullName}%`]
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
                        const index = list.indexOf(fullName);
                        if (index !== -1) {
                            list[index] = dni;
                            // Clean up potential duplicates if both DNI and Name were there
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
                console.log(`[temporary_rooms] Updated room ID ${room.id} for user "${fullName}" -> ${dni}`);
            }
        }
    }

    console.log('\n--- NORMALIZATION COMPLETED ---');
    await connection.end();
}

main().catch(console.error);
