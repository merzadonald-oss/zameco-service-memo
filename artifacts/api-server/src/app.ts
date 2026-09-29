import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttpImport from "pino-http";
import type { IncomingMessage, ServerResponse } from "http";
import router from "./routes";
import { logger } from "./lib/logger";

const pinoHttp = pinoHttpImport as unknown as (
  opts?: Record<string, unknown>,
) => import("express").RequestHandler;

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req: IncomingMessage & { id?: string | number }) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: ServerResponse) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Optional password gate. When APP_PASSWORD is set, every request (website and
// API) must carry it via standard HTTP Basic auth: the browser shows a login
// prompt once and then resends the credentials automatically. Any username is
// accepted; only the password is checked. When APP_PASSWORD is not set, the
// app is open (useful for local development).
const appPassword = process.env["APP_PASSWORD"];
if (appPassword) {
  const expected = crypto.createHash("sha256").update(appPassword).digest();
  app.use((req, res, next) => {
    const header = req.headers.authorization ?? "";
    if (header.startsWith("Basic ")) {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const supplied = decoded.slice(decoded.indexOf(":") + 1);
      const suppliedHash = crypto.createHash("sha256").update(supplied).digest();
      if (crypto.timingSafeEqual(expected, suppliedHash)) {
        next();
        return;
      }
    }
    res.set("WWW-Authenticate", 'Basic realm="ZAMECO Service Memo", charset="UTF-8"');
    res.status(401).send("Authentication required");
  });
}

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);


// Serve the built website from the same server when STATIC_DIR points at it.
// Unknown non-API GET paths fall back to index.html so client-side routes
// (e.g. /history, /settings) work on refresh.
const staticDir = process.env["STATIC_DIR"] ? path.resolve(process.env["STATIC_DIR"]) : null;
if (staticDir && fs.existsSync(path.join(staticDir, "index.html"))) {
  app.use(express.static(staticDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

export default app;
