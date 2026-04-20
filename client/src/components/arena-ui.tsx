import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HEAD_TO_HEAD_RESULT_OPTIONS } from "@shared/match-results";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Flame, Swords, UserPlus, Pause, Play, Trophy, User, Clock, Users, Zap } from "lucide-react";
import type { Player, Match, Tournament } from "@shared/schema";
import { cn } from "@/lib/utils";

/**
 * Reconstructs the Lichess-style performance sequence for a player.
 * Scoring: Win = 2, Draw = 1, Loss = 0. 
 * Streak (after 2 consecutive wins): Win = 4, Draw = 2.
 */
function calculatePerformanceSequence(playerId: number, matches: Match[], scoringConfig?: any) {
  if (!matches) return [];
  
  // Filter matches for this player and sort by ID (chronological proxy)
  const playerMatches = matches
    .filter(m => (m.whitePlayerId === playerId || m.blackPlayerId === playerId) && m.status === 'completed')
    .sort((a, b) => a.id - b.id);

  const sequence: number[] = [];
  let streak = 0;
  
  const config = scoringConfig || {
    winPoints: 2,
    drawPoints: 1,
    lossPoints: 0,
    streakThreshold: 2,
    onFireWinPoints: 4,
    onFireDrawPoints: 2
  };

  const threshold = config.streakThreshold || 2;

  playerMatches.forEach(match => {
    const isWhite = match.whitePlayerId === playerId;
    const result = match.result;
    let score = 0;

    if (result === '1-0') score = isWhite ? 1 : 0;
    else if (result === '0-1') score = isWhite ? 0 : 1;
    else if (result === '1/2-1/2') score = 0.5;

    const onFire = streak >= threshold;

    if (score === 1) {
      sequence.push(onFire ? (config.onFireWinPoints || 4) : (config.winPoints || 2));
      streak++;
    } else if (score === 0.5) {
      sequence.push(onFire ? (config.onFireDrawPoints || 2) : (config.drawPoints || 1));
      streak = 0;
    } else {
      sequence.push(config.lossPoints || 0);
      streak = 0;
    }
  });

  return sequence;
}

function PerformanceSequence({ sequence }: { sequence: number[] }) {
  if (sequence.length === 0) return <span className="text-[10px] text-muted-foreground/30 italic">No games yet</span>;

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
      {sequence.slice(-12).map((points, i) => {
        let colorClass = "text-muted-foreground/40";
        if (points >= 4) colorClass = "text-orange-500 font-black drop-shadow-[0_0_8px_rgba(249,115,22,0.3)]";
        else if (points >= 2) colorClass = "text-green-600 font-bold";
        else if (points === 1) colorClass = "text-blue-500 font-semibold";
        
        return (
          <span key={i} className={cn("text-xs w-3.5 text-center", colorClass)}>
            {points}
          </span>
        );
      })}
    </div>
  );
}

function StandingsRow({ 
  player, 
  rank, 
  isTD, 
  matches, 
  onSelectWhite, 
  onSelectBlack, 
  selectedWhite, 
  selectedBlack,
  currentUser 
}: { 
  player: Player, 
  rank: number, 
  isTD: boolean, 
  matches: Match[],
  onSelectWhite: (id: number) => void,
  onSelectBlack: (id: number) => void,
  selectedWhite: number | null,
  selectedBlack: number | null,
  currentUser?: boolean
}) {
  const sequence = calculatePerformanceSequence(player.id, matches);
  
  return (
    <TableRow className={cn(
      "group hover:bg-muted/30 transition-colors border-b last:border-0",
      currentUser && "bg-primary/5 hover:bg-primary/10 transition-colors",
      player.arenaStatus === 'playing' && "opacity-80"
    )}>
      <TableCell className="w-12 pl-6 py-3">
        <span className={cn(
          "text-sm font-bold tabular-nums",
          rank <= 3 ? "text-primary flex items-center gap-1" : "text-muted-foreground/40"
        )}>
          {rank.toString().padStart(2, '0')}
          {rank === 1 && <Trophy className="h-3 w-3" />}
        </span>
      </TableCell>
      
      <TableCell className="py-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0",
            player.onFire ? "bg-orange-500 animate-pulse shadow-[0_0_12px_rgba(249,115,22,0.4)]" : "bg-muted text-muted-foreground"
          )}>
            {player.onFire ? <Flame className="h-4 w-4 fill-current" /> : <User className="h-4 w-4" />}
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn("text-sm font-semibold truncate", currentUser ? "text-primary" : "text-foreground")}>
                {player.firstName} {player.lastName}
              </span>
              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-muted-foreground/20 text-muted-foreground">
                {player.rating}
              </Badge>
              {player.arenaStatus === 'playing' && (
                <div className="flex items-center gap-1 text-[11px] font-bold text-primary animate-pulse">
                  <Swords className="h-3.5 w-3.5" />
                  <span>PLAYING</span>
                </div>
              )}
              {player.arenaStatus === 'paused' && (
                <Badge variant="outline" className="text-[9px] bg-muted/50">Paused</Badge>
              )}
            </div>
          </div>
        </div>
      </TableCell>

      <TableCell className="py-3 px-4 hidden md:table-cell">
        <PerformanceSequence sequence={sequence} />
      </TableCell>

      <TableCell className="py-3 pr-4 text-right">
        <div className="flex flex-col items-end">
          <span className="text-lg font-black tracking-tight tabular-nums text-foreground">
            {parseFloat(player.arenaPoints || "0")}
          </span>
          {player.arenaStreak > 0 && (
            <span className="text-[10px] font-bold text-orange-500 flex items-center gap-0.5">
              <Zap className="h-2.5 w-2.5 fill-current" />
              {player.arenaStreak}
            </span>
          )}
        </div>
      </TableCell>

      {isTD && (
        <TableCell className="py-2 pr-6 text-right w-40">
          {player.arenaStatus === 'playing' ? (
            <div className="flex items-center justify-end gap-2 text-indigo-600 bg-indigo-50 dark:bg-indigo-900/40 px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-700 shadow-sm animate-pulse">
              <Swords className="h-4 w-4" />
              <span className="text-[10px] font-black uppercase tracking-widest">Matching</span>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <Button
                size="sm"
                variant={selectedWhite === player.id ? "default" : "outline"}
                onClick={() => onSelectWhite(player.id)}
                disabled={player.arenaStatus !== 'lobby'}
                className={cn(
                  "h-8 w-14 text-[10px] font-bold uppercase tracking-tight rounded-lg",
                  selectedWhite === player.id ? "bg-indigo-600 hover:bg-indigo-700" : ""
                )}
              >
                White
              </Button>
              <Button
                size="sm"
                variant={selectedBlack === player.id ? "default" : "outline"}
                onClick={() => onSelectBlack(player.id)}
                disabled={player.arenaStatus !== 'lobby'}
                className={cn(
                  "h-8 w-14 text-[10px] font-bold uppercase tracking-tight rounded-lg",
                  selectedBlack === player.id ? "bg-slate-900 hover:bg-slate-800 text-white" : ""
                )}
              >
                Black
              </Button>
            </div>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}

interface ArenaUIProps {
  tournamentId: number;
  isTD: boolean;
  userId?: number;
}

export function ArenaTimer({ tournament }: { tournament: Tournament }) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  React.useEffect(() => {
    if (!tournament.arenaStartTime || !tournament.arenaDuration) return;

    // More robust date parsing for UTC
    let startTime: number;
    const rawStart = tournament.arenaStartTime as any;
    
    if (typeof rawStart === 'string') {
      const isoStr = rawStart.includes('T') ? rawStart : rawStart.replace(' ', 'T');
      const utcStr = isoStr.endsWith('Z') ? isoStr : `${isoStr}Z`;
      startTime = new Date(utcStr).getTime();
    } else {
      // If it's already a Date object, assume it's UTC normalized or handle accurately
      startTime = new Date(rawStart).getTime();
    }
    
    const durationMs = tournament.arenaDuration * 60000;
    const endTime = startTime + durationMs;

    const updateTimer = () => {
      const now = new Date().getTime();
      const remaining = Math.max(0, endTime - now);
      setTimeLeft(Math.floor(remaining / 1000));
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [tournament.arenaStartTime, tournament.arenaDuration]);

  if (timeLeft === null) return null;

  const hours = Math.floor(timeLeft / 3600);
  const minutes = Math.floor((timeLeft % 3600) / 60);
  const seconds = timeLeft % 60;
  const isLastMinute = timeLeft < 60 && timeLeft > 0;
  const isEnded = timeLeft === 0;

  return (
    <div className="w-full flex flex-col items-center justify-center py-6 sm:py-10">
      <div className="flex flex-col items-center gap-8">
        <div className="flex items-center gap-3 px-4 py-1.5 bg-slate-900 border border-slate-800 rounded-full shadow-lg">
           <div className={cn(
             "w-2 h-2 rounded-full", 
             isEnded ? "bg-slate-600" : isLastMinute ? "bg-red-500 animate-pulse" : "bg-emerald-500"
           )} />
           <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
             {isEnded ? "Tournament Concluded" : isLastMinute ? "Final Minute" : "Arena Active"}
           </span>
        </div>

        <div className="flex items-start justify-center gap-2 sm:gap-6">
          <div className="flex flex-col items-center gap-3">
            <div className={cn(
              "flex items-center justify-center min-w-[70px] sm:min-w-[110px] h-20 sm:h-28 rounded-[2rem] bg-white dark:bg-slate-950 border-2 shadow-xl transition-all duration-500",
              isLastMinute ? "border-red-200 text-red-600 bg-red-50/50" : "border-slate-100 text-slate-900 dark:text-white dark:border-slate-800"
            )}>
              <span className="text-4xl sm:text-6xl font-black tracking-tighter tabular-nums leading-none">
                {hours.toString().padStart(2, '0')}
              </span>
            </div>
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Hours</span>
          </div>
          
          <div className="pt-6 sm:pt-9">
            <span className="text-3xl sm:text-4xl font-black text-slate-200 dark:text-slate-800 animate-pulse">:</span>
          </div>

          <div className="flex flex-col items-center gap-3">
            <div className={cn(
              "flex items-center justify-center min-w-[70px] sm:min-w-[110px] h-20 sm:h-28 rounded-[2rem] bg-white dark:bg-slate-950 border-2 shadow-xl transition-all duration-500",
              isLastMinute ? "border-red-500 text-red-600 bg-red-50 animate-pulse" : "border-slate-100 text-slate-900 dark:text-white dark:border-slate-800"
            )}>
              <span className="text-4xl sm:text-6xl font-black tracking-tighter tabular-nums leading-none">
                {minutes.toString().padStart(2, '0')}
              </span>
            </div>
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Minutes</span>
          </div>

          <div className="pt-6 sm:pt-9">
            <span className="text-3xl sm:text-4xl font-black text-slate-200 dark:text-slate-800 animate-pulse">:</span>
          </div>

          <div className="flex flex-col items-center gap-3">
            <div className={cn(
              "flex items-center justify-center min-w-[70px] sm:min-w-[110px] h-20 sm:h-28 rounded-[2rem] bg-white dark:bg-slate-950 border-2 shadow-xl transition-all duration-500",
              isLastMinute ? "border-red-500 text-red-600 bg-red-50" : "border-slate-100 text-slate-900 dark:text-white dark:border-slate-800"
            )}>
              <span className={cn(
                "text-4xl sm:text-6xl font-black tracking-tighter tabular-nums leading-none",
                isLastMinute ? "text-red-500" : "text-indigo-600 dark:text-indigo-400"
              )}>
                {seconds.toString().padStart(2, '0')}
              </span>
            </div>
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Seconds</span>
          </div>
        </div>
      </div>
    </div>
  );
}



function ArenaPlayerCard({ player, rank, isTD, onSelectWhite, onSelectBlack, selectedWhite, selectedBlack }: { player: Player, rank?: number, isTD?: boolean, onSelectWhite?: (id: number) => void, onSelectBlack?: (id: number) => void, selectedWhite?: number | null, selectedBlack?: number | null }) {
  const points = player.arenaPoints || 0;
  
  return (
    <Card className={cn(
      "group relative overflow-hidden transition-all duration-300 hover:shadow-md border-none",
      player.arenaStatus === 'playing' && "opacity-60 cursor-not-allowed"
    )}>
      <CardContent className="p-5 flex flex-col items-center">
        <div className="absolute top-3 left-3 flex items-center justify-center w-6 h-6 rounded-md bg-muted text-[10px] font-semibold text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
          {rank ? rank.toString().padStart(2, '0') : '--'}
        </div>

        <div className="relative mb-3">
          <div className="w-14 h-14 rounded-full flex items-center justify-center bg-muted text-muted-foreground transition-all group-hover:bg-primary/10 group-hover:text-primary">
            <User className="h-6 w-6" />
          </div>
          {player.onFire && (
            <div className="absolute -bottom-1 -right-1 bg-orange-500 p-1 rounded-full shadow-sm border-2 border-white">
              <Flame className="h-2 w-2 text-white fill-white" />
            </div>
          )}
        </div>

        <div className="text-center space-y-1 mb-4">
          <h3 className="text-base font-semibold text-foreground leading-tight truncate max-w-full">
            {player.firstName} {player.lastName}
          </h3>
          <p className="text-xs font-medium text-muted-foreground bg-muted/50 px-2 py-0.5 rounded inline-block">
            Rating: {player.rating}
          </p>
        </div>

        <div className="flex items-center gap-4 pl-4 border-l">
          <div className="text-center">
            <span className="text-[10px] font-medium text-muted-foreground block">Score</span>
            <span className="text-xl font-bold text-primary">{points}</span>
          </div>
          <div className="text-center">
            <span className="text-[10px] font-medium text-muted-foreground block">Streak</span>
            <span className="text-xl font-bold text-orange-500">{player.arenaStreak || 0}</span>
          </div>
        </div>

        {isTD && player.arenaStatus === 'lobby' && (
          <div className="w-full grid grid-cols-2 gap-2 mt-4">
            <Button
              size="sm"
              variant={selectedWhite === player.id ? "default" : "outline"}
              onClick={() => onSelectWhite?.(player.id)}
              className="h-9 font-medium text-xs"
            >
              White
            </Button>
            <Button
              size="sm"
              variant={selectedBlack === player.id ? "default" : "outline"}
              onClick={() => onSelectBlack?.(player.id)}
              className={cn(
                "h-9 font-medium text-xs",
                selectedBlack === player.id ? "bg-primary" : ""
              )}
            >
              Black
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ArenaLobby({ tournamentId, isTD, userId }: ArenaUIProps) {
  const { toast } = useToast();
  const [whitePlayerId, setWhitePlayerId] = useState<number | null>(null);
  const [blackPlayerId, setBlackPlayerId] = useState<number | null>(null);

  const { data: players, isLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/arena/lobby`],
    refetchInterval: 3000,
  });

  const { data: tournament } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const { data: matches } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
  });

  const lobby = { activeMatchCount: matches?.filter(m => m.status === 'playing').length || 0 };

  const isExpired = React.useMemo(() => {
    if (!tournament?.arenaStartTime || !tournament?.arenaDuration) return false;
    const endTime = new Date(new Date(tournament.arenaStartTime).getTime() + tournament.arenaDuration * 60000);
    return new Date() > endTime;
  }, [tournament]);

  const pairMutation = useMutation({
    mutationFn: async () => {
      if (!whitePlayerId || !blackPlayerId) return;
      return await apiRequest(`/api/tournaments/${tournamentId}/arena/pair`, {
        method: "POST",
        body: JSON.stringify({ whitePlayerId, blackPlayerId }),
      });
    },
    onSuccess: () => {
      toast({ title: "Protocol Initiated", description: "Standard match sequence confirmed." });
      setWhitePlayerId(null);
      setBlackPlayerId(null);
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/arena/lobby`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const startArenaMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/tournaments/${tournamentId}/arena/start`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      toast({ title: "System Online", description: "Arena pool has been activated." });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/arena/lobby`] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const availablePlayers = players?.filter(p => p.arenaStatus === 'lobby') || [];
  const playingPlayers = players?.filter(p => p.arenaStatus === 'playing') || [];
  const pausedPlayers = players?.filter(p => p.arenaStatus === 'paused') || [];
  const unavailablePlayers = [...playingPlayers, ...pausedPlayers];

  if (isLoading) return <div className="flex justify-center p-24"><div className="animate-spin h-10 w-10 border-[3px] border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-6 duration-700">

      {isTD && tournament?.status === 'active' && (
        <Card className="bg-slate-50 dark:bg-slate-900 border shadow-sm rounded-3xl overflow-hidden">
          <CardHeader className="pb-2 border-b bg-white dark:bg-slate-950">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <Swords className="h-5 w-5 text-indigo-500" />
                  Manual Match Pairing
                </CardTitle>
                <p className="text-xs text-muted-foreground font-medium">Director override: force a specific board assignment</p>
              </div>
              <Button 
                 disabled={!whitePlayerId || !blackPlayerId || pairMutation.isPending || isExpired}
                 onClick={() => pairMutation.mutate()}
                 className="font-bold px-6 h-10 rounded-xl"
              >
                 {pairMutation.isPending ? "Connecting..." : "Confirm Pair"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row items-stretch gap-4">
              <div className={cn(
                "flex-1 p-6 rounded-2xl border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center text-center",
                whitePlayerId ? "bg-white dark:bg-slate-950 border-indigo-200 shadow-sm" : "bg-muted/10 border-muted-foreground/10"
              )}>
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 mb-3">White Player</span>
                <p className={cn("text-xl font-black tracking-tight truncate w-full", whitePlayerId ? "text-slate-900 dark:text-white" : "text-muted-foreground/10 italic")}>
                  {players?.find(p => p.id === whitePlayerId) ? `${players.find(p => p.id === whitePlayerId)?.firstName} ${players.find(p => p.id === whitePlayerId)?.lastName}` : "Select from table below"}
                </p>
              </div>
              
              <div className="flex items-center justify-center p-2">
                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center border shadow-inner">
                  <span className="text-[10px] font-black text-muted-foreground">VS</span>
                </div>
              </div>

              <div className={cn(
                "flex-1 p-6 rounded-2xl border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center text-center",
                blackPlayerId ? "bg-slate-900 border-slate-700 shadow-lg scale-[1.02]" : "bg-muted/10 border-muted-foreground/10"
              )}>
                <span className={cn("text-[10px] font-black uppercase tracking-widest mb-3", blackPlayerId ? "text-slate-500" : "text-muted-foreground/40")}>Black Player</span>
                <p className={cn("text-xl font-black tracking-tight truncate w-full", blackPlayerId ? "text-white" : "text-muted-foreground/10 italic")}>
                  {players?.find(p => p.id === blackPlayerId) ? `${players.find(p => p.id === blackPlayerId)?.firstName} ${players.find(p => p.id === blackPlayerId)?.lastName}` : "Select from table below"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isTD && tournament?.status === 'registration' && (
        <Card className="bg-primary text-primary-foreground border-none shadow-lg overflow-hidden relative">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
          <CardContent className="p-8 sm:p-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-8 relative z-10">
            <div className="max-w-xl space-y-2">
              <h3 className="text-3xl font-semibold">Start Arena Tournament</h3>
              <p className="text-primary-foreground/70 text-sm font-medium leading-relaxed">
                Activate the tactical pool. Once online, players will be continuously paired based on performance metrics.
              </p>
            </div>
            <Button 
               size="lg"
               variant="secondary"
               onClick={() => startArenaMutation.mutate()}
               disabled={startArenaMutation.isPending}
               className="font-semibold px-8 h-12 rounded-full shadow-md hover:scale-105 transition-transform"
            >
               {startArenaMutation.isPending ? "Activating..." : "Start Tournament"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between border-b pb-4 px-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-foreground tracking-tight">Ready Players & Standings</h2>
            <Badge variant="secondary" className="px-3 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-600 border-none">
              {players?.length || 0} Total
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <span>{availablePlayers.length} Waiting</span>
            </div>
            <div className="flex items-center gap-1.5 ml-4">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span>{playingPlayers.length} In-Match</span>
            </div>
          </div>
        </div>

        <Card className="border-none shadow-sm overflow-hidden bg-background">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/30 border-b">
                <TableRow className="hover:bg-transparent border-none">
                  <TableHead className="w-12 pl-6 text-[10px] font-black uppercase text-muted-foreground/50 tracking-wider h-10">#</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground/50 tracking-wider h-10">Player</TableHead>
                  <TableHead className="hidden md:table-cell text-[10px] font-black uppercase text-muted-foreground/50 tracking-wider h-10">Performance Sequence</TableHead>
                  <TableHead className="pr-4 text-right text-[10px] font-black uppercase text-muted-foreground/50 tracking-wider h-10">Points</TableHead>
                  {isTD && <TableHead className="w-32 pr-6 text-right text-[10px] font-black uppercase text-muted-foreground/50 tracking-wider h-10">Matching</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {players && [...players]
                  .sort((a, b) => parseFloat(b.arenaPoints || "0") - parseFloat(a.arenaPoints || "0"))
                  .map((player, index) => (
                  <StandingsRow 
                    key={player.id} 
                    player={player} 
                    rank={index + 1}
                    isTD={isTD}
                    matches={matches || []}
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
          {players?.length === 0 && (
            <div className="py-20 flex flex-col items-center justify-center text-center opacity-40">
              <Users className="h-12 w-12 mb-4" />
              <p className="text-sm font-medium italic">Competition protocol pending: no registrations found</p>
            </div>
          )}
        </Card>
      </div>

      {/* Removed separate In-Progress grid as it is now integrated into the main Standings table */}
    </div>
  );
}

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
    mutationFn: async ({ matchId, result }: { matchId: number, result: string }) => {
      return await apiRequest(`/api/tournaments/${tournamentId}/arena/results`, {
        method: "POST",
        body: JSON.stringify({ matchId, result }),
      });
    },
    onSuccess: () => {
      toast({ title: "Result Recorded", description: "Standings have been adjusted accordingly." });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/arena/lobby`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/arena/standings`] });
    },
  });

  const activeMatches = matches?.filter(m => m.status === 'pending' || m.status === 'in_progress' || m.status === 'playing' || m.status === 'scheduled');

  if (isLoading) return <div className="flex justify-center p-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

   const ActivePlayerEntry = ({ player, side }: { player?: Player, side: 'W' | 'B' }) => (
    <div className="flex items-center gap-4 py-3 px-4 rounded-xl bg-muted/30">
      <div className={cn(
        "w-12 h-12 rounded-lg flex items-center justify-center text-lg font-bold shadow-sm",
        side === 'W' ? "bg-white text-foreground border" : "bg-foreground text-background"
      )}>
        {side}
      </div>
        <div className="flex-1 min-w-0">
          <span className="block text-lg font-semibold text-foreground leading-none mb-1 truncate">
            {player?.firstName} {player?.lastName}
          </span>
          <div className="flex items-center gap-4 pl-4 border-l">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-muted-foreground">Rating</span>
              <span className="text-xs font-semibold">{player?.rating || '-'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-muted-foreground">Points</span>
              <span className="text-xs font-semibold text-primary">{player?.arenaPoints || 0}</span>
            </div>
          </div>
        </div>
    </div>
  );

  return (
    <div className="space-y-8">
      {activeMatches?.length === 0 ? (
        <Card className="border-none bg-muted/20">
          <CardContent className="py-12 flex flex-col items-center justify-center text-center">
            <Swords className="h-10 w-10 text-muted-foreground/20 mb-4" />
            <h4 className="text-xs font-semibold text-muted-foreground mb-1">No Active Matches</h4>
            <p className="text-xs text-muted-foreground">Start a pairing in the Lobby to see active boards here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {activeMatches?.map((match, idx) => {
            const white = players?.find(p => p.id === match.whitePlayerId);
            const black = players?.find(p => p.id === match.blackPlayerId);
            
            return (
              <Card key={match.id} className="border-none shadow-sm overflow-hidden bg-background hover:shadow-md transition-shadow">
                <CardContent className="p-4 sm:p-6">
                  <div className="flex flex-col lg:flex-row items-center gap-6 lg:gap-12">
                    <div className="flex-1 w-full grid grid-cols-1 md:grid-cols-2 gap-4 relative">
                      <ActivePlayerEntry player={white} side="W" />
                      <div className="hidden md:flex absolute inset-0 items-center justify-center pointer-events-none">
                         <Badge variant="outline" className="bg-background text-[10px] font-bold px-3 py-0.5">VS</Badge>
                      </div>
                      <ActivePlayerEntry player={black} side="B" />
                    </div>

                    <div className="w-full lg:w-auto flex lg:flex-col items-center justify-between lg:justify-center gap-4 border-t lg:border-t-0 lg:border-l pt-4 lg:pt-0 lg:pl-10">
                      <div className="flex flex-col items-start lg:items-center">
                         <span className="text-[10px] font-medium text-muted-foreground mb-1">Board</span>
                         <span className="text-2xl font-bold leading-none">{(match.board || idx + 1).toString().padStart(2, '0')}</span>
                      </div>

                      {isTD ? (
                        <div className="flex items-center gap-1.5">
                           <Button 
                              size="sm"
                              variant="outline"
                              onClick={() => resultMutation.mutate({ matchId: match.id, result: "1-0" })}
                              className="h-8 px-3 font-mono text-sm font-bold hover:bg-primary hover:text-primary-foreground"
                           >
                              1-0
                           </Button>
                           <Button 
                              size="sm"
                              variant="outline"
                              onClick={() => resultMutation.mutate({ matchId: match.id, result: "0-1" })}
                              className="h-8 px-3 font-mono text-sm font-bold hover:bg-primary hover:text-primary-foreground"
                           >
                              0-1
                           </Button>
                           <Button 
                              size="sm"
                              variant="outline"
                              onClick={() => resultMutation.mutate({ matchId: match.id, result: "1/2-1/2" })}
                              className="h-8 px-3 font-mono text-sm font-bold hover:bg-muted-foreground hover:text-white"
                           >
                              ½-½
                           </Button>
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-xs py-1 px-3">
                          {match.result || "Playing"}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ArenaStandings({ tournamentId, userId }: ArenaUIProps) {
  const { data: standings, isLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/arena/standings`],
    refetchInterval: 5000,
  });

  const { data: matches } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
  });

  if (isLoading) return <div className="flex justify-center p-24"><div className="animate-spin h-10 w-10 border-[3px] border-primary border-t-transparent rounded-full" /></div>;

  return (
    <Card className="border-none shadow-md overflow-hidden bg-background">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted/30 border-b">
            <TableRow className="hover:bg-transparent border-none">
              <TableHead className="w-12 pl-6 text-[10px] font-black uppercase text-muted-foreground/50 tracking-wider h-12">#</TableHead>
              <TableHead className="text-[10px] font-black uppercase text-muted-foreground/50 tracking-wider h-12">Combatant</TableHead>
              <TableHead className="hidden md:table-cell text-[10px] font-black uppercase text-muted-foreground/50 tracking-wider h-12">Performance Sequence</TableHead>
              <TableHead className="pr-6 text-right text-[10px] font-black uppercase text-muted-foreground/50 tracking-wider h-12">Arena Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {standings?.map((player, index) => (
              <StandingsRow 
                key={player.id} 
                player={player} 
                rank={index + 1}
                isTD={false}
                matches={matches || []}
                onSelectWhite={() => {}}
                onSelectBlack={() => {}}
                selectedWhite={null}
                selectedBlack={null}
                currentUser={player.userId === userId}
              />
            ))}
          </TableBody>
        </Table>
      </div>
      {standings?.length === 0 && (
        <div className="py-24 flex flex-col items-center justify-center text-center opacity-30">
          <Trophy className="h-12 w-12 mb-4" />
          <p className="text-sm font-medium tracking-tight">No sequence data available yet</p>
        </div>
      )}
    </Card>
  );
}
