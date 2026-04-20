import type { Express } from "express";
import { createServer, type Server } from "http";
import { applyAuthRoutes } from "./routes/auth";
import { applyTournamentsRoutes } from "./routes/tournaments";
import { applyPaymentsRoutes } from "./routes/payments";
import { applyNotificationsRoutes } from "./routes/notifications";
import { applyPairingsRoutes } from "./routes/pairings";
import { applyArenaRoutes } from "./routes/arena";

export async function registerRoutes(app: Express): Promise<Server> {
  // Apply modular routers
  applyAuthRoutes(app);
  applyTournamentsRoutes(app);
  applyPaymentsRoutes(app);
  applyNotificationsRoutes(app);
  applyPairingsRoutes(app);
  applyArenaRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}
