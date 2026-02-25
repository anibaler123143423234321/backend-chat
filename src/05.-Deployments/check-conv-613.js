const http = require('http');

http.get('http://localhost:8747/api/temporary-conversations/assigned/list?username=73583958', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const list = JSON.parse(data);
        const conv = list.conversations.find(c => c.id === 613);
        console.log(JSON.stringify(conv, null, 2));
    });
});
