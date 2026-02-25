const mysql = require('mysql2/promise');

async function main() {
    const connection = await mysql.createConnection({
        host: '198.46.186.2',
        user: 'usuarioCrm2',
        password: 'Midas*2025%',
        database: 'chat_midas'
    });

    console.log('--- DB NORMALIZATION (FINAL PUSH) ---');

    const targets = [
        { name: 'enrique v3 piscoya ferreñan', dni: '74362949' },
        { name: 'SMART MASS34 (2)', dni: '74954458' }
    ];

    for (const t of targets) {
        await connection.execute('UPDATE room_favorites SET username = ? WHERE username = ?', [t.dni, t.name]).catch(() => { });
        await connection.execute('UPDATE conversation_favorites SET username = ? WHERE username = ?', [t.dni, t.name]).catch(() => { });
        await connection.execute('UPDATE recent_searches SET username = ? WHERE username = ?', [t.dni, t.name]).catch(() => { });

        // Specific delete if update failed (usually due to duplicate)
        await connection.execute('DELETE FROM room_favorites WHERE username = ?', [t.name]).catch(() => { });
        await connection.execute('DELETE FROM conversation_favorites WHERE username = ?', [t.name]).catch(() => { });
        await connection.execute('DELETE FROM recent_searches WHERE username = ?', [t.name]).catch(() => { });

        console.log(`Final push for "${t.name}" -> ${t.dni} done.`);
    }

    await connection.end();
}
main();
