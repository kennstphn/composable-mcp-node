import 'dotenv/config';
import { build_dist } from './src/functions/build_dist.mjs';

build_dist({ $env: process.env });
