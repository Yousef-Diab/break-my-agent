import { createApp } from "./app.ts";

const app = createApp();
try {
  await app.listen({ host: "127.0.0.1", port: 4318 });
  console.log("Credit API ready at http://127.0.0.1:4318");
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Could not start the credit API.",
  );
  process.exitCode = 1;
}
