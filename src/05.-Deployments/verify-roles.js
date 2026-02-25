const mysql = require('mysql2/promise');

async function main() {
    const connection = await mysql.createConnection({
        host: '198.46.186.2',
        user: 'usuarioCrm2',
        password: 'Midas*2025%',
        database: 'chat_midas'
    });

    // Get room members
    const [rooms] = await connection.execute(
        'SELECT members FROM temporary_rooms WHERE roomCode = ?',
        ['AB26587A']
    );

    if (rooms.length === 0) {
        console.log('Room not found');
        await connection.end();
        return;
    }

    const members = rooms[0].members;
    console.log('Resolving roles for members:', members);

    for (const member of members) {
        // Check by username (DNI)
        const [dniUsers] = await connection.execute(
            'SELECT id, username, role, nombre, apellido FROM chat_users WHERE username = ?',
            [member]
        );

        if (dniUsers.length > 0) {
            console.log(`✅ ${member} found by DNI: role=${dniUsers[0].role}`);
        } else if (member.includes(' ')) {
            // Try by full name
            const name = member.trim().toLowerCase();
            const [nameUsers] = await connection.execute(
                "SELECT id, username, role, nombre, apellido FROM chat_users WHERE LOWER(TRIM(CONCAT(IFNULL(nombre, ''), ' ', IFNULL(apellido, '')))) = ?",
                [name]
            );

            if (nameUsers.length > 0) {
                console.log(`✅ ${member} found by Name: role=${nameUsers[0].role} (User: ${nameUsers[0].username})`);
            } else {
                // Try Like fallback
                const [approxUsers] = await connection.execute(
                    "SELECT id, username, role, nombre, apellido FROM chat_users WHERE LOWER(CONCAT(nombre, ' ', apellido)) LIKE ?",
                    [`%${name}%`]
                );
                if (approxUsers.length > 0) {
                    console.log(`✅ ${member} found by Approx Name: role=${approxUsers[0].role} (User: ${approxUsers[0].username})`);
                } else {
                    console.log(`❌ ${member} NOT FOUND`);
                }
            }
        } else {
            console.log(`❌ ${member} NOT FOUND (DNI/Username)`);
        }
    }

    await connection.end();
}

main().catch(console.error);
