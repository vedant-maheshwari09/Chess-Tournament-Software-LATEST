import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Flame, Swords, UserPlus, Pause, Play, Trophy, User, Clock } from "lucide-react";
import type { Player, Match, Tournament } from "@shared/schema";
import { cn } from "@/lib/utils";

interface ArenaUIProps {
  tournamentId: number;
  isTD: boolean;
  userId?: number;
}

export function ArenaTimer({ tournament }: { tournament: Tournament }) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  React.useEffect(() => {
    if (!tournament.arenaStartTime || !tournament.arenaDuration) return;

    const startTime = new Date(tournament.arenaStartTime).getTime();
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

  if (timeLeft === null) {
    return (
      <Card className="bg-slate-800 text-white border-none shadow-lg opacity-60">
        <CardContent className="py-4 flex items-center gap-4">
          <div className="bg-slate-700 p-3 rounded-xl">
            <Clock className="h-6 w-6 text-slate-400" />
          </div>
          <div>
            <p className="text-[10px] uppercase font-black text-slate-400 tracking-[0.2em] mb-1">
              Tournament Timer
            </p>
            <p className="text-2xl font-black uppercase tracking-tighter">
              Awaiting Start
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const hours = Math.floor(timeLeft / 3600);
  const minutes = Math.floor((timeLeft % 3600) / 60);
  const seconds = timeLeft % 60;
  const isLastMinute = timeLeft < 60 && timeLeft > 0;
  const isEnded = timeLeft === 0;

  return (
    <Card className={cn(
      "bg-slate-900 text-white border-none shadow-lg overflow-hidden relative",
      isLastMinute && "animate-pulse border-2 border-red-500",
      isEnded && "opacity-80"
    )}>
      <CardContent className="py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={cn(
            "p-3 rounded-xl shadow-inner",
            isLastMinute ? "bg-red-500" : "bg-indigo-600"
          )}>
            <Clock className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[10px] uppercase font-black text-slate-400 tracking-[0.2em] mb-1">
              Tournament Time Remaining
            </p>
            <p className={cn(
              "text-4xl font-mono font-black tabular-nums leading-none tracking-tighter",
              isLastMinute && "text-red-400"
            )}>
              {hours.toString().padStart(2, '0')}:{minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}
            </p>
          </div>
        </div>
        {isEnded ? (
          <Badge className="bg-red-500 text-white animate-bounce py-1 px-3">FINISH LINE REACHED</Badge>
        ) : isLastMinute ? (
          <Badge className="bg-red-500/20 text-red-100 border-red-500 animate-pulse">FINAL SPRINT</Badge>
        ) : (
          <div className="flex flex-col items-end">
            <Badge variant="outline" className="text-indigo-400 border-indigo-400/30 font-bold mb-1">LIVE ARENA</Badge>
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{tournament.arenaDuration} Min Total</span>
          </div>
        )}
      </CardContent>
      {!isEnded && (
        <div 
          className={cn("absolute bottom-0 left-0 h-1 transition-all duration-1000", isLastMinute ? "bg-red-500" : "bg-indigo-500")} 
          style={{ width: `${(timeLeft / (tournament.arenaDuration * 60)) * 100}%` }} 
        />
      )}
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

  const isExpired = React.useMemo(() => {
    if (!tournament?.arenaStartTime || !tournament?.arenaDuration) return false;
    const endTime = new Date(new Date(tournament.arenaStartTime).getTime() + tournament.arenaDuration * 60000);
    return new Date() > endTime;
  }, [tournament]);

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      const player = players?.find(p => p.userId === userId);
      if (!player) throw new Error("Player not found");
      return await apiRequest(`/api/tournaments/${tournamentId}/arena/status`, {
        method: "POST",
        body: JSON.stringify({ status, playerId: player.id }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/arena/lobby`] });
    },
  });

  const pairMutation = useMutation({
    mutationFn: async () => {
      if (!whitePlayerId || !blackPlayerId) return;
      return await apiRequest(`/api/tournaments/${tournamentId}/arena/pair`, {
        method: "POST",
        body: JSON.stringify({ whitePlayerId, blackPlayerId }),
      });
    },
    onSuccess: () => {
      toast({ title: "Pairing created", description: "The players have been notified." });
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
      toast({ title: "Tournament Started", description: "The arena clock is now ticking!" });
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

  const PlayerCard = ({ player }: { player: Player }) => (
    <Card key={player.id} className={cn(
      "transition-all border-l-4 h-full w-full",
      player.arenaStatus === 'playing' ? "border-l-blue-500 bg-blue-50/30" : 
      player.arenaStatus === 'paused' ? "border-l-yellow-500 bg-yellow-50/30" : "border-l-green-500 shadow-sm hover:shadow-md"
    )}>
      <CardContent className="pt-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="bg-gray-100 p-2 rounded-full">
              <User className={cn("h-4 w-4", player.arenaStatus === 'playing' ? "text-blue-600" : "text-gray-600")} />
            </div>
            {player.onFire && (
              <div className="absolute -top-1 -right-1">
                <Flame className="h-4 w-4 text-orange-500 fill-orange-500 animate-pulse" />
              </div>
            )}
          </div>
          <div>
            <p className="font-bold text-sm">{player.firstName} {player.lastName}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
              {player.rating} • {player.arenaStatus}
            </p>
          </div>
        </div>
        
        {isTD && player.arenaStatus === 'lobby' && (
          <div className="flex flex-col gap-1">
            <Button 
              size="sm" variant={whitePlayerId === player.id ? "default" : "outline"} 
              className={cn("h-6 text-[9px] px-2", whitePlayerId === player.id && "bg-slate-900")}
              onClick={() => setWhitePlayerId(player.id === whitePlayerId ? null : player.id)}
            >
              Set White
            </Button>
            <Button 
              size="sm" variant={blackPlayerId === player.id ? "default" : "outline"} 
              className={cn("h-6 text-[9px] px-2", blackPlayerId === player.id && "bg-slate-900")}
              onClick={() => setBlackPlayerId(player.id === blackPlayerId ? null : player.id)}
            >
              Set Black
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const currentPlayer = players?.find(p => p.userId === userId);

  if (isLoading) return <div className="flex justify-center p-12"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-6 pb-12">
      {/* Timer moved to parent container in management or handled via props */}


      {isTD && tournament?.status === 'registration' && (
        <Card className="bg-gradient-to-r from-orange-500 to-red-600 text-white border-none shadow-xl">
          <CardContent className="pt-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-white/20 p-3 rounded-full animate-pulse">
                <Play className="h-6 w-6 text-white fill-white" />
              </div>
              <div>
                <h3 className="text-xl font-black uppercase tracking-tighter italic">Arena Ready!</h3>
                <p className="text-orange-100 text-sm font-medium">
                  {players?.length || 0} players registered. Ready to start the clock?
                </p>
              </div>
            </div>
            <Button 
              size="lg"
              variant="secondary"
              onClick={() => startArenaMutation.mutate()}
              disabled={startArenaMutation.isPending}
              className="gap-2 font-black uppercase tracking-widest shadow-2xl hover:scale-105 transition-transform px-8 h-14"
            >
              <Play className="h-5 w-5 fill-current" />
              {startArenaMutation.isPending ? "Starting..." : "Start Arena Now"}
            </Button>
          </CardContent>
        </Card>
      )}

      {tournament?.status === 'active' && !isTD && currentPlayer && (
        <Card className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white border-none shadow-xl">
          <CardContent className="pt-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={cn(
                "w-4 h-4 rounded-full border-2 border-white",
                currentPlayer.arenaStatus === 'lobby' ? "bg-green-400 animate-pulse" : "bg-yellow-400"
              )} />
              <div>
                <h3 className="text-lg font-bold">You are {currentPlayer.arenaStatus === 'lobby' ? "Ready to Play" : "On a Break"}</h3>
                <p className="text-blue-100 text-sm">
                  {currentPlayer.arenaStatus === 'lobby' 
                    ? "The Tournament Director can now pair you for a match." 
                    : "Resume your status when you're ready to get paired again."}
                </p>
              </div>
            </div>
            <Button 
              size="lg"
              variant="secondary"
              onClick={() => statusMutation.mutate(currentPlayer.arenaStatus === 'lobby' ? 'paused' : 'lobby')}
              className="gap-2 font-bold shadow-lg"
            >
              {currentPlayer.arenaStatus === 'lobby' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {currentPlayer.arenaStatus === 'lobby' ? "Take a Break" : "Resume Playing"}
            </Button>
          </CardContent>
        </Card>
      )}

      {isTD && (
        <Card className="border-2 border-blue-500 bg-blue-50/50 shadow-inner">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-blue-700 uppercase tracking-widest">
              <Swords className="h-4 w-4" />
              Director Control Panel
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
            <div className="flex-1 grid grid-cols-2 gap-4">
              <div className={cn(
                "p-4 border-2 rounded-xl transition-all flex flex-col justify-center gap-1",
                whitePlayerId ? "bg-white border-blue-400 shadow-md scale-[1.02]" : "bg-gray-100 border-gray-200 border-dashed"
              )}>
                <span className="text-[10px] text-gray-500 uppercase font-black">White Pieces</span>
                <span className="font-bold text-lg truncate">
                  {whitePlayerId ? players?.find(p => p.id === whitePlayerId)?.firstName : "Select Player..."}
                </span>
              </div>
              <div className={cn(
                "p-4 border-2 rounded-xl transition-all flex flex-col justify-center gap-1",
                blackPlayerId ? "bg-slate-900 border-slate-700 shadow-md scale-[1.02] text-white" : "bg-gray-100 border-gray-200 border-dashed"
              )}>
                <span className="text-[10px] text-slate-400 uppercase font-black">Black Pieces</span>
                <span className="font-bold text-lg truncate">
                  {blackPlayerId ? players?.find(p => p.id === blackPlayerId)?.firstName : "Select Player..."}
                </span>
              </div>
            </div>
            <Button 
              size="lg"
              disabled={!whitePlayerId || !blackPlayerId || pairMutation.isPending || isExpired}
              onClick={() => pairMutation.mutate()}
              className={cn(
                "bg-blue-600 hover:bg-blue-700 text-white shadow-xl px-12 group transition-all h-full min-h-[64px]",
                isExpired && "bg-gray-400 grayscale cursor-not-allowed hover:bg-gray-400"
              )}
            >
              {isExpired ? "Arena Ended" : pairMutation.isPending ? "Starting..." : "Start Match!"}
              {!isExpired && <Swords className="ml-2 h-5 w-5 group-hover:rotate-12 transition-transform" />}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-8">
        {availablePlayers.length > 0 && (
          <section>
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full" />
              Available for Pairing ({availablePlayers.length})
            </h3>
            <div className="flex flex-col gap-3">
              {availablePlayers.map(p => <PlayerCard key={p.id} player={p} />)}
            </div>
          </section>
        )}

        {(playingPlayers.length > 0 || pausedPlayers.length > 0) && (
          <section className="pt-4 border-t border-gray-200">
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              Unavailable ({playingPlayers.length + pausedPlayers.length})
            </h3>
            <div className="flex flex-col gap-3">
              {playingPlayers.map(p => <PlayerCard key={p.id} player={p} />)}
              {pausedPlayers.map(p => <PlayerCard key={p.id} player={p} />)}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export function ArenaActiveMatches({ tournamentId, isTD }: ArenaUIProps) {
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
      toast({ title: "Result submitted", description: "Players returned to lobby." });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/arena/lobby`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/arena/standings`] });
    },
  });

  const activeMatches = matches?.filter(m => m.status === 'pending' || m.status === 'in_progress' || m.status === 'playing');

  if (isLoading) return <div>Loading active matches...</div>;

  return (
    <div className="space-y-4">
      {activeMatches?.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed">
          <p className="text-gray-500">No active matches at the moment.</p>
        </div>
      )}

      {activeMatches?.map((match) => {
        const white = players?.find(p => p.id === match.whitePlayerId);
        const black = players?.find(p => p.id === match.blackPlayerId);

        return (
          <Card key={match.id}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex-1 text-right pr-6">
                  <p className="font-bold text-lg">{white?.firstName} {white?.lastName}</p>
                  <p className="text-sm text-gray-500">{white?.rating}</p>
                </div>
                <div className="flex flex-col items-center gap-2 px-8 border-x">
                  <Swords className="h-6 w-6 text-gray-400" />
                  <Badge variant="outline">Board {match.board || '?'}</Badge>
                </div>
                <div className="flex-1 text-left pl-6">
                  <p className="font-bold text-lg">{black?.firstName} {black?.lastName}</p>
                  <p className="text-sm text-gray-500">{black?.rating}</p>
                </div>
              </div>

              {isTD && (
                <div className="mt-6 flex justify-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => resultMutation.mutate({ matchId: match.id, result: '1-0' })}>1-0</Button>
                  <Button size="sm" variant="outline" onClick={() => resultMutation.mutate({ matchId: match.id, result: '1/2-1/2' })}>1/2-1/2</Button>
                  <Button size="sm" variant="outline" onClick={() => resultMutation.mutate({ matchId: match.id, result: '0-1' })}>0-1</Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function ArenaStandings({ tournamentId, userId }: { tournamentId: number, userId?: number }) {
  const { data: standings, isLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/arena/standings`],
    refetchInterval: 5000,
  });

  if (isLoading) return <div>Loading standings...</div>;

  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Rank</TableHead>
              <TableHead>Player</TableHead>
              <TableHead className="text-center">Streak</TableHead>
              <TableHead className="text-right">Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {standings?.map((player, index) => (
              <TableRow key={player.id} className={cn(player.userId === userId && "bg-blue-50")}>
                <TableCell className="font-bold">#{index + 1}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {player.firstName} {player.lastName}
                    {player.onFire && <Flame className="h-4 w-4 text-orange-500 fill-orange-500" />}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex justify-center gap-1">
                    {Array.from({ length: Math.min(player.arenaStreak, 5) }).map((_, i) => (
                      <div key={i} className="w-2 h-2 rounded-full bg-orange-400" />
                    ))}
                    {player.arenaStreak > 5 && <span className="text-[10px] font-bold">+{player.arenaStreak - 5}</span>}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono font-bold text-blue-600">
                  {player.arenaPoints}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
