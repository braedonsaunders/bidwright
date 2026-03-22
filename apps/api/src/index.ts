import { buildServer } from "./server";

const port = Number(process.env.API_PORT ?? "4001");

const server = buildServer();

server
  .listen({ host: "0.0.0.0", port })
  .then(() => {
    console.log(`Bidwright API listening on http://localhost:${port}`);
  })
  .catch((error) => {
    server.log.error(error);
    process.exit(1);
  });
