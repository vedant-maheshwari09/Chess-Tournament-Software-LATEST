import type { User, Session } from "@shared/schema";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      session?: Session;
    }
  }
}

export {};
