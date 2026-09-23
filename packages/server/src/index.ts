import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../../client/dist');
const staticDir = fs.existsSync(path.join(clientDist, 'index.html')) ? clientDist : null;

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const app = createApp({ staticDir });

app.server.listen(PORT, () => {
  const what = staticDir ? 'game + relay' : 'relay only (client not built)';
  console.log(`8-ball pool ${what} on :${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
