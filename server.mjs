import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiRouter } from "./src/http/apiRouter.mjs";
import { createStaticHandler } from "./src/http/staticFiles.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

const handleApi = createApiRouter();
const handleStatic = createStaticHandler(publicDir);

const server = createServer(async (req, res) => {
  try {
    const handled = await handleApi(req, res);
    if (!handled) await handleStatic(req, res);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
});

server.listen(port, host, () => {
  console.log(`Fund trend monitor running at http://${host}:${port}`);
});
