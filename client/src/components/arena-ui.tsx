import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Flame, Swords, Trophy, User, Clock, Users, Zap, ChevronLeft, ChevronRight, Crown, History } from "lucide-react";
import type { Player, Match, Tournament } from "@shared/schema";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { formatDistanceToNow } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Reconstructs the Lichess-style performance sequence for a player.
 */
function calculatePerformanceSequence(playerId: number, matches: Match[], scoringConfig?: any) {
  if (!matches) return [];
  const playerMatches = matches
    .filter(m => (m.whitePlayerId === playerId || m.blackPlayerId === playerId) && m.status === 'completed')
    .sort((a, b) => a.id - b.id);

  const sequence: number[] = [];
  let streak = 0;
  const config = scoringConfig || { winPoints: 2, drawPoints: 1, lossPoints: 0, streakThreshold: 2, onFireWinPoints: 4, onFireDrawPoints: 2 };
  const threshold = config.streakThreshold || 2;

  playerMatches.forEach(match => {
    const isWhite = match.whitePlayerId === playerId;
    const result = match.result;
    let score = 0;
    if (result === '1-0') score = isWhite ? 1 : 0;
    else if (result === '0-1') score = isWhite ? 0 : 1;
    else if (result === '1/2-1/2') score = 0.5;
    const onFire = streak >= threshold;
    if (score === 1) { sequence.push(onFire ? (config.onFireWinPoints || 4) : (config.winPoints || 2)); streak++; }
    else if (score === 0.5) { sequence.push(onFire ? (config.onFireDrawPoints || 2) : (config.drawPoints || 1)); streak = 0; }
    else { sequence.push(config.lossPoints || 0); streak = 0; }
  });
  return sequence;
}

function PerformanceBar({ sequence }: { sequence: number[] }) {
  if (sequence.length === 0) return <span className="text-[10px] text-slate-300 italic">—</span>;
  return (
    <div className="flex items-center gap-1 overflow-x-auto max-w-[120px] pb-1 no-scrollbar select-none">
      {sequence.map((points, i) => {
        let cls = "w-4 h-5 shrink-0 rounded-sm flex items-center justify-center text-[9px] font-black shadow-sm transition-transform hover:scale-110 cursor-default";
        if (points >= 4) cls += " bg-orange-500 text-white";
        else if (points >= 2) cls += " bg-green-500 text-white";
        else if (points === 1) cls += " bg-blue-500 text-white";
        else cls += " bg-slate-200 text-slate-500";
        return (
          <div key={i} className={cls} title={`${points} points`}>
            {points > 0 ? points : "0"}
          </div>
        );
      })}
    </div>
  );
}

// ─── Confetti Effect ─────────────────────────────────────────────────────────
function ConfettiEffect() {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShow(false), 10000);
    return () => clearTimeout(timer);
  }, []);

  const pieces = useMemo(() => Array.from({ length: 150 }).map((_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: -20,
    size: Math.random() * 8 + 4,
    color: ['#f59e0b', '#fbbf24', '#facc15', '#fef3c7', '#3b82f6', '#10b981', '#ef4444'][Math.floor(Math.random() * 7)],
    duration: Math.random() * 3 + 2,
    delay: Math.random() * 3,
    rotation: Math.random() * 360,
  })), []);

  if (!show) return null;

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-[100]">
      {pieces.map(p => (
        <motion.div
          key={p.id}
          initial={{ x: `${p.x}vw`, y: '-5vh', rotate: 0, opacity: 1 }}
          animate={{
            y: '105vh',
            rotate: p.rotation + 720,
            opacity: [1, 1, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            ease: "linear",
            repeat: Infinity,
          }}
          className="absolute"
          style={{
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
          }}
        />
      ))}
    </div>
  );
}

// ─── Compact live timer ──────────────────────────────────────────────────────
function useLiveTimer(startTime: Date | null, durationMinutes: number) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [phase, setPhase] = useState<'countdown' | 'live' | 'ended'>('live');

  useEffect(() => {
    if (!startTime || !durationMinutes) return;
    const rawStart = startTime as any;
    let startTs: number;
    if (typeof rawStart === 'string') {
      const iso = rawStart.includes('T') ? rawStart : (rawStart as string).replace(' ', 'T');
      startTs = new Date(iso.endsWith('Z') ? iso : `${iso}Z`).getTime();
    } else if (rawStart instanceof Date) {
      startTs = rawStart.getTime();
    } else {
      startTs = new Date(String(rawStart)).getTime();
    }
    const durationMs = durationMinutes * 60000;

    const tick = () => {
      const now = Date.now();
      if (now < startTs) {
        setPhase('countdown');
        setTimeLeft(Math.floor((startTs - now) / 1000));
      } else {
        const end = startTs + durationMs;
        const rem = Math.max(0, end - now);
        setPhase(rem === 0 ? 'ended' : 'live');
        setTimeLeft(Math.floor(rem / 1000));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime, durationMinutes]);

  return { timeLeft, phase };
}

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Calculates Tournament Performance Rating (TPR) using the Algorithm of 400.
 * TPR = R_a + (400 * (Wins - Losses) / Games)
 * or more accurately: R_a + d(p) where p is score percentage.
 */
function calculateTPR(playerId: number, matches: Match[], players: Player[]) {
  const completedMatches = matches.filter(m => 
    (m.whitePlayerId === playerId || m.blackPlayerId === playerId) && 
    m.status === 'completed' &&
    m.result
  );

  if (completedMatches.length === 0) return 0;

  let totalOpponentRating = 0;
  let score = 0;

  completedMatches.forEach(m => {
    const isWhite = m.whitePlayerId === playerId;
    const opponentId = isWhite ? m.blackPlayerId : m.whitePlayerId;
    const opponent = players.find(p => p.id === opponentId);
    if (opponent) {
      totalOpponentRating += parseInt(String(opponent.rating || "1200"));
    } else {
      totalOpponentRating += 1200; // Default
    }

    if (m.result === '1-0') score += isWhite ? 1 : 0;
    else if (m.result === '0-1') score += isWhite ? 0 : 1;
    else if (m.result === '1/2-1/2') score += 0.5;
  });

  const avgOpponentRating = totalOpponentRating / completedMatches.length;
  const percentage = score / completedMatches.length;
  
  // Linear approximation of d(p)
  const dp = 400 * (2 * percentage - 1);
  
  return Math.round(avgOpponentRating + dp);
}

function PlayerDetailsDialog({ player, matches, players }: { player: Player; matches: Match[]; players: Player[] }) {
  const playerMatches = useMemo(() => {
    return matches.filter(m => 
      (m.whitePlayerId === player.id || m.blackPlayerId === player.id) && 
      m.status === 'completed'
    ).sort((a, b) => {
       const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
       const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
       return dateB - dateA;
    });
  }, [player.id, matches]);

  const stats = useMemo(() => {
    let wins = 0, draws = 0, losses = 0;
    let totalOpponentRating = 0;

    playerMatches.forEach(m => {
      const isWhite = m.whitePlayerId === player.id;
      const opponentId = isWhite ? m.blackPlayerId : m.whitePlayerId;
      const opponent = players.find(p => p.id === opponentId);
      totalOpponentRating += parseInt(String(opponent?.rating || "1200"));

      if (m.result === '1-0') isWhite ? wins++ : losses++;
      else if (m.result === '0-1') isWhite ? losses++ : wins++;
      else if (m.result === '1/2-1/2') draws++;
    });

    const total = playerMatches.length;
    const score = wins + (draws * 0.5);
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    const avgOpponent = total > 0 ? Math.round(totalOpponentRating / total) : 0;
    const tpr = calculateTPR(player.id, matches, players);

    return { wins, draws, losses, total, score, winRate, avgOpponent, tpr };
  }, [player.id, playerMatches, players, matches]);

  return (
    <DialogContent className="max-w-2xl p-0 overflow-hidden bg-slate-50 border-none shadow-2xl rounded-2xl">
      <div className="bg-slate-900 px-6 py-8 text-white relative">
        <div className="absolute top-4 right-4 opacity-10">
          <Trophy className="h-24 w-24 rotate-12" />
        </div>
        
        <div className="flex items-end gap-4 relative z-10">
          <div className="h-20 w-20 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20">
            <User className="h-10 w-10 text-white" />
          </div>
          <div className="pb-1">
            <h2 className="text-2xl font-black tracking-tight">{player.firstName} {player.lastName}</h2>
            <div className="flex items-center gap-3 mt-1.5 opacity-80">
              <span className="flex items-center gap-1 text-sm font-bold bg-white/10 px-2 py-0.5 rounded">
                <Zap className="h-3 w-3 text-amber-400 fill-amber-400" />
                {player.rating} Rating
              </span>
              <span className="text-xs font-medium uppercase tracking-widest text-slate-400">
                Arena Participant
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm transition-transform hover:scale-[1.02]">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Performance</p>
            <p className="text-2xl font-black text-blue-600 tabular-nums">{stats.tpr || "—"}</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm transition-transform hover:scale-[1.02]">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Win Rate</p>
            <p className="text-2xl font-black text-slate-800 tabular-nums">{Math.round(stats.winRate)}%</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm transition-transform hover:scale-[1.02]">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Avg Opponent</p>
            <p className="text-2xl font-black text-slate-800 tabular-nums">{stats.avgOpponent || "—"}</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm transition-transform hover:scale-[1.02]">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Points</p>
            <p className="text-2xl font-black text-green-600 tabular-nums">{player.arenaPoints || "0"}</p>
          </div>
        </div>

        {/* Detailed Breakdown */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-green-50 border border-green-100 p-3 rounded-xl text-center">
            <span className="block text-[10px] font-bold text-green-600 uppercase mb-0.5">Wins</span>
            <span className="text-xl font-black text-green-700">{stats.wins}</span>
          </div>
          <div className="bg-slate-100 border border-slate-200 p-3 rounded-xl text-center">
            <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Draws</span>
            <span className="text-xl font-black text-slate-600">{stats.draws}</span>
          </div>
          <div className="bg-red-50 border border-red-100 p-3 rounded-xl text-center">
            <span className="block text-[10px] font-bold text-red-600 uppercase mb-0.5">Losses</span>
            <span className="text-xl font-black text-red-700">{stats.losses}</span>
          </div>
        </div>

        {/* Game History */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Tournament Games</h3>
            <span className="text-[10px] font-bold text-slate-400">{stats.total} total</span>
          </div>
          
          <ScrollArea className="h-[240px] pr-4">
            <div className="space-y-2">
              {playerMatches.map(m => {
                const isWhite = m.whitePlayerId === player.id;
                const oppId = isWhite ? m.blackPlayerId : m.whitePlayerId;
                const opp = players.find(p => p.id === oppId);
                const score = m.result === '1-0' ? (isWhite ? 1 : 0) : (m.result === '0-1' ? (isWhite ? 0 : 1) : 0.5);
                
                return (
                  <div key={m.id} className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl hover:border-slate-300 transition-colors group">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs",
                        score === 1 ? "bg-green-100 text-green-700" : score === 0 ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"
                      )}>
                        {score === 1 ? "+1" : score === 0 ? "0" : "½"}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-tighter mb-0.5">
                          vs {isWhite ? "Black" : "White"}
                        </p>
                        <p className="text-sm font-bold text-slate-800">
                          {opp ? `${opp.firstName} ${opp.lastName}` : "Unknown Opponent"}
                          <span className="ml-1.5 text-[10px] text-slate-400 font-medium">({opp?.rating})</span>
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest group-hover:text-slate-400 transition-colors">
                        Game #{m.id}
                      </p>
                      {m.createdAt && (
                        <p className="text-[9px] text-slate-400 mt-0.5">
                          {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      </div>
    </DialogContent>
  );
}

// ─── Arena Header (inline timer, Lichess-style) ──────────────────────────────
export function ArenaHeader({
  tournament,
  playerCount,
  isTD,
  onPause,
}: {
  tournament: Tournament;
  playerCount: number;
  isTD: boolean;
  onPause?: () => void;
}) {
  const startTime = useMemo(() => {
    if (!tournament.arenaStartTime) return null;
    const raw = tournament.arenaStartTime as any;
    if (raw instanceof Date) return raw;
    const iso = typeof raw === 'string' && raw.includes('T') ? raw : String(raw).replace(' ', 'T');
    return new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  }, [tournament.arenaStartTime]);

  const { timeLeft, phase } = useLiveTimer(startTime, tournament.arenaDuration || 10);

  const isLastMinute = phase === 'live' && timeLeft !== null && timeLeft < 60 && timeLeft > 0;

  // Status banner content
  const bannerText = useMemo(() => {
    if (tournament.status === 'registration') return 'Waiting for tournament to start — players registering';
    if (tournament.status === 'completed') return 'Tournament concluded — final standings below';
    if (phase === 'countdown') return 'Tournament starting soon — pairing players, get ready!';
    if (phase === 'ended') return tournament.arenaEndStrategy === 'wait_for_ongoing' ? 'Time expired — waiting for ongoing matches to finish' : 'Time expired — calculating final results';
    if (isLastMinute) return 'Final minute — last pairings in progress!';
    return `Arena live — ${playerCount} players competing`;
  }, [tournament.status, phase, isLastMinute, playerCount, tournament.arenaEndStrategy]);

  const bannerColor = useMemo(() => {
    if (tournament.status === 'completed') return 'bg-slate-100 text-slate-600';
    if (tournament.status === 'registration') return 'bg-blue-50 text-blue-700';
    if (phase === 'countdown') return 'bg-amber-400 text-amber-900';
    if (phase === 'ended') return 'bg-orange-100 text-orange-700';
    if (isLastMinute) return 'bg-red-500 text-white';
    return 'bg-green-500 text-white';
  }, [tournament.status, phase, isLastMinute]);

  return (
    <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-white">
      {/* Title row */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <Trophy className="h-5 w-5 text-amber-500" />
          <span className="text-lg font-bold text-slate-800 tracking-tight">
            {tournament.name}
          </span>
          {tournament.arenaDuration && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-slate-200 text-slate-500 font-medium">
              {tournament.arenaDuration}min Arena
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors rounded-full">
                <History className="h-4.5 w-4.5" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] p-0 overflow-hidden flex flex-col border-slate-200">
              <DialogHeader className="px-6 pt-5 pb-3 border-b border-slate-100 bg-slate-50/50">
                <DialogTitle className="flex items-center gap-2.5 text-slate-800 tracking-tight">
                  <div className="p-1.5 bg-white border border-slate-100 rounded-lg shadow-xs">
                    <History className="h-4 w-4 text-blue-500" />
                  </div>
                  Arena History & Stats
                </DialogTitle>
              </DialogHeader>
              <ScrollArea className="flex-1 px-6 py-5 bg-white">
                <div className="pb-6">
                  <TournamentHistory tournamentId={tournament.id} />
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>

          {timeLeft !== null && tournament.status === 'active' && (
            <div className="flex items-center gap-3">
              <span className={cn(
                "font-mono font-bold text-xl tabular-nums tracking-tight",
                phase === 'countdown' ? "text-amber-600" :
                isLastMinute ? "text-red-600 animate-pulse" :
                phase === 'ended' ? "text-slate-400" : "text-slate-700"
              )}>
                {formatTime(timeLeft)}
              </span>
              
              {/* TD Conclusion Trigger */}
              {isTD && phase === 'ended' && (
                <Dialog>
                  <DialogTrigger asChild>
                    <Button size="sm" className="h-8 px-4 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shadow-sm">
                      Conclude
                    </Button>
                  </DialogTrigger>
                  <ConclusionDialog tournament={tournament} />
                </Dialog>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Status banner */}
      <div className={cn("px-5 py-2 text-center text-xs font-semibold tracking-wide", bannerColor)}>
        {bannerText}
      </div>
    </div>
  );
}

function ConclusionDialog({ tournament }: { tournament: Tournament }) {
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);

  const concludeMutation = useMutation({
    mutationFn: async (strategy: 'force_end' | 'wait_for_ongoing') => {
      // 1. Update strategy directly on tournament
      await apiRequest(`/api/tournaments/${tournament.id}`, {
        method: "PATCH",
        body: JSON.stringify({ arenaEndStrategy: strategy })
      });
      
      // 2. Call conclude with the strategy
      return apiRequest(`/api/tournaments/${tournament.id}/arena/conclude`, {
        method: "POST",
        body: JSON.stringify({ strategy })
      });
    },
    onSuccess: () => {
      toast({ title: "Tournament conclusion initiated" });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournament.id}`] });
    },
    onError: (error: any) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  return (
    <DialogContent className="max-w-md p-0 overflow-hidden border-none shadow-2xl rounded-2xl bg-white">
      <div className="bg-amber-500 px-6 py-8 text-white relative">
        <div className="absolute top-4 right-4 opacity-10">
          <Clock className="h-24 w-24 -rotate-12" />
        </div>
        <div className="relative z-10">
          <Badge className="bg-white/20 text-white border-white/30 mb-2">Tournament Ended</Badge>
          <h2 className="text-2xl font-black tracking-tight">Conclude Arena</h2>
          <p className="text-amber-50 mt-1 text-sm opacity-90">The clock has reached zero. Choose how to finalize the results.</p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        <div 
          className="group p-4 rounded-xl border border-slate-200 hover:border-slate-900 transition-all cursor-pointer bg-slate-50/50 hover:bg-white"
          onClick={() => concludeMutation.mutate('wait_for_ongoing')}
        >
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg shrink-0">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="font-bold text-slate-800">Wait for Ongoing Matches</p>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Pairings stop immediately. The tournament will automatically conclude once the last live game is finished.
              </p>
              <Badge variant="secondary" className="mt-2 text-[9px] bg-blue-50 text-blue-600 border-blue-100">Recommended</Badge>
            </div>
          </div>
        </div>

        <div 
          className="group p-4 rounded-xl border border-slate-200 hover:border-red-600 transition-all cursor-pointer bg-slate-50/50 hover:bg-white"
          onClick={() => concludeMutation.mutate('force_end')}
        >
          <div className="flex items-start gap-3">
            <div className="p-2 bg-red-100 text-red-600 rounded-lg shrink-0">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <p className="font-bold text-slate-800">Force End Immediately</p>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                The tournament ends right now. Any games still in progress will be marked as unfinished.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <Button 
            variant="ghost" 
            className="w-full text-slate-400 text-xs font-bold hover:text-slate-600"
            onClick={() => { /* Close dialog */ }}
          >
            Cancel & Return to Lobby
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

// Keep ArenaTimer for backward compatibility (used in tournament-management)
export function ArenaTimer({ tournament }: { tournament: Tournament }) {
  return null; // Timer is now embedded in ArenaHeader inside ArenaLobby
}

// ─── Compact standings row ──────────────────────────────────────────────────
function StandingsRow({
  player,
  rank,
  isTD,
  onSelectWhite,
  onSelectBlack,
  selectedWhite,
   selectedBlack,
   currentUser,
   matches,
   players,
 }: {
   player: Player;
   rank: number;
   isTD: boolean;
   onSelectWhite: (id: number) => void;
   onSelectBlack: (id: number) => void;
   selectedWhite: number | null;
   selectedBlack: number | null;
   currentUser?: boolean;
   matches: Match[];
   players: Player[];
 }) {
  const sequence = calculatePerformanceSequence(player.id, matches);
  const points = parseFloat(player.arenaPoints || "0");
  const isPlaying = player.arenaStatus === 'playing';
  const isSelected = selectedWhite === player.id || selectedBlack === player.id;

  return (
    <TableRow
      className={cn(
        "group transition-colors border-b border-slate-100 last:border-0 h-10",
        currentUser && "bg-green-50/60 hover:bg-green-50",
        !currentUser && "hover:bg-slate-50/80",
        isSelected && "bg-blue-50",
        isPlaying && "opacity-75"
      )}
      style={currentUser ? { borderLeft: '3px solid #22c55e' } : {}}
    >
      {/* Rank */}
      <TableCell className="w-10 pl-4 py-0 text-center">
        {rank === 1 ? (
          <Crown className="h-3.5 w-3.5 text-amber-500 mx-auto" />
        ) : rank === 2 ? (
          <span className="text-sm font-bold text-slate-400">2</span>
        ) : rank === 3 ? (
          <span className="text-sm font-bold text-slate-400">3</span>
        ) : (
          <span className="text-xs text-slate-400 tabular-nums">{rank}</span>
        )}
      </TableCell>

      {/* Player */}
      <TableCell className="py-0 pl-1">
        <Dialog>
          <DialogTrigger asChild>
            <div className="flex items-center gap-1.5 cursor-pointer hover:bg-slate-100/50 p-1 rounded-md transition-colors w-fit">
              {player.onFire && (
                <Flame className="h-3.5 w-3.5 text-orange-500 fill-orange-400 shrink-0" />
              )}
              <span className={cn("text-sm font-semibold truncate max-w-[140px]", currentUser ? "text-green-700" : "text-slate-800")}>
                {player.firstName} {player.lastName}
              </span>
              <span className="text-[11px] text-slate-400 font-medium shrink-0">{player.rating}</span>
              {isPlaying && (
                <span className="text-[9px] font-bold text-blue-500 uppercase tracking-wider">●</span>
              )}
              {player.arenaStatus === 'paused' && (
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">–</span>
              )}
            </div>
          </DialogTrigger>
          <PlayerDetailsDialog player={player} matches={matches} players={players} />
        </Dialog>
      </TableCell>

      {/* Performance bar */}
      <TableCell className="py-0 hidden md:table-cell">
        <PerformanceBar sequence={sequence} />
      </TableCell>

      {/* Score */}
      <TableCell className="py-0 text-right pr-3 w-16">
        <div className="flex items-center justify-end gap-1">
          {player.arenaStreak >= 2 && (
            <span className="text-[10px] font-black text-orange-500">🔥{player.arenaStreak}</span>
          )}
          <span className={cn(
            "text-sm font-black tabular-nums",
            points > 0 ? "text-green-600" : "text-slate-400"
          )}>
            {points % 1 === 0 ? points : points.toFixed(1)}
          </span>
        </div>
      </TableCell>

      {/* TD actions */}
      {isTD && (
        <TableCell className="py-0 pr-3 w-28 text-right">
          {isPlaying ? (
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">In Match</span>
          ) : (
            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => onSelectWhite(player.id)}
                className={cn(
                  "h-6 px-2 text-[9px] font-bold uppercase rounded border transition-colors",
                  selectedWhite === player.id
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-white text-slate-600 border-slate-300 hover:border-slate-600"
                )}
                disabled={player.arenaStatus !== 'lobby'}
              >
                W
              </button>
              <button
                onClick={() => onSelectBlack(player.id)}
                className={cn(
                  "h-6 px-2 text-[9px] font-bold uppercase rounded border transition-colors",
                  selectedBlack === player.id
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-white text-slate-600 border-slate-300 hover:border-slate-600"
                )}
                disabled={player.arenaStatus !== 'lobby'}
              >
                B
              </button>
            </div>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}

// ─── Arena Lobby ─────────────────────────────────────────────────────────────
interface ArenaUIProps {
  tournamentId: number;
  isTD: boolean;
  userId?: number;
  onArenaStart?: () => void;
}

const PAGE_SIZE = 15;

export function ArenaLobby({ tournamentId, isTD, userId, onArenaStart }: ArenaUIProps) {
  const { toast } = useToast();
  const { data: tournament } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
    refetchInterval: 2000,
  });

  const { data: players, isLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
    refetchInterval: 2000,
  });

  const { data: matches } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
    refetchInterval: 2000,
  });

  const [whitePlayerId, setWhitePlayerId] = useState<number | null>(null);
  const [blackPlayerId, setBlackPlayerId] = useState<number | null>(null);
  const [page, setPage] = useState(0);

  const isExpired = useMemo(() => {
    if (!tournament?.arenaStartTime || !tournament?.arenaDuration) return false;
    const rawStart = tournament.arenaStartTime as any;
    let utcStr = rawStart;
    if (typeof rawStart === 'string') {
      const iso = rawStart.includes('T') ? rawStart : rawStart.replace(' ', 'T');
      utcStr = iso.endsWith('Z') ? iso : `${iso}Z`;
    }
    return Date.now() > new Date(utcStr).getTime() + tournament.arenaDuration * 60000;
  }, [tournament]);

  const sortedPlayers = useMemo(() => {
    if (!players) return [];
    return [...players].sort((a, b) => parseFloat(b.arenaPoints || "0") - parseFloat(a.arenaPoints || "0"));
  }, [players]);

  const totalPages = Math.ceil(sortedPlayers.length / PAGE_SIZE);
  const pagePlayers = sortedPlayers.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const lobbyCount = players?.filter(p => p.arenaStatus === 'lobby').length || 0;
  const playingCount = players?.filter(p => p.arenaStatus === 'playing').length || 0;

  const pairMutation = useMutation({
    mutationFn: async () => apiRequest(`/api/tournaments/${tournamentId}/arena/pair`, {
      method: "POST",
      body: JSON.stringify({ whitePlayerId, blackPlayerId }),
    }),
    onSuccess: () => {
      toast({ title: "Match dispatched" });
      setWhitePlayerId(null);
      setBlackPlayerId(null);
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/arena/lobby`] });
    },
    onError: (error: any) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const startArenaMutation = useMutation({
    mutationFn: async () => apiRequest(`/api/tournaments/${tournamentId}/arena/start`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Arena activated!" });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      onArenaStart?.();
    },
    onError: (error: any) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  if (isLoading) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin h-8 w-8 border-2 border-slate-300 border-t-slate-700 rounded-full" />
    </div>
  );

  if (tournament?.status === 'completed') return <ArenaPodium players={players || []} matches={matches || []} isTD={isTD} />;

  return (
    <div className="space-y-4 animate-in fade-in duration-500">

      {/* Arena Header with inline timer */}
      {tournament && (
        <ArenaHeader
          tournament={tournament}
          playerCount={players?.length || 0}
          isTD={isTD}
        />
      )}

      {/* Start Tournament CTA (registration state) */}
      {isTD && tournament?.status === 'registration' && (
        <div className="flex items-center justify-between bg-slate-900 text-white rounded-xl px-5 py-4">
          <div>
            <p className="font-bold text-base">Start Arena Tournament</p>
            <p className="text-slate-400 text-xs mt-0.5">Players are waiting — activate the arena pool to begin pairing</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Select
              value={String(tournament?.arenaDuration || 10)}
              onValueChange={(val) => {
                apiRequest(`/api/tournaments/${tournamentId}`, {
                  method: "PATCH",
                  body: JSON.stringify({ arenaDuration: parseInt(val) })
                }).then(() => queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] }));
              }}
            >
              <SelectTrigger className="w-32 h-8 bg-white/10 border-white/20 text-white text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[5,10,15,20,30,45,60,90,120].map(m => (
                  <SelectItem key={m} value={String(m)}>{m < 60 ? `${m} min` : `${m/60}h`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => startArenaMutation.mutate()}
              disabled={startArenaMutation.isPending}
              className="h-8 px-5 font-bold"
            >
              {startArenaMutation.isPending ? "Starting…" : "Start"}
            </Button>
          </div>
        </div>
      )}

      {/* Manual pairing panel (TD only, manual mode) */}
      {isTD && tournament?.status === 'active' && tournament?.arenaPairingMode === 'manual' && (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <Swords className="h-4 w-4 text-slate-600" />
              <span className="text-sm font-bold text-slate-700">Manual Pairing</span>
            </div>
            <Button
              size="sm"
              disabled={!whitePlayerId || !blackPlayerId || pairMutation.isPending || isExpired}
              onClick={() => pairMutation.mutate()}
              className="h-7 px-4 text-xs font-bold"
            >
              {pairMutation.isPending ? "Pairing…" : "Confirm Pair"}
            </Button>
          </div>
          <div className="flex items-center gap-0 divide-x divide-slate-200">
            <div className={cn("flex-1 px-4 py-3 text-center transition-colors", whitePlayerId ? "bg-white" : "bg-slate-50/50")}>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">White</p>
              <p className={cn("text-sm font-bold truncate", whitePlayerId ? "text-slate-800" : "text-slate-300 italic")}>
                {whitePlayerId ? players?.find(p => p.id === whitePlayerId)?.firstName + ' ' + players?.find(p => p.id === whitePlayerId)?.lastName : "Select from table ↓"}
              </p>
            </div>
            <div className="px-3 py-3 shrink-0 bg-slate-50">
              <span className="text-[10px] font-black text-slate-400">VS</span>
            </div>
            <div className={cn("flex-1 px-4 py-3 text-center transition-colors", blackPlayerId ? "bg-slate-900" : "bg-slate-50/50")}>
              <p className={cn("text-[9px] font-bold uppercase tracking-widest mb-0.5", blackPlayerId ? "text-slate-500" : "text-slate-400")}>Black</p>
              <p className={cn("text-sm font-bold truncate", blackPlayerId ? "text-white" : "text-slate-300 italic")}>
                {blackPlayerId ? players?.find(p => p.id === blackPlayerId)?.firstName + ' ' + players?.find(p => p.id === blackPlayerId)?.lastName : "Select from table ↓"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Standings table */}
      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
        {/* Table header bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span>{lobbyCount} ready</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span>{playingCount} playing</span>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 tabular-nums">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sortedPlayers.length)} / {sortedPlayers.length}
              </span>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="h-6 w-6 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="h-6 w-6 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none bg-slate-50/30">
                <TableHead className="w-10 pl-4 h-8 text-[9px] font-black uppercase tracking-wider text-slate-400">#</TableHead>
                <TableHead className="h-8 text-[9px] font-black uppercase tracking-wider text-slate-400">Player</TableHead>
                <TableHead className="h-8 text-[9px] font-black uppercase tracking-wider text-slate-400 hidden md:table-cell">Performance</TableHead>
                <TableHead className="h-8 pr-3 text-right text-[9px] font-black uppercase tracking-wider text-slate-400 w-16">Score</TableHead>
                {isTD && tournament?.arenaPairingMode === 'manual' && (
                  <TableHead className="h-8 pr-3 text-right text-[9px] font-black uppercase tracking-wider text-slate-400 w-28">Pair</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagePlayers.map((player, idx) => (
                <StandingsRow
                  key={player.id}
                  player={player}
                  rank={page * PAGE_SIZE + idx + 1}
                  isTD={isTD && tournament?.arenaPairingMode === 'manual'}
                  matches={matches || []}
                  players={players || []}
                  onSelectWhite={(id) => setWhitePlayerId(id === whitePlayerId ? null : id)}
                  onSelectBlack={(id) => setBlackPlayerId(id === blackPlayerId ? null : id)}
                  selectedWhite={whitePlayerId}
                  selectedBlack={blackPlayerId}
                  currentUser={player.userId === userId}
                />
              ))}
            </TableBody>
          </Table>
        </div>

        {sortedPlayers.length === 0 && (
          <div className="py-16 flex flex-col items-center text-center opacity-40">
            <Users className="h-10 w-10 mb-3 text-slate-400" />
            <p className="text-sm text-slate-500">No players registered yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Active Matches (compact board list) ─────────────────────────────────────
export function ArenaActiveMatches({ tournamentId, isTD, userId }: ArenaUIProps) {
  const { toast } = useToast();
  const { data: matches, isLoading } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
    refetchInterval: 3000,
  });
  const { data: players } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const resultMutation = useMutation({
    mutationFn: async ({ matchId, result }: { matchId: number; result: string }) =>
      apiRequest(`/api/tournaments/${tournamentId}/arena/results`, {
        method: "POST",
        body: JSON.stringify({ matchId, result }),
      }),
    onSuccess: () => {
      toast({ title: "Result recorded" });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
    },
  });

  const activeMatches = matches?.filter(m =>
    ['pending', 'in_progress', 'playing', 'scheduled'].includes(m.status)
  );

  if (isLoading) return (
    <div className="flex justify-center py-16">
      <div className="animate-spin h-7 w-7 border-2 border-slate-300 border-t-slate-700 rounded-full" />
    </div>
  );

  if (!activeMatches || activeMatches.length === 0) return (
    <div className="border border-slate-200 rounded-xl py-16 flex flex-col items-center text-center bg-white">
      <Swords className="h-10 w-10 mb-3 text-slate-300" />
      <p className="text-sm font-semibold text-slate-500">No active matches</p>
      <p className="text-xs text-slate-400 mt-1">Pair players in the Lobby tab to see boards here</p>
    </div>
  );

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/50">
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
          {activeMatches.length} Active Board{activeMatches.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="divide-y divide-slate-100">
        {activeMatches.map((match, idx) => {
          const white = players?.find(p => p.id === match.whitePlayerId);
          const black = players?.find(p => p.id === match.blackPlayerId);
          return (
            <div key={match.id} className="flex items-center gap-4 px-4 py-2.5 hover:bg-slate-50/60 transition-colors">
              {/* Board number */}
              <div className="shrink-0 w-10 text-center">
                <span className="text-[10px] text-slate-400 block leading-none">Board</span>
                <span className="text-base font-black text-slate-700 tabular-nums leading-tight">
                  {(match.board || idx + 1).toString().padStart(2, '0')}
                </span>
              </div>

              {/* Players */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* White */}
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded-sm bg-white border border-slate-300 shrink-0" />
                    <span className="text-sm font-semibold text-slate-800 truncate max-w-[120px]">
                      {white?.firstName} {white?.lastName}
                    </span>
                    <span className="text-[10px] text-slate-400">{white?.rating}</span>
                  </div>
                  <span className="text-xs font-bold text-slate-400">vs</span>
                  {/* Black */}
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded-sm bg-slate-800 border border-slate-600 shrink-0" />
                    <span className="text-sm font-semibold text-slate-800 truncate max-w-[120px]">
                      {black?.firstName} {black?.lastName}
                    </span>
                    <span className="text-[10px] text-slate-400">{black?.rating}</span>
                  </div>
                </div>
              </div>

              {/* Result buttons / status */}
              <div className="shrink-0">
                {isTD ? (
                  <div className="flex items-center gap-1">
                    {[
                      { label: '1-0', result: '1-0' },
                      { label: '0-1', result: '0-1' },
                      { label: '½-½', result: '1/2-1/2' },
                    ].map(({ label, result }) => (
                      <button
                        key={result}
                        onClick={() => resultMutation.mutate({ matchId: match.id, result })}
                        className="h-7 px-2.5 text-xs font-bold rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-800 hover:text-white hover:border-slate-800 transition-colors"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs font-semibold text-blue-500 animate-pulse">Playing</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Past Games / Match History ─────────────────────────────────────────────
export function TournamentHistory({ tournamentId }: { tournamentId: number }) {
  const { data: matches, isLoading } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
    refetchInterval: 5000,
  });
  const { data: players } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const completedMatches = useMemo(() => {
    return matches?.filter(m => m.status === 'completed').sort((a, b) => b.id - a.id) || [];
  }, [matches]);

  // Statistics: Pairing frequency
  const pairingStats = useMemo(() => {
    const stats = new Map<string, { count: number; lastTime: Date | null }>();
    completedMatches.forEach(m => {
      const ids = [m.whitePlayerId, m.blackPlayerId].sort().join('-');
      const current = stats.get(ids) || { count: 0, lastTime: null };
      current.count += 1;
      if (!current.lastTime || (m.createdAt && new Date(m.createdAt) > current.lastTime)) {
        current.lastTime = m.createdAt ? new Date(m.createdAt) : null;
      }
      stats.set(ids, current);
    });
    return stats;
  }, [completedMatches]);

  if (isLoading) return <div className="py-10 text-center text-slate-400">Loading history...</div>;

  if (completedMatches.length === 0) return (
    <div className="border border-dashed border-slate-200 rounded-xl py-12 flex flex-col items-center text-center">
      <Clock className="h-8 w-8 text-slate-300 mb-2" />
      <p className="text-sm font-medium text-slate-500">No completed matches yet</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="shadow-none border-slate-200 bg-slate-50/30">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <Users className="h-3.5 w-3.5" /> Recent Results
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 max-h-[400px] overflow-y-auto">
            <Table>
              <TableBody>
                {completedMatches.slice(0, 50).map(match => {
                  const white = players?.find(p => p.id === match.whitePlayerId);
                  const black = players?.find(p => p.id === match.blackPlayerId);
                  const resultStr = match.result === '1-0' ? '1 – 0' : match.result === '0-1' ? '0 – 1' : '½ – ½';
                  
                  return (
                    <TableRow key={match.id} className="h-10 hover:bg-white transition-colors border-slate-100">
                      <TableCell className="py-1 text-[11px] font-bold text-slate-400 tabular-nums w-12 text-center">#{match.id}</TableCell>
                      <TableCell className="py-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold truncate max-w-[80px]">{white?.firstName}</span>
                          <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px] font-black bg-white border-slate-100">{resultStr}</Badge>
                          <span className="text-xs font-semibold truncate max-w-[80px] text-right">{black?.firstName}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="shadow-none border-slate-200 bg-slate-50/30">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <Zap className="h-3.5 w-3.5" /> Pairing Frequency
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 max-h-[400px] overflow-y-auto">
            <Table>
              <TableBody>
                {Array.from(pairingStats.entries())
                  .sort((a, b) => b[1].count - a[1].count)
                  .map(([pairId, data]) => {
                    const [id1, id2] = pairId.split('-').map(Number);
                    const p1 = players?.find(p => p.id === id1);
                    const p2 = players?.find(p => p.id === id2);
                    return (
                      <TableRow key={pairId} className="h-12 hover:bg-white transition-colors border-slate-100">
                        <TableCell className="py-2 px-4">
                          <div className="flex items-center justify-between">
                            <div className="flex flex-col text-left">
                              <span className="text-xs font-bold text-slate-700">
                                {p1?.firstName || `Player ${id1}`} vs {p2?.firstName || `Player ${id2}`}
                              </span>
                              {data.lastTime && (
                                <span className="text-[10px] text-slate-400">
                                  Last played {formatDistanceToNow(data.lastTime, { addSuffix: true })}
                                </span>
                              )}
                            </div>
                            <Badge variant="outline" className="h-6 bg-blue-50 text-blue-600 border-blue-100 font-bold px-2 shrink-0">
                              {data.count} {data.count === 1 ? 'game' : 'games'}
                            </Badge>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Arena Standings (standalone, used elsewhere) ────────────────────────────
export function ArenaStandings({
  tournamentId,
  userId,
  isTD = false,
  tournament,
  whitePlayerId = null,
  blackPlayerId = null,
  setWhitePlayerId,
  setBlackPlayerId,
}: {
  tournamentId: number;
  userId?: number;
  isTD?: boolean;
  tournament?: Tournament;
  whitePlayerId?: number | null;
  blackPlayerId?: number | null;
  setWhitePlayerId?: (id: number | null) => void;
  setBlackPlayerId?: (id: number | null) => void;
}) {
  const { data: standings, isLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/arena/standings`],
    refetchInterval: 5000,
  });
  const { data: matches } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
  });
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil((standings?.length || 0) / PAGE_SIZE);
  const pagePlayers = (standings || []).slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (isLoading) return (
    <div className="flex justify-center py-16">
      <div className="animate-spin h-8 w-8 border-2 border-slate-300 border-t-slate-700 rounded-full" />
    </div>
  );

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50/50">
          <span className="text-[10px] text-slate-500 tabular-nums">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, standings?.length || 0)} / {standings?.length || 0}
          </span>
          <button onClick={() => setPage(p => Math.max(0, p-1))} disabled={page === 0} className="h-6 w-6 flex items-center justify-center rounded border border-slate-200 hover:bg-slate-100 disabled:opacity-30">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setPage(p => Math.min(totalPages-1, p+1))} disabled={page >= totalPages-1} className="h-6 w-6 flex items-center justify-center rounded border border-slate-200 hover:bg-slate-100 disabled:opacity-30">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent bg-slate-50/30 border-none">
            <TableHead className="w-10 pl-4 h-8 text-[9px] font-black uppercase tracking-wider text-slate-400">#</TableHead>
            <TableHead className="h-8 text-[9px] font-black uppercase tracking-wider text-slate-400">Player</TableHead>
            <TableHead className="h-8 text-[9px] font-black uppercase tracking-wider text-slate-400 hidden md:table-cell">Performance</TableHead>
            <TableHead className="h-8 pr-6 text-right text-[9px] font-black uppercase tracking-wider text-slate-400">Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pagePlayers.map((player, idx) => (
            <StandingsRow
              key={player.id}
              player={player}
              rank={page * PAGE_SIZE + idx + 1}
              isTD={isTD && tournament?.arenaPairingMode === 'manual'}
              matches={matches || []}
              players={standings || []}
              onSelectWhite={(id) => setWhitePlayerId?.(id)}
              onSelectBlack={(id) => setBlackPlayerId?.(id)}
              selectedWhite={whitePlayerId}
              selectedBlack={blackPlayerId}
              currentUser={player.userId === userId}
            />
          ))}
        </TableBody>
      </Table>
      {(!standings || standings.length === 0) && (
        <div className="py-16 flex flex-col items-center opacity-30">
          <Trophy className="h-10 w-10 mb-3" />
          <p className="text-sm">No standings yet</p>
        </div>
      )}
    </div>
  );
}

// ─── Podium ──────────────────────────────────────────────────────────────────
export function ArenaPodium({ players, matches, isTD }: { players: Player[]; matches: Match[]; isTD?: boolean }) {
  const top3 = useMemo(() => [...players]
    .sort((a, b) => parseFloat(b.arenaPoints || "0") - parseFloat(a.arenaPoints || "0"))
    .slice(0, 3), [players]);

  if (top3.length === 0) return null;

  const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean);
  const heights = [top3[1] ? 'h-32' : 'h-0', 'h-48', top3[2] ? 'h-24' : 'h-0'];
  const medals = ['🥈', '🥇', '🥉'];
  const colors = [
    'from-slate-300 to-slate-400 border-slate-200', 
    'from-amber-300 to-amber-500 border-amber-200', 
    'from-orange-200 to-orange-400 border-orange-100'
  ];
  const labels = ['Silver Medalist', 'Tournament Champion', 'Bronze Medalist'];

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 relative overflow-hidden bg-slate-50/50 rounded-3xl border border-slate-200/60 shadow-inner">
      <ConfettiEffect />
      
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="text-center mb-16 relative z-10"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-[10px] font-black uppercase tracking-widest mb-4 border border-amber-200 shadow-sm">
          <Trophy className="h-3 w-3" /> Arena Results
        </div>
        <h2 className="text-5xl font-black text-slate-900 tracking-tight leading-none">
          The Podium
        </h2>
        <p className="text-slate-500 mt-3 font-medium">Congratulations to the tournament winners!</p>
      </motion.div>

      <div className="flex items-end justify-center gap-4 w-full max-w-4xl relative z-10">
        {podiumOrder.map((player, i) => {
          const originalIdx = podiumOrder.length === 3 ? (i === 1 ? 0 : i === 0 ? 1 : 2) : (top3[0].id === player?.id ? 0 : 1);
          const tpr = calculateTPR(player.id, matches, players);
          const sequence = calculatePerformanceSequence(player.id, matches);
          
          return (
            <motion.div 
              key={player?.id} 
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: i * 0.2 + 0.3 }}
              className="flex flex-col items-center flex-1 max-w-[240px]"
            >
              <div className="relative mb-6">
                <div className="h-16 w-16 rounded-2xl bg-white shadow-xl flex items-center justify-center border border-slate-100 relative z-10">
                  <User className="h-8 w-8 text-slate-400" />
                </div>
                <div className="absolute -top-3 -right-3 h-8 w-8 bg-white rounded-full shadow-lg flex items-center justify-center text-lg z-20 border border-slate-50">
                  {medals[originalIdx]}
                </div>
              </div>

              <div className="text-center mb-4">
                <p className="text-sm font-black text-slate-800 leading-tight">
                  {player?.firstName} {player?.lastName}
                </p>
                <div className="flex items-center justify-center gap-2 mt-1">
                   <Badge variant="outline" className="text-[9px] font-bold py-0 h-4 bg-white/50 border-slate-200">{player.rating} Rating</Badge>
                   <span className="text-[10px] font-black text-blue-600 uppercase tracking-tighter">TPR: {tpr}</span>
                </div>
              </div>

              <div className={cn(
                "w-full rounded-2xl flex flex-col items-center justify-start py-6 shadow-xl border relative overflow-hidden",
                "bg-gradient-to-b " + colors[originalIdx],
                i === 1 ? "scale-110 z-10" : ""
              )}>
                {/* Decorative Pattern */}
                <div className="absolute inset-0 opacity-10 pointer-events-none">
                   <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-from)_0%,_transparent_70%)]" />
                </div>

                <p className="text-4xl font-black text-slate-900 mb-1 tabular-nums drop-shadow-sm">
                  {player?.arenaPoints}
                </p>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-900/60 mb-6 font-mono">Points</p>
                
                <div className="w-full px-4 pt-4 border-t border-black/5 flex flex-col gap-3">
                   <div className="flex justify-between items-center bg-black/5 rounded-lg px-2.5 py-1.5">
                      <span className="text-[9px] font-bold text-black/40 uppercase">Performance</span>
                      <PerformanceBar sequence={sequence} />
                   </div>
                   <div className="text-center">
                      <span className="text-[9px] font-black text-black/60 uppercase tracking-wider">{labels[originalIdx]}</span>
                   </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
        className="mt-20 flex flex-col items-center gap-4 relative z-10"
      >
        <div className="p-1 px-4 bg-slate-900/5 rounded-full border border-slate-200/50 backdrop-blur-sm">
           <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">End of Tournament Summary</p>
        </div>
        
        <div className="flex items-center gap-3">
          <Button 
            variant="outline" 
            className="rounded-xl border-slate-200 shadow-sm font-bold text-xs h-10 px-6 hover:bg-slate-100 transition-all"
            onClick={() => window.location.href = `/tournaments/${players[0].tournamentId}${isTD ? '/manage' : ''}`}
          >
            <ChevronLeft className="h-4 w-4 mr-2" /> Back to Tournament
          </Button>
          <Button 
            className="rounded-xl bg-slate-900 text-white shadow-lg font-bold text-xs h-10 px-6 hover:bg-slate-800 transition-all"
            onClick={() => window.location.href = '/tournaments'}
          >
            All Tournaments
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
