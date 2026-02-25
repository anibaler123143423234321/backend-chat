const mysql = require('mysql2/promise');

async function main() {
    const connection = await mysql.createConnection({
        host: '198.46.186.2',
        user: 'usuarioCrm2',
        password: 'Midas*2025%',
        database: 'chat_midas'
    });

    console.log('--- TEST: DNI vs NAME INTEROPERABILITY ---');

    // 1. Resolve User (Elcira)
    const [userResult] = await connection.execute(
        'SELECT username, nombre, apellido FROM chat_users WHERE nombre LIKE "%ELCIRA%" AND apellido LIKE "%GARCIA%"'
    );

    if (userResult.length === 0) {
        console.log('User Elcira not found in DB');
        await connection.end();
        return;
    }

    const dni = userResult[0].username;
    const fullName = `${userResult[0].nombre} ${userResult[0].apellido}`.trim();
    console.log(`User: ${dni} -> Name: "${fullName}"`);

    // 2. SEARCH TEST: findUserRooms logic simulation
    // Case: User is in members as Name, we search by DNI (simulated by OR Name in SQL)
    const [roomsByDniOrName] = await connection.execute(
        'SELECT roomCode, name, members FROM temporary_rooms WHERE isActive = 1 AND (members LIKE ? OR members LIKE ?)',
        [`%${dni}%`, `%${fullName}%`]
    );

    console.log(`\nRooms found by DNI (${dni}) OR Name ("${fullName}"): ${roomsByDniOrName.length}`);
    roomsByDniOrName.forEach(r => console.log(` - ${r.roomCode}: ${r.name}`));

    // 3. MEMBERSHIP TEST: Detect duplicates logic simulation
    const targetRoom = 'AB26587A';
    const [roomData] = await connection.execute(
        'SELECT members FROM temporary_rooms WHERE roomCode = ?',
        [targetRoom]
    );

    if (roomData.length > 0) {
        const members = JSON.parse(JSON.stringify(roomData[0].members)); // Just to be sure of type
        const membersStr = Array.isArray(members) ? members : JSON.parse(members || '[]');

        const isMemberByDni = membersStr.includes(dni);
        const isMemberByName = membersStr.includes(fullName);

        console.log(`\nMembership check for Room ${targetRoom}:`);
        console.log(` - Members list includes:`, membersStr);
        console.log(` - Is member by DNI (${dni})? ${isMemberByDni}`);
        console.log(` - Is member by Name ("${fullName}")? ${isMemberByName}`);
        console.log(` - Standardized check (DNI OR Name): ${isMemberByDni || isMemberByName}`);
    }

    await connection.end();
}

main().catch(console.error);
