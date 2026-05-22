import "dotenv/config";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildApp({ config });

await app.listen({ host: config.host, port: config.port });
console.log(`wechat-web BFF listening on http://${config.host}:${config.port}`);
