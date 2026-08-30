import { createApp } from "./app.js";

const port = Number(process.env.VISUAL_OFFICE_PORT ?? 4100);
const app = createApp({ serveStatic: process.env.NODE_ENV === "production" });
await app.listen({ host: "127.0.0.1", port });
console.log(`Visual Office listening on http://127.0.0.1:${port}`);
