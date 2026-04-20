import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Swords, History, CheckCircle2, RotateCcw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Match, Player } from "@shared/schema";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeftRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

interface MatchManagementDialogProps {
  match: Match | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: Player[];
  allMatches: Match[];
  isTD: boolean;
  tournamentId: number;
  onMatchUpdated: () => void;
}

export function MatchManagementDialog({ 
  match, 
  open, 
  onOpenChange, 
  players, 
  allMatches, 
  isTD, 
  tournamentId, 
  onMatchUpdated 
}: MatchManagementDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const addGameMutation = useMutation({
    mutationFn: async () => {
      if (!match) return;
      const seriesGames = allMatches
        .filter(m => 
          m.round === match.round && 
          m.board === match.board && 
          m.bracketType === match.bracketType &&
          m.sectionId === match.sectionId
        )
        .sort((a, b) => (a.gameNumber || 0) - (b.gameNumber || 0));
      const lastGame = seriesGames.length > 0 ? seriesGames[seriesGames.length - 1] : null;
      const nextWhite = lastGame ? lastGame.blackPlayerId : match.whitePlayerId;
      const nextBlack = lastGame ? lastGame.whitePlayerId : match.blackPlayerId;

      return apiRequest(`/api/tournaments/${tournamentId}/matches/${match.id}/games`, {
        method: "POST",
        body: JSON.stringify({
          whitePlayerId: nextWhite,
          blackPlayerId: nextBlack,
        })
      });
    },
    onSuccess: () => {
      toast({ title: "Game Added", description: "A new game was added to the series." });
      onMatchUpdated();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const confirmWinnerMutation = useMutation({
    mutationFn: async (winnerId: number) => {
      if (!match) return;
      await apiRequest(`/api/tournaments/${tournamentId}/matches/${match.id}/confirm-winner`, {
        method: "POST",
        body: JSON.stringify({ winnerId })
      });
    },
    onSuccess: () => {
      toast({ title: "Winner Confirmed", description: "The winner has advanced to the next round." });
      onOpenChange(false);
      onMatchUpdated();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const resetMatchMutation = useMutation({
    mutationFn: async () => {
      if (!match) return;
      await apiRequest(`/api/tournaments/${tournamentId}/matches/${match.id}/reset`, {
        method: "POST"
      });
    },
    onSuccess: () => {
      toast({ title: "Match Reset", description: "The results and advancement have been cleared." });
      onMatchUpdated();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const updateResultMutation = useMutation({
    mutationFn: async ({ matchId, result }: { matchId: number, result: string | null }) => {
      await apiRequest(`/api/matches/${matchId}`, {
        method: "PUT",
        body: JSON.stringify({ result, status: result ? "completed" : "pending" })
      });
    },
    onSuccess: () => {
      toast({ title: "Result Recorded", description: "The game result has been updated." });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      onMatchUpdated();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const swapColorsMutation = useMutation({
    mutationFn: async (game: Match) => {
      await apiRequest(`/api/matches/${game.id}`, {
        method: "PUT",
        body: JSON.stringify({ 
          whitePlayerId: game.blackPlayerId,
          blackPlayerId: game.whitePlayerId
        })
      });
    },
    onSuccess: () => {
      toast({ title: "Colors Swapped", description: "White and Black players have been reversed." });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      onMatchUpdated();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  if (!match) return null;
  
  const seriesGames = allMatches
    .filter(m => 
      m.round === match.round && 
      m.board === match.board && 
      m.bracketType === match.bracketType &&
      m.sectionId === match.sectionId
    )
    .sort((a, b) => (a.gameNumber || 0) - (b.gameNumber || 0));

  const whitePlayer = players.find(p => p.id === match.whitePlayerId);
  const blackPlayer = players.find(p => p.id === match.blackPlayerId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] bg-slate-900 border-white/10 text-white shadow-2xl overflow-hidden p-0">
        <DialogHeader className="p-6 bg-slate-800/50 border-b border-white/10">
          <div className="flex items-center gap-4 mb-4">
             <div className="p-3 rounded-2xl bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/20">
                <Swords className="h-6 w-6" />
             </div>
             <div>
                <DialogTitle className="text-xl font-black tracking-tight flex items-center gap-2">
                   Match {match.round}{match.board ? String.fromCharCode(64 + match.board) : ''}
                   <Badge variant="outline" className="text-[10px] font-bold border-white/10 text-slate-400">
                     ROUND {match.round}
                   </Badge>
                </DialogTitle>
                <DialogDescription className="text-slate-400 font-medium">
                  Manage the series and confirm the advancing player.
                </DialogDescription>
             </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-6">
             <div className="p-4 rounded-xl bg-white/5 border border-white/5 flex flex-col items-center text-center">
                <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold mb-3 border border-white/10">P1</div>
                <span className="text-sm font-bold text-slate-200">{whitePlayer ? `${whitePlayer.firstName} ${whitePlayer.lastName}` : "TBD"}</span>
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-1">PLAYER 1</span>
             </div>
             <div className="p-4 rounded-xl bg-white/5 border border-white/5 flex flex-col items-center text-center">
                <div className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center text-xs font-bold mb-3 border border-white/10">P2</div>
                <span className="text-sm font-bold text-slate-200">{blackPlayer ? `${blackPlayer.firstName} ${blackPlayer.lastName}` : "TBD"}</span>
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-1">PLAYER 2</span>
             </div>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-6">
           <div className="space-y-4">
              <div className="flex items-center justify-between">
                 <h4 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                  <History className="h-3 w-3" />
                  Series History
                </h4>
                {isTD && (
                   <div className="flex items-center gap-2">
                     <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 text-[10px] font-black uppercase tracking-widest text-blue-400 hover:text-blue-300 hover:bg-blue-400/10"
                      onClick={() => addGameMutation.mutate()}
                      disabled={addGameMutation.isPending}
                     >
                       <Plus className="h-3 w-3 mr-1" />
                       Add Game
                     </Button>
                   </div>
                )}
              </div>

               <div className="space-y-2 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                 {seriesGames.map((g, idx) => (
                  <div key={g.id} className="p-4 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between group/game hover:bg-white-[0.07] transition-colors relative">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-bold text-slate-500 w-4">G{idx + 1}</span>
                      <div className="flex flex-col gap-1 pr-4">
                         <div className="flex items-center gap-2">
                           <span className="text-xs font-bold text-slate-300 w-[120px] truncate">
                             <span className="inline-block w-3 h-3 bg-white rounded-sm border border-slate-700 mr-2 opacity-80 shadow-sm align-text-bottom"></span>
                             {players.find(p => p.id === g.whitePlayerId)?.lastName || 'W'}
                           </span>
                           <span className="text-[9px] font-black text-slate-600 uppercase">vs</span>
                           <span className="text-xs font-bold text-slate-300 w-[120px] truncate">
                             <span className="inline-block w-3 h-3 bg-slate-900 rounded-sm border border-slate-700 mr-2 opacity-80 shadow-sm align-text-bottom"></span>
                             {players.find(p => p.id === g.blackPlayerId)?.lastName || 'B'}
                           </span>
                         </div>
                         {isTD && (
                           <button 
                             onClick={() => swapColorsMutation.mutate(g)}
                             className="text-[9px] text-blue-400/70 hover:text-blue-400 font-bold uppercase tracking-wider flex items-center gap-1 w-fit mt-1 opacity-0 group-hover/game:opacity-100 transition-opacity"
                             disabled={swapColorsMutation.isPending}
                           >
                             <ArrowLeftRight className="h-2.5 w-2.5" />
                             Swap Colors
                           </button>
                         )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {isTD ? (
                        <Select 
                          value={g.result || "pending"} 
                          onValueChange={(val) => {
                            updateResultMutation.mutate({ 
                              matchId: g.id, 
                              result: val === "pending" ? null : val 
                            });
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs bg-slate-900 border-white/10 w-[110px] font-bold text-center justify-center">
                            <SelectValue placeholder="Result" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="1-0">1-0 (White)</SelectItem>
                            <SelectItem value="0-1">0-1 (Black)</SelectItem>
                            <SelectItem value="1/2-1/2">1/2-1/2 (Draw)</SelectItem>
                            <SelectItem value="1-0F">1-0F (Fft)</SelectItem>
                            <SelectItem value="0-1F">0-1F (Fft)</SelectItem>
                            <SelectItem value="0-0F">0-0F (Fft)</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline" className="bg-slate-900 border-white/10 text-xs font-bold">
                           {g.result || 'Pending'}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
           </div>

           {isTD && !match.result && match.whitePlayerId && match.blackPlayerId && (
              <div className="space-y-3 pt-4 border-t border-white/5">
                 <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] text-center mb-4">Advance Player</h4>
                 <div className="grid grid-cols-2 gap-3">
                    <Button 
                     variant="outline"
                     className="h-12 border-white/10 bg-white/5 hover:bg-amber-500/10 hover:border-amber-500/50 text-slate-200 group/btn"
                     onClick={() => confirmWinnerMutation.mutate(match.whitePlayerId!)}
                     disabled={confirmWinnerMutation.isPending}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2 text-slate-500 group-hover/btn:text-amber-500" />
                      Player 1 Wins
                    </Button>
                    <Button 
                     variant="outline"
                     className="h-12 border-white/10 bg-white/5 hover:bg-amber-500/10 hover:border-amber-500/50 text-slate-200 group/btn"
                     onClick={() => confirmWinnerMutation.mutate(match.blackPlayerId!)}
                     disabled={confirmWinnerMutation.isPending}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2 text-slate-500 group-hover/btn:text-amber-500" />
                      Player 2 Wins
                    </Button>
                 </div>
              </div>
           )}
        </div>

        <DialogFooter className="p-4 bg-slate-800/30 border-t border-white/10 flex sm:justify-between items-center px-6">
           {isTD && (
             <Button 
               variant="ghost" 
               size="sm"
               className="h-9 px-4 text-xs font-black uppercase tracking-widest text-red-500 hover:text-red-400 hover:bg-red-500/10"
               onClick={() => resetMatchMutation.mutate()}
               disabled={resetMatchMutation.isPending}
             >
               <RotateCcw className="h-3 w-3 mr-2" />
               Reset Match
             </Button>
           )}
           <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-9 px-6 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-white/5">
             Dismiss
           </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
