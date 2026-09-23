import express, { type Express } from "express";
import cors from "cors";
import pinoHttpImport from "pino-http";
const pinoHttp = pinoHttpImport as unknown as (opts?: Record<string, unknown>) => import("express").RequestHandler;
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
