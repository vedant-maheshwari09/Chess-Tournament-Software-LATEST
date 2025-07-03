import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { storage } from './storage';
import type { User, Session } from '@shared/schema';

// Generate secure session token
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Hash password
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

// Verify password
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

// Create session with expiration (7 days)
export async function createSession(userId: number): Promise<Session> {
  const token = generateSessionToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now
  
  return storage.createSession(userId, token, expiresAt);
}

// Authentication middleware
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Authorization token required' });
    }
    
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const session = await storage.getSessionByToken(token);
    
    if (!session) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }
    
    // Check if session is expired
    if (new Date() > session.expiresAt) {
      await storage.deleteSession(token);
      return res.status(401).json({ message: 'Session expired' });
    }
    
    // Get user details
    const user = await storage.getUserById(session.userId);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    // Add user to request object
    (req as any).user = user;
    (req as any).session = session;
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ message: 'Authentication error' });
  }
}

// Role-based middleware
export function requireRole(role: 'player' | 'tournament_director') {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as User;
    
    if (!user) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    if (user.role !== role) {
      return res.status(403).json({ message: `${role} role required` });
    }
    
    next();
  };
}

// Tournament director or owner middleware
export async function requireTournamentAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user as User;
    const tournamentId = parseInt(req.params.id || req.params.tournamentId);
    
    if (!user) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    if (isNaN(tournamentId)) {
      return res.status(400).json({ message: 'Invalid tournament ID' });
    }
    
    // Tournament directors can access tournaments they created
    if (user.role === 'tournament_director') {
      const tournament = await storage.getTournament(tournamentId);
      
      if (!tournament) {
        return res.status(404).json({ message: 'Tournament not found' });
      }
      
      if (tournament.createdBy === user.id) {
        return next(); // User owns this tournament
      }
    }
    
    return res.status(403).json({ message: 'Access denied to this tournament' });
  } catch (error) {
    console.error('Tournament access middleware error:', error);
    res.status(500).json({ message: 'Authorization error' });
  }
}