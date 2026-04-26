# Chess Tournament Manager

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Drizzle](https://img.shields.io/badge/Drizzle-C5F74F?style=flat&logo=drizzle&logoColor=000)](https://orm.drizzle.team/)

A modern, full-stack platform designed for chess organizers, tournament directors, and players. This software streamlines the process of managing chess tournaments, from registration and seeding to real-time pairings and result reporting.

## Key Features

### Multiple Tournament Formats

The platform supports four primary tournament formats, each with specialized pairing and scoring logic:

#### **1. Swiss System (Standard & Professional)**
- **Pairing Engine**: Implements a professional Swiss pairing algorithm that adheres to USCF and FIDE principles.
- **Round Logic**: Sorts players by rating and splits the field into upper and lower halves. The top of the upper half is paired against the top of the lower half (Seeded Pairing).
- **Subsequent Rounds**: Grouping players by tournament points (score groups). Within each group, the "Upper vs Lower" method is applied while strictly avoiding repeat pairings.
- **Color Balancing**: Ensures no player receives the same color more than twice in a row, maintaining a `colorDelta` near zero for all participants.
- **Bye Management**: Automatically handles odd numbers of players by assigning a full-point or half-point bye to the lowest-ranked player in the lowest score group who hasn't already received one.

#### **2. Arena (Real-time Continuous Pairing)**
- **Dynamic Queue**: Players join a "pairing pool" and are matched as soon as they (and a suitable opponent) finish their previous game.
- **Cost-Function Driven**: Pairs are determined by minimizing a multi-factor cost function:
  $$Cost = (\Delta Score \times 2000) + (\Delta Rating \times 1) + HistoryPenalty + ColorCost$$
- **History Penalty**: Strongly discourages rematches (15,000 cost for $N-2$, 5,000 for $N-3$).
- **Dynamic Tolerance**: Acceptance threshold expands over time to ensure games are found: $Tolerance = 5000 + (WaitTime \times 200)$, capped at 30,000.
- **Advanced Scoring**: Supports "Streaks" where consecutive wins earn double points. Features an "On Fire" mode for top performers.
- **Real-time Updates**: Powered by Socket.io for instantaneous pairing alerts and live standing updates.

#### **3. Knockout (Single & Double Elimination)**
- **Bracket Generation**: Supports power-of-2 bracket sizes with automatic "Bye" assignment for uneven fields.
- **Double Elimination**: Features a dedicated "Loser's Bracket" (Consolation Bracket), ensuring players are only eliminated after two losses.
- **Flexible Seeding**:
  - **Standard**: Classic 1 vs 16, 2 vs 15 seeding.
  - **Slaughter**: High-rating vs Low-rating matchups to protect top seeds early.
  - **FIDE World Cup**: Adheres to official FIDE knockout bracket regulations.
- **Automatic Progression**: Winners are automatically moved to the next branch of the bracket upon result entry.

#### **4. Round Robin**
- **Schedule Integrity**: Pre-generates an exhaustive schedule where every participant plays every other participant exactly once.
- **Fair Color Assignment**: Uses Berger Tables or the Circle Algorithm to ensure an equal distribution of White and Black games across the tournament.
- **Round Management**: Simple round advancement that moves through the pre-defined pairing matrix.

### Professional Chess Integration
- **Rating Systems**: Native support for **USCF** and **FIDE** ratings (Standard, Rapid, Blitz).
- **Advanced Seeding**: Algorithms including FIDE World Cup, Slaughter, Random, and Manual.
- **Automated Tiebreaks**: Professional calculation of Modified Median, Solkoff, and Cumulative tiebreaks.
- **Ratings Cache**: High-performance local SQLite cache (FTS5) for instant USCF/FIDE player lookups.

---

## Project Structure

```text
.
├── client/                 # React Frontend (Vite + Tailwind)
│   ├── src/
│   │   ├── components/     # UI Components (Radix, Lucide, Custom)
│   │   ├── hooks/          # Custom Hooks (Auth, API queries, UI state)
│   │   ├── lib/            # Utilities (Stripe, Socket.io, formatters)
│   │   ├── pages/          # Application Screens (Dashboards, Auth, Tournaments)
│   │   └── App.tsx         # Routing & Main Layout
├── server/                 # Express Backend
│   ├── lib/                # Business Logic & Algorithms
│   │   ├── arenaPairing.ts # Arena pairing & cost function logic
│   │   ├── pairings.ts     # Swiss/RoundRobin pairing logic
│   │   └── tiebreaks.ts    # Standard tiebreak calculation logic
│   ├── routes/             # Modular API Endpoints
│   │   ├── arena.ts        # Arena specific endpoints
│   │   ├── auth.ts         # Authentication & User Management
│   │   ├── payments.ts     # Stripe integration & webhooks
│   │   └── tournaments.ts  # Tournament & Player CRUD
│   ├── storage.ts          # Drizzle ORM Database Interface (PostgreSQL)
│   └── index.ts            # Server entry point
├── shared/                 # Shared TypeScript Definitions & Validation
│   ├── schema.ts           # Drizzle Schemas & Zod Validation
│   └── tournament-config.ts # Global configuration types and helpers
├── attached_assets/        # Reports, templates, and official PDFs
├── screenshots/            # System diagrams and UI previews
├── migrations/             # SQL Migration files for database versioning
├── AGENTS.md               # Agent instructions for coding assistants
└── SKILLS/                 # Custom skills for agentic workflows
```

---


---

## Getting Started

### Prerequisites
- **Node.js** (v18+)
- **PostgreSQL** database (e.g., Supabase)
- **Firebase** project (for notifications)
- **Stripe** account (for payments)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/chess-tournament-manager.git
   cd chess-tournament-manager
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Environment Setup**:
   Create a `.env` file based on the template:
   ```bash
   cp .env.example .env
   ```
   *Fill in your database credentials, API keys for Stripe, Resend, and Firebase.*

4. **Initialize Database**:
   Push the schema to your PostgreSQL database:
   ```bash
   npm run db:push
   ```

5. **Run the Development Server**:
   ```bash
   npm run dev
   ```
   The application will be accessible at `http://localhost:5010`.

---

## Deployment (Render + Supabase)

The platform is optimized for deployment on **Render** using a **Supabase** backend.

### 1. Render Configuration
- **Environment**: Node.js
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Port**: Set `PORT` environment variable to `5010`.

### 2. Database Migrations
For existing databases, manual SQL migrations may be required for specific features (e.g., Email Verification). Scripts are located in `migrations/`.

**Example: Email Verification Setup**
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS verification_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code VARCHAR(6) NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'email_verification',
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

Built with ❤️ for the chess community.
