import 'dotenv/config';
import { App } from './src/App.mjs';

const REQUIRED_ENV_VARS = ['DIRECTUS_BASE_URL'];

const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

(new App({
  PORT: process.env.PORT || 8787,
  DIRECTUS_BASE_URL: process.env.DIRECTUS_BASE_URL,
  NODE_ENV: process.env.NODE_ENV,
})).listen();

