
import { generateToken } from '../src/token.js';
import http from 'http';
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const userId = 'SOF050'; // Assuming this user exists
const token = generateToken(userId);

console.log(`Generated token for ${userId}`);

const options = {
    hostname: 'localhost',
    port: 5070,
    path: '/api/user/nhan-vien',
    method: 'GET',
    headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
    }
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        try {
            const users = JSON.parse(data);
            console.log(`Total users returned: ${users.length}`);
            users.forEach(u => {
                console.log(`- ${u.maNhanVien} ${u.tenNhanVien} (userId: ${u.userId})`);
            });
        } catch (e) {
            console.log('Response body:', data);
        }
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.end();
