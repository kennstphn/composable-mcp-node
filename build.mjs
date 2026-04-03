import 'dotenv/config';
import { build_dist } from './src/functions/build_dist.mjs';
import {join} from 'path';
const BUILD_DIRECTORY = join(import.meta.dirname, 'dist');

build_dist({ $env: process.env }).then(() => {
    console.log('Build complete. Build directory:', BUILD_DIRECTORY);
}).catch((err) => {
    console.error('Build failed:', err);
});

