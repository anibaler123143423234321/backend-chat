const http = require('http');

const roomCode = 'TEST_ROOM_' + Date.now();
const testUser = '73583958'; // Karen's DNI
const testNameOld = 'KAREN CONDEMARIN BURGA';
const testNameNew = 'KAREN FATIMA CONDEMARIN BURGA';

async function request(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 8747,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function runTest() {
    try {
        console.log('1. Creating test room...');
        await request('/api/temporary-rooms', 'POST', {
            name: 'Test Room Removal',
            roomCode: roomCode,
            maxCapacity: 10,
            creatorUsername: 'Admin'
        });

        console.log('2. Adding user with OLD name directly...');
        await request(`/api/temporary-rooms/${roomCode}/add-user`, 'POST', {
            username: testNameOld
        });

        console.log('3. Verifying members (Old name should be there)...');
        let state = await request(`/api/temporary-rooms/code/${roomCode}`);
        console.log('Members:', state.members);

        console.log('4. Removing user using NEW name (Alias check)...');
        await request(`/api/temporary-rooms/${roomCode}/remove-user`, 'POST', {
            username: testNameNew,
            removedBy: 'Test Script'
        });

        console.log('5. Verifying members (Both names should be gone)...');
        state = await request(`/api/temporary-rooms/code/${roomCode}`);
        console.log('Final Members:', state.members);

        if (state.members && !state.members.includes(testNameOld) && !state.members.includes(testNameNew)) {
            console.log('✅ SUCCESS: Intelligent removal worked!');
        } else {
            console.log('❌ FAILURE: User still in members list');
        }

    } catch (e) {
        console.error('Test error:', e.message);
    }
}

runTest();
