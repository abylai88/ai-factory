import { createApp } from "./app.js";
const app = createApp();
await app.listen({ host: "127.0.0.1", port: Number(process.env.VISUAL_OFFICE_PORT ?? 4100) });
