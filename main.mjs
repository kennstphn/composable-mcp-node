import {App} from 'src/app.mjs';

(new App({
  PORT:8787
  DIRECTUS_BASE_URL=process.env.DIRECTUS_BASE_URL,
  NODE_ENV:process.env.NODE_ENV,
  DIRECTUS_TOKEN:process.env.DIRECTUS_TOKEN
}).listen();
