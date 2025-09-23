# ChessTournament Pro - Replit.md

## Overview
ChessTournament Pro is a comprehensive chess tournament management system designed to streamline the organization, management, and tracking of chess tournaments. It supports various tournament formats including Swiss, Round Robin, and Knockout systems. The project aims to provide a robust solution for tournament directors and players, with features for automated pairing, real-time standings, player management, and historical tracking.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Styling**: Tailwind CSS with shadcn/ui
- **State Management**: TanStack Query (React Query)
- **Routing**: Wouter
- **Build Tool**: Vite
- **UI Philosophy**: Modern, responsive, accessibility-first design. Features comprehensive UI components for dashboards, pairings, brackets, standings, and player management. Supports downloadable standings and crosstables (CSV).

### Backend Architecture
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with ES modules
- **Database**: PostgreSQL with Drizzle ORM (Neon Database for serverless)
- **API Design**: RESTful API with JSON
- **Monorepo Structure**: Separate client, server, and shared modules.
- **Key Features**:
    - **Tournament Management**: Creation wizard, player registration (bulk/individual), multiple format support (Swiss, Round Robin, Knockout).
    - **Pairing Engine**: Automated pairing generation for Swiss system (including USCF rules for bye management, color alternation, tiebreakers like Modified Median, Solkoff, Cumulative scores), and pre-generated schedules for Round Robin.
    - **Player Management**: Comprehensive features including withdrawal, reactivation, specific round bye requests (half-point, zero-point), and late-joining player notation ("U").
    - **Authentication & Authorization**: User registration/login, secure session management, role-based access (Tournament Directors vs. Players) with distinct dashboards and permissions. Online player registration with TD approval workflow.
    - **Tournament History**: Tracks all modifications including match results and pairing changes with an audit trail and UI for viewing/reverting.
    - **Specific Features**: Houseplayer (TD) functionality, "Undo Swap" for manual pairing adjustments, tournament location/contact info, individual round scheduling, and a player-facing pairing predictor.

## External Dependencies

- **@neondatabase/serverless**: Serverless PostgreSQL connection
- **drizzle-orm**: Type-safe database ORM
- **@tanstack/react-query**: Server state management
- **@radix-ui/***: Accessible UI primitives
- **wouter**: Lightweight routing library
- **Vite**: Build tool and development server
- **TypeScript**: Type safety
- **Tailwind CSS**: Utility-first CSS framework
- **ESBuild**: Fast JavaScript bundler