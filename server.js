import "dotenv/config";
import { createApp } from "./app.js";
import { getNumberEnv } from "./services/env.js";

const app = createApp();
const port = getNumberEnv("PORT", { defaultValue: 3000 });

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
