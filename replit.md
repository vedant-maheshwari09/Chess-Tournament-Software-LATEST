# ChessTournament Pro - Replit.md

## Overview

ChessTournament Pro is a comprehensive chess tournament management system built with a modern full-stack architecture. The application provides a complete solution for organizing, managing, and tracking chess tournaments with support for multiple tournament formats including Swiss, Round Robin, and Knockout systems.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Styling**: Tailwind CSS with shadcn/ui component library
- **State Management**: TanStack Query (React Query) for server state management
- **Routing**: Wouter for lightweight client-side routing
- **Build Tool**: Vite for fast development and optimized production builds
- **UI Philosophy**: Modern, responsive design with accessibility-first components

### Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **Database**: PostgreSQL with Drizzle ORM
- **Database Provider**: Neon Database (serverless PostgreSQL)
- **API Design**: RESTful API with JSON responses
- **Development Setup**: Hot reload with Vite middleware integration

### Monorepo Structure
- **Client**: React frontend application (`/client`)
- **Server**: Express backend API (`/server`)
- **Shared**: Common TypeScript types and schemas (`/shared`)
- **Database**: Drizzle schema definitions and migrations

## Key Components

### Database Schema
- **Tournaments**: Core tournament entity with format, status, and settings
- **Players**: Tournament participants with ratings and federation info
- **Matches**: Individual game records with results and board assignments
- **Pairings**: Round-by-round player pairings with color assignments and bye handling

### Tournament Management
- **Tournament Creation Wizard**: Step-by-step tournament setup
- **Player Registration**: Bulk and individual player management
- **Multiple Formats**: Swiss system, Round Robin, and Knockout tournaments
- **Pairing Engine**: Automated pairing generation with Swiss system algorithms

### User Interface Components
- **Dashboard**: Tournament overview and management interface
- **Swiss Pairings**: Real-time pairing generation and management
- **Knockout Bracket**: Visual tournament bracket display
- **Standings**: Live tournament standings with scoring
- **Player Management**: Registration and player database

## Data Flow

1. **Tournament Creation**: User creates tournament through wizard → Stored in database
2. **Player Registration**: Players added individually or in bulk → Linked to tournament
3. **Pairing Generation**: Swiss algorithm generates optimal pairings → Creates matches
4. **Result Entry**: Match results recorded → Updates player standings
5. **Real-time Updates**: TanStack Query provides live data synchronization

## External Dependencies

### Core Dependencies
- **@neondatabase/serverless**: Serverless PostgreSQL connection
- **drizzle-orm**: Type-safe database ORM
- **@tanstack/react-query**: Server state management
- **@radix-ui/***: Accessible UI primitives
- **wouter**: Lightweight routing library

### Development Tools
- **Vite**: Build tool and development server
- **TypeScript**: Type safety and development experience
- **Tailwind CSS**: Utility-first CSS framework
- **ESBuild**: Fast JavaScript bundler for production

## Deployment Strategy

### Development Environment
- **Hot Reload**: Vite middleware integration with Express
- **Type Checking**: Continuous TypeScript compilation
- **Database**: Drizzle migrations with push command

### Production Build
- **Frontend**: Vite builds optimized static assets
- **Backend**: ESBuild bundles server code for Node.js
- **Database**: Environment-based PostgreSQL connection
- **Deployment**: Single-artifact deployment with static file serving

### Environment Configuration
- **DATABASE_URL**: PostgreSQL connection string (required)
- **NODE_ENV**: Environment mode (development/production)
- **Build Targets**: ESM modules for modern Node.js runtime

## Changelog

```
Changelog:
- June 29, 2025. Initial setup
- June 29, 2025. Added PostgreSQL database integration with Drizzle ORM
- June 29, 2025. Implemented comprehensive USCF bye management system
  - Added database schema for bye requests and player bye tracking
  - Implemented full-point and half-point bye rules according to USCF standards
  - Enhanced Swiss pairing algorithm with proper bye assignment logic
  - Added API endpoints for bye request management
- June 29, 2025. Fixed critical tournament director functionality
  - Corrected bye handling: Half-point byes for odd players (not full-point)
  - Added round completion validation - prevents next round without results
  - Implemented proper regeneration vs. next round generation
  - Fixed standings calculation to include bye points from pairings table
  - Enhanced professional tournament director interface with status indicators
  - Added clear match completion tracking and USCF rule compliance
- June 29, 2025. Enhanced USCF Swiss system features for tournament directors
  - Implemented high-rated player color alternation in first rounds (USCF Rule)
  - Added automatic standings updates after every round completion
  - Implemented board ordering by combined player points (top boards = highest points)
  - Added player points display in brackets next to names in pairings
  - Enhanced cache invalidation for real-time tournament data updates
  - Improved tournament creation: rounds selection from 3-20, removed time control field
- June 30, 2025. Implemented comprehensive user authentication and role-based access system
  - Added user registration/login with username, email, password, and role selection
  - Implemented secure session management with JWT-like tokens and password hashing
  - Created role-based access: Tournament Directors vs Players with different dashboards
  - Tournament Directors: can create/manage their own tournaments with full access
  - Players: can view live tournaments, standings, and pairings (read-only access)
  - Enhanced API security with protected routes and ownership validation
  - Rebuilt application architecture around authentication-first user experience
- June 30, 2025. Enhanced player dashboard with live tournament selection and unique account validation
  - Added live tournament list view for players to browse available events
  - Implemented tournament selection system: players click to view specific tournament details
  - Created tabbed interface showing live standings, pairings, and brackets for selected tournaments
  - Added unique username and email validation: no duplicates allowed across accounts
  - Enhanced error messages for registration conflicts with clear guidance for users
- June 30, 2025. Implemented comprehensive mid-tournament player status management system
  - Added player withdrawal functionality: players appear in standings but get zero-point byes for future rounds
  - Implemented player reactivation: withdrawn players can rejoin and return to active status
  - Created flexible bye request system for specific upcoming rounds with half-point or zero-point options
  - Enhanced Swiss pairing algorithm to automatically exclude withdrawn players from future pairings
  - Added intelligent status detection: dialog shows current player status (active vs withdrawn)
  - Tournament directors can now manage player status changes throughout the tournament lifecycle
  - Enhanced complete bye management: add and remove individual bye requests with visual interface
- June 30, 2025. Improved Swiss color assignment algorithm for proper USCF compliance
  - Fixed color alternation when both players had same color in previous round
  - Implemented USCF rule: lower-rated player gets same color again, higher-rated alternates
  - Enhanced color balance calculations to handle edge cases with equal balances
  - Strengthened color assignment priority: due colors → alternation needs → rating tiebreakers
- June 30, 2025. Fixed comprehensive bye points calculation and automatic bye assignment
  - Fixed integer mapping for bye points storage (0=0pts, 1=0.5pts, 2=1pt) throughout system
  - Corrected standings to only show points for completed/current rounds, not future byes
  - Enhanced pairings display to show points before each round (Round 1 shows [0], etc.)
  - Fixed automatic bye assignment to include existing bye points in player scoring
  - Clarified bye types: 1/2 Point Bye (temporary skip) vs 0 Point Bye (withdrawal)
- June 30, 2025. Separated player withdrawal from individual bye requests
  - Fixed critical bug where adding 0-point bye incorrectly withdrew players
  - Implemented proper separation: player status (active/withdrawn) vs individual bye requests
  - Enhanced bye display logic to show "½ Point Bye", "0 Point Bye", and "1 Point Bye" correctly
  - Tournament directors can now add specific round byes without changing player status
  - Withdrawal remains separate action requiring explicit status change from active to withdrawn
- June 30, 2025. Fixed Swiss pairing algorithm to properly handle explicit bye requests
  - Corrected filtering logic to exclude withdrawn players AND players with round-specific bye requests
  - Implemented proper automatic bye assignment: lowest-rated active player gets 1-point bye when odd numbers
  - Fixed USCF compliance: respects explicit bye requests while giving automatic byes to remaining odd player
  - Enhanced pairing generation to distinguish between withdrawal byes vs requested byes vs automatic byes
- July 3, 2025. Implemented comprehensive Round Robin tournament format with complete pre-made scheduling
  - Created Round Robin pairing algorithm using rotation method for all tournament rounds
  - All pairings for all rounds generated automatically when tournament starts (e.g., 4 players = 3 rounds)
  - Built Round Robin crosstable component displaying head-to-head results matrix with player rankings
  - Enhanced tournament pairings component to support both Swiss and Round Robin formats
  - Added proper Round Robin display: crown symbols for self-matches, color-coded results (1, ½, 0)
  - Hidden Swiss-specific controls (Generate Next Round, Repair) for Round Robin tournaments
  - Updated both tournament director and player interfaces to show Round Robin crosstables
- July 2, 2025. Implemented comprehensive tournament history and change tracking system
  - Added tournament_history database table to track all tournament modifications with complete audit trail
  - Created automatic history logging for match result changes with before/after state preservation
  - Implemented pairing generation and regeneration tracking with detailed metadata storage
  - Built tournament history UI component with detailed change viewing and revert capabilities
  - Enhanced tournament director interface with dedicated History tab showing chronological change timeline
  - Added visual change indicators with action-specific badges and icons for better change identification
- July 3, 2025. Enhanced Round Robin tournament system with complete pre-generation and crosstable display
  - Fixed Round Robin pairing generation to create all rounds when tournament starts instead of round-by-round
  - Enhanced pairings display to show all Round Robin rounds organized by round with status badges
  - Updated tournament controls to hide Swiss-specific buttons (Generate Next Round, Repair) for Round Robin
  - Improved Round Robin crosstable with forfeit result support (X=win by forfeit, F=loss by forfeit)
  - Added proper Round Robin workflow: complete schedule generated at tournament start, not per round
  - Enhanced format-specific displays: Round Robin shows all rounds, Swiss shows current round only
- July 4, 2025. Implemented Houseplayer (TD) functionality and undo swap feature
  - Added houseplayer designation: only one houseplayer per tournament, plays when odd players create "See T.D." pairing
  - Enhanced player registration with houseplayer checkbox and automatic deactivation of previous houseplayer
  - Updated Swiss standings to show "TD" for houseplayer in opponent columns
  - Houseplayers display as "(substitute player)" in both pairings and standings for clear identification
  - Implemented player swap undo functionality with 30-second expiration timer
  - Added "Undo Swap" button that appears after manual pairing adjustments for improved tournament management
- July 4, 2025. Added late-joining player notation in Swiss standings
  - Implemented "U" (Unplayed) notation for players who joined after tournament started
  - Shows "U" followed by points they had at that round (e.g., "U0", "U1.5") 
  - Automatically detects when player has no match or pairing record for early rounds
  - Distinguished from withdrawals and byes to show proper tournament history notation
```

## User Preferences

```
Preferred communication style: Simple, everyday language.
```