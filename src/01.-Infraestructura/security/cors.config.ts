import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

export const corsConfig: CorsOptions = {
    origin: [
        'http://localhost:3005',
        'http://localhost:5173',
        'https://apisozarusac.com',
        'https://apisozarusac.com/BackendJava',
        'https://apisozarusac.com/BackendJavaMidas',
        'https://apisozarusac.com/BackendChat',
        'https://chat.mass34.com',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
};
