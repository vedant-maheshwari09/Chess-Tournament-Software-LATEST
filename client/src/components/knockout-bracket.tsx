import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, Users, Info, ChevronRight, Star, Plus, Minus, RotateCcw, Crown, Settings2, Swords, History, CheckCircle2, RefreshCcw } from "lucide-react";
import type { Player, Match, Tournament } from "@shared/schema";
import { TransformWrapper, TransformComponent, useTransformContext } from "react-zoom-pan-pinch";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useMemo, useState } from "react";
import { MatchManagementDialog } from "./match-management-dialog";
import { useQueryClient, useQuery } from "@tanstack/react-query";

interface KnockoutBracketProps {
  tournamentId: number;
  sectionId?: string;
}

export default function KnockoutBracket({ tournamentId, sectionId }: KnockoutBracketProps) {
  const { user } = useAuth();
  const isTD = user?.role === 'tournament_director';
  const BASE_CELL_HEIGHT = 160;
  
  const getRoundCellHeight = (round: number, isLosers: boolean = false) => {
    if (isLosers) {
      // Loser's bracket rounds increment height every 2 rounds
      const p = Math.floor((round - 1) / 2);
      return Math.pow(2, p) * BASE_CELL_HEIGHT;
    }
    // Winner's bracket rounds double height each time
    return Math.pow(2, round - 1) * BASE_CELL_HEIGHT;
  };


  const { data: players, isLoading: playersLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
    refetchInterval: 5000,
  });

  const { data: matches, isLoading: matchesLoading } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
    refetchInterval: 5000,
  });

  const filteredMatches = useMemo(() => {
    if (!matches) return [];
    return matches.filter(m => !sectionId || m.sectionId === sectionId);
  }, [matches, sectionId]);

  const { data: tournament, isLoading: tournamentLoading, refetch: refetchTournament } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
    refetchInterval: 5000,
  });

  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [isManagementOpen, setIsManagementOpen] = useState(false);

  const queryClient = useQueryClient();
  const refetchMatches = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
    refetchTournament();
  };

  const matchesByRoundAndBoard = useMemo(() => {
    const grouped: Record<string, Record<number, Record<number, Match[]>>> = {
      winners: {},
      losers: {},
      grand_final: {}
    };

    filteredMatches.forEach(match => {
      const type = (match.bracketType || 'winners') as 'winners' | 'losers' | 'grand_final';
      const r = match.round;
      const b = match.board || 1;
      
      if (!grouped[type][r]) grouped[type][r] = {};
      if (!grouped[type][r][b]) grouped[type][r][b] = [];
      grouped[type][r][b].push(match);
    });
    
    // Sort games
    Object.keys(grouped).forEach(type => {
      Object.values(grouped[type as keyof typeof grouped]).forEach(boards => {
        Object.values(boards).forEach(games => {
          games.sort((a, b) => (a.gameNumber || 1) - (b.gameNumber || 1));
        });
      });
    });
    
    return grouped;
  }, [filteredMatches]);

  if (playersLoading || matchesLoading || tournamentLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Knockout Bracket</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-12 bg-gray-200 rounded w-1/4"></div>
            <div className="h-64 bg-gray-100 rounded-lg"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Helper to get board letter (1 -> A, 2 -> B, etc.)
  const getBoardLetter = (board: number) => {
    // Restart at A for each round as per user request
    return String.fromCharCode(64 + board);
  };

  const getRoundName = (roundNum: number, totalRoundsCount: number) => {
    if (roundNum === totalRoundsCount) return "Finals";
    if (roundNum === totalRoundsCount - 1) return "Semifinals";
    if (roundNum === totalRoundsCount - 2) return "Quarterfinals";
    return `Round ${roundNum}`;
  };

  const getPlayer = (playerId: number | null) => {
    if (!playerId || !players) return null;
    return players.find(p => p.id === playerId);
  };

  const getPlayerName = (playerId: number | null, round: number, board: number, position: 'white' | 'black', bracketType: string = 'winners') => {
    const player = getPlayer(playerId);
    if (player) return `${player.firstName} ${player.lastName}`;
    
    if (round > 1) {
      if (bracketType === 'losers') {
        const isPhaseA = round % 2 === 0;
        if (isPhaseA) {
          if (position === 'white') return `Loser of WB R${round/2} B${board}`;
          return `Winner of LB R${round-1} B${board}`;
        } else {
          // Phase B or R1
          if (round === 1) {
            const wbBoardStart = (board - 1) * 2 + 1;
            return `Loser of WB R1 B${wbBoardStart}${position === 'white' ? '' : '+1'}`;
          }
          const prevBoard = position === 'white' ? (board * 2 - 1) : (board * 2);
          return `Winner of LB R${round-1} B${prevBoard}`;
        }
      }

      const prevRound = round - 1;
      const prevBoard = position === 'white' ? (board * 2 - 1) : (board * 2);
      return `Winner of ${prevRound}${getBoardLetter(prevBoard)}`;
    }
    
    return "TBD";
  };

  const getPlayerRating = (playerId: number | null) => {
    const player = getPlayer(playerId);
    return player ? (player.rating || 1000) : null;
  };


  const bracketSize = Math.pow(2, Math.ceil(Math.log2(Math.max((players?.length || 0), 2))));
  const TOTAL_BRACKET_HEIGHT = (bracketSize / 2) * BASE_CELL_HEIGHT;
  const totalRoundsCount = Math.log2(bracketSize);
  const roundIndices = Array.from({ length: totalRoundsCount }, (_, i) => i + 1);
  const rounds = roundIndices;
  const maxRound = totalRoundsCount;
  
  // Calculate tournament winner
  const getTopMatch = (r: number, b: number) => {
    const boardMatches = (matchesByRoundAndBoard.winners[r]?.[b] || []);
    return boardMatches[0] || null;
  };

  const finalMatch = tournament?.isDoubleElimination 
    ? (matchesByRoundAndBoard.grand_final[1]?.[1]?.[0] || null)
    : ((maxRound > 0) ? getTopMatch(maxRound, 1) : null);

  const isTournamentCompleted = (finalMatch as Match | null)?.status === 'completed';
  const winnerId = isTournamentCompleted && finalMatch
    ? ((finalMatch as any).winnerId || (finalMatch.result === '1-0' ? finalMatch.whitePlayerId : (finalMatch.result === '0-1' ? finalMatch.blackPlayerId : null))) 
    : null;

  if (rounds.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Info className="mx-auto h-12 w-12 text-slate-300 mb-4" />
          <h3 className="text-lg font-medium text-slate-900">No Bracket Generated</h3>
          <p className="text-slate-500 mt-2">Start the tournament to generate the knockout bracket.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="w-full h-[750px] border rounded-2xl bg-slate-900 overflow-hidden relative group shadow-2xl">
      <div className="absolute top-6 left-6 z-20 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 border-amber-500/20 py-1.5 px-4 backdrop-blur-md shadow-lg shadow-amber-500/5">
            <Trophy className="h-4 w-4 mr-2" />
            <span className="font-bold tracking-tight">KNOCKOUT BRACKET</span>
          </Badge>
          <Badge variant="outline" id="entrant-count-badge" className="bg-white/5 text-slate-400 border-white/10 py-1.5 px-3 backdrop-blur-sm">
            {players?.length || 0} Entrants
          </Badge>
        </div>
      </div>

      {/* Side Profile Panel */}
      <div className="absolute top-6 right-6 z-20 w-72 flex flex-col gap-4">
        <Card className="bg-slate-800/60 backdrop-blur-2xl border-white/10 shadow-2xl overflow-hidden rounded-[1.5rem] border">
          <CardHeader className="p-5 bg-white/5 border-b border-white/10">
            <CardTitle className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center justify-between">
              Live Progress
              <div className="flex items-center gap-1.5 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[8px] text-green-500 font-bold">LIVE</span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-white/5 bg-slate-900/40">
              {rounds.map((r, i) => {
                // Aggregated progress across all bracket types for this round number
                const roundMatches: Match[] = [];
                ['winners', 'losers', 'grand_final'].forEach(type => {
                  const boards = (matchesByRoundAndBoard as any)[type][r] || {};
                  Object.values(boards).forEach((matches: any) => {
                    roundMatches.push(...matches);
                  });
                });

                const completed = roundMatches.filter(m => m.status === 'completed').length;
                const total = roundMatches.length;
                const progress = total > 0 ? (completed / total) * 100 : 0;
                const isActive = r === (tournament?.currentRound || 0);

                return (
                  <div key={r} className={cn("p-4 transition-all duration-300", isActive ? "bg-amber-500/10" : "hover:bg-white/5")}>
                    <div className="flex items-center justify-between mb-2">
                       <span className={cn("text-[10px] font-bold uppercase tracking-wider", isActive ? "text-amber-400" : "text-slate-400")}>
                        {getRoundName(r, totalRoundsCount)}
                       </span>
                       <div className="flex items-center gap-2">
                         <span className={cn("text-[9px] font-black tabular-nums", isActive ? "text-amber-500" : "text-slate-500")}>
                           {completed}/{total}
                         </span>
                       </div>
                    </div>
                    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden ring-1 ring-white/5">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        className={cn("h-full transition-all duration-1000 relative", isActive ? "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]" : "bg-slate-600")}
                      >
                        {isActive && (
                          <motion.div 
                            animate={{ x: ['-100%', '100%'] }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                          />
                        )}
                      </motion.div>
                    </div>
                  </div>
                );
              })}
            </div>
            
            {/* Integrated Legend */}
            <div className="p-4 bg-white/5 border-t border-white/10 flex items-center justify-between">
               <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                    <span className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Champion Path</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-slate-600" />
                    <span className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Completed</span>
                  </div>
               </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <TransformWrapper
        initialScale={0.7}
        minScale={0.1}
        maxScale={3}
        centerOnInit
        limitToBounds={false}
        panning={{ velocityDisabled: true }}
      >
        {(utils: any) => (
          <div className="relative w-full h-full">
            <div className="absolute bottom-6 right-6 z-20 flex items-center gap-2 bg-slate-800/80 backdrop-blur-md p-2 rounded-xl border border-white/10 shadow-2xl">
              <ZoomControls utils={utils} />
            </div>
            <TransformComponent wrapperClass="!w-full !h-full" contentClass="flex items-center justify-center min-h-full py-40 px-60">
              <div className="flex items-center gap-x-32">
                <div className="flex flex-col gap-y-32">
                  {/* Winners Bracket Tree */}
                  <div className="flex flex-col gap-y-12">
                    <div className="px-8 flex items-center gap-4 mb-8">
                      <div className="flex items-center gap-3 bg-amber-500/10 px-4 py-2 rounded-full border border-amber-500/20">
                        <Trophy className="h-4 w-4 text-amber-500" />
                        <span className="text-[10px] font-black text-amber-500 uppercase tracking-[0.2em]">Winners Bracket</span>
                      </div>
                      <div className="h-px flex-1 bg-gradient-to-r from-amber-500/20 to-transparent" />
                    </div>
                    
                    <div className="flex items-start gap-x-0">
                      {roundIndices.map((roundNum) => {
                        const numMatchesInRound = bracketSize / Math.pow(2, roundNum);
                        const boardIndices = Array.from({ length: numMatchesInRound }, (_, i) => i + 1);
                        const cellHeight = getRoundCellHeight(roundNum);
                        
                        return (
                          <div key={`winners-${roundNum}`} id={`winners-round-${roundNum}`} className="flex flex-col shrink-0" style={{ width: 360 }}>
                            <div className="text-center mb-8 h-10 flex items-center justify-center">
                              <Badge variant="outline" className="text-[9px] font-black text-slate-500 border-white/10 uppercase tracking-widest bg-white/5">
                                {getRoundName(roundNum, totalRoundsCount)}
                              </Badge>
                            </div>
                            <div className="flex flex-col" style={{ height: TOTAL_BRACKET_HEIGHT }}>
                              {boardIndices.map((boardNum) => (
                                <div key={`slot-${roundNum}-${boardNum}`} id={`winners-match-slot-${roundNum}-${getBoardLetter(boardNum)}`} style={{ height: cellHeight }} className="flex items-center justify-center relative">
                                  <MatchCard 
                                    id={`winners-match-${roundNum}-${getBoardLetter(boardNum)}`}
                                    boardMatches={matchesByRoundAndBoard.winners[roundNum]?.[boardNum] || []}
                                    roundNum={roundNum}
                                    boardNum={boardNum}
                                    isLastRound={roundNum === totalRoundsCount && !tournament?.isDoubleElimination}
                                    getBoardLetter={getBoardLetter}
                                    getPlayerName={getPlayerName}
                                    getPlayerRating={getPlayerRating}
                                    cellHeight={cellHeight}
                                    onSelect={() => {
                                      if (isTD) {
                                        setSelectedMatch(matchesByRoundAndBoard.winners[roundNum]?.[boardNum]?.[0] || null);
                                        setIsManagementOpen(true);
                                      }
                                    }}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Losers Bracket Tree */}
                  {tournament?.isDoubleElimination && (
                    <div className="flex flex-col gap-y-12">
                      <div className="px-8 flex items-center gap-4 mb-8">
                        <div className="flex items-center gap-3 bg-blue-500/10 px-4 py-2 rounded-full border border-blue-500/20">
                          <RotateCcw className="h-4 w-4 text-blue-500" />
                          <span className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em]">Losers Bracket</span>
                        </div>
                        <div className="h-px flex-1 bg-gradient-to-r from-blue-500/20 to-transparent" />
                      </div>
                      <div className="flex items-start gap-x-0">
                        {Array.from({ length: (totalRoundsCount - 1) * 2 }, (_, i) => i + 1).map((roundNum) => {
                          const roundBoards = matchesByRoundAndBoard.losers[roundNum] || {};
                          const maxBoard = Math.max(...Object.keys(roundBoards).map(Number), 0);
                          const cellHeight = getRoundCellHeight(roundNum, true);
                          
                          // Determine board indices for visual consistency
                          // In LB, the number of matches stays same for 2 rounds, then halves
                          const p = Math.floor((roundNum - 1) / 2);
                          const numMatchesInRound = (bracketSize / 4) / Math.pow(2, p);
                          const boardIndices = Array.from({ length: Math.max(numMatchesInRound, maxBoard) }, (_, i) => i + 1);
                          
                          return (
                            <div key={`losers-${roundNum}`} id={`losers-round-${roundNum}`} className="flex flex-col shrink-0" style={{ width: 360 }}>
                              <div className="text-center mb-8 h-10 flex items-center justify-center">
                                <Badge variant="outline" className="text-[9px] font-black text-slate-500 border-white/10 uppercase tracking-widest bg-white/5">
                                  LB Round {roundNum}
                                </Badge>
                              </div>
                              <div className="flex flex-col" style={{ height: TOTAL_BRACKET_HEIGHT }}>
                                {boardIndices.map((boardNum) => (
                                  <div key={`loser-slot-${roundNum}-${boardNum}`} id={`losers-match-slot-${roundNum}-${getBoardLetter(boardNum)}`} style={{ height: cellHeight }} className="flex items-center justify-center relative">
                                    {matchesByRoundAndBoard.losers[roundNum]?.[boardNum] && (
                                      <MatchCard 
                                        id={`losers-match-${roundNum}-${getBoardLetter(boardNum)}`}
                                        boardMatches={matchesByRoundAndBoard.losers[roundNum]?.[boardNum]}
                                        roundNum={roundNum}
                                        boardNum={boardNum}
                                        isLastRound={roundNum === (totalRoundsCount - 1) * 2}
                                        getBoardLetter={getBoardLetter}
                                        getPlayerName={getPlayerName}
                                        getPlayerRating={getPlayerRating}
                                        isLosers
                                        cellHeight={cellHeight}
                                        onSelect={() => {
                                          if (isTD) {
                                            setSelectedMatch(matchesByRoundAndBoard.losers[roundNum]?.[boardNum]?.[0] || null);
                                            setIsManagementOpen(true);
                                          }
                                        }}
                                      />
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Grand Final & Champion Column Group */}
                <div className="flex items-center gap-x-32 pt-20">
                  {/* Grand Final Column */}
                  {tournament?.isDoubleElimination && (
                    <div className="flex flex-col gap-y-12">
                       <div className="px-8 flex items-center gap-4 mb-8">
                        <div className="flex items-center gap-3 bg-purple-500/10 px-4 py-2 rounded-full border border-purple-500/20">
                          <Crown className="h-4 w-4 text-purple-500" />
                          <span className="text-[10px] font-black text-purple-500 uppercase tracking-[0.2em]">Grand Final</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-center" style={{ height: TOTAL_BRACKET_HEIGHT }}>
                        <MatchCard 
                          id="grand-final-match"
                          boardMatches={matchesByRoundAndBoard.grand_final[1]?.[1] || []}
                          roundNum={1}
                          boardNum={1}
                          isLastRound={true}
                          getBoardLetter={getBoardLetter}
                          getPlayerName={getPlayerName}
                          getPlayerRating={getPlayerRating}
                          cellHeight={BASE_CELL_HEIGHT}
                          className="w-96 scale-110"
                          onSelect={() => {
                            if (isTD) {
                              setSelectedMatch(matchesByRoundAndBoard.grand_final[1]?.[1]?.[0] || null);
                              setIsManagementOpen(true);
                            }
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Champion Display */}
                  <motion.div 
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    id="champion-card"
                    className="flex flex-col items-center relative"
                  >
                    <div className="relative group/champion">
                      {/* Decorative rings */}
                      <div className="absolute inset-0 bg-amber-500/20 rounded-full blur-[60px] animate-pulse" />
                      <div className="w-48 h-48 rounded-[2.5rem] bg-gradient-to-br from-amber-300 via-amber-500 to-amber-700 flex items-center justify-center relative shadow-[0_0_80px_rgba(245,158,11,0.3)] overflow-hidden border-8 border-white/20">
                        <Trophy className="h-24 w-24 text-white drop-shadow-2xl animate-bounce-slow" />
                        <motion.div 
                          animate={{ rotate: 360 }}
                          transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                          className="absolute inset-0 border-[16px] border-dashed border-white/10 rounded-full scale-150"
                        />
                      </div>
                    </div>
                    <div className="mt-12 text-center bg-slate-800/40 backdrop-blur-2xl p-10 rounded-[3rem] border border-white/10 min-w-[400px] shadow-2xl relative overflow-hidden group">
                      <div className="absolute inset-0 bg-gradient-to-b from-amber-500/5 to-transparent" />
                      <h4 className="text-[12px] font-black text-amber-500 uppercase tracking-[0.3em] mb-6">Tournament Champion</h4>
                      <div className="text-4xl font-black text-white uppercase tracking-tight drop-shadow-lg">
                        {isTournamentCompleted ? getPlayerName(winnerId ?? null, 0, 0, 'white') : "Awaiting Final Result"}
                      </div>
                      {isTournamentCompleted && (
                        <div className="mt-6 flex items-center justify-center gap-2">
                           <div className="h-px w-8 bg-amber-500/30" />
                           <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                           <Star className="h-5 w-5 text-amber-500 fill-amber-500" />
                           <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                           <div className="h-px w-8 bg-amber-500/30" />
                        </div>
                      )}
                    </div>
                  </motion.div>
                </div>
              </div>
            </TransformComponent>
          </div>
        )}
      </TransformWrapper>

      <MatchManagementDialog 
        open={isManagementOpen}
        onOpenChange={setIsManagementOpen}
        match={selectedMatch}
        players={players || []}
        allMatches={filteredMatches}
        isTD={isTD}
        tournamentId={tournamentId}
        onMatchUpdated={refetchMatches}
      />
    </div>
  );
}


function MatchCard({ 
  boardMatches, 
  roundNum, 
  boardNum, 
  isLastRound, 
  getBoardLetter, 
  getPlayerName, 
  getPlayerRating,
  isLosers = false,
  cellHeight,
  className,
  onSelect,
  id
}: { 
  boardMatches: Match[], 
  roundNum: number, 
  boardNum: number, 
  isLastRound: boolean, 
  getBoardLetter: (b: number) => string, 
  getPlayerName: (id: number | null, r: number, b: number, pos: 'white' | 'black', bracketType?: string) => string,
  getPlayerRating: (id: number | null) => number | null,
  isLosers?: boolean,
  cellHeight: number,
  className?: string,
  onSelect?: () => void,
  id?: string
}) {
  const isCompleted = boardMatches.some(m => m.status === 'completed');
  const match = boardMatches[0];
  
  let whiteScore = 0;
  let blackScore = 0;
  boardMatches.forEach(g => {
    if (g.result === "1-0" || g.result === "1-0F") whiteScore += 1;
    if (g.result === "0-1" || g.result === "0-1F") blackScore += 1;
    if (g.result === "1/2-1/2") { whiteScore += 0.5; blackScore += 0.5; }
  });

  const formatScore = (score: number) => {
    if (score % 1 === 0) return score.toString();
    return (Math.floor(score) === 0 ? "" : Math.floor(score)) + "½";
  };

  const whiteWon = isCompleted && whiteScore > blackScore;
  const blackWon = isCompleted && blackScore > whiteScore;
  const isBye = boardMatches.some(m => m.isBye) || (boardMatches.length > 0 && !boardMatches[0].blackPlayerId && boardMatches[0].whitePlayerId);

  return (
    <div className={cn("relative flex items-center group/match-wrapper", className)}>
      <div className="absolute -top-3 left-4 z-10 transition-transform group-hover/match-wrapper:-translate-y-1">
        <Badge variant="outline" className={cn(
          "text-[9px] font-black px-2 py-0 border-white/10 backdrop-blur-md shadow-lg",
          isLosers ? "bg-blue-500/90 text-white" : "bg-slate-900/90 text-slate-500"
        )}>
          {isLosers ? 'LB' : 'WB'} {roundNum}{getBoardLetter(boardNum)}
        </Badge>
      </div>

      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Card 
              id={id}
              onClick={onSelect}
              className={cn(
                "w-72 overflow-hidden border-0 transition-all duration-300 relative group/match shadow-2xl",
                "bg-[#21201d] ring-1 ring-white/10 hover:ring-amber-500/50 hover:scale-[1.02] cursor-pointer",
                isCompleted && (isLosers ? "ring-blue-500/30" : "ring-amber-500/30"),
                !match && "opacity-40"
              )}
            >
              <div className="flex flex-col">
                <PlayerRow 
                   name={isBye && !match?.whitePlayerId ? "BYE" : getPlayerName(match?.whitePlayerId || null, roundNum, boardNum, 'white', isLosers ? 'losers' : 'winners')}
                   rating={getPlayerRating(match?.whitePlayerId || null)}
                   score={formatScore(whiteScore)}
                   won={whiteWon}
                   isPlaceholder={!match?.whitePlayerId}
                />
                
                <div className="h-px bg-white/5 w-full" />
                
                <PlayerRow 
                   name={isBye ? "NO OPPONENT" : getPlayerName(match?.blackPlayerId || null, roundNum, boardNum, 'black', isLosers ? 'losers' : 'winners')}
                   rating={getPlayerRating(match?.blackPlayerId || null)}
                   score={formatScore(blackScore)}
                   won={blackWon}
                   isPlaceholder={!match?.blackPlayerId}
                />
              </div>
            </Card>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-[#2b2926] border-white/10 p-0 overflow-hidden shadow-2xl w-64">
                   <div className="bg-[#21201d] px-3 py-2 border-b border-white/5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                     Match Details - {isLosers ? 'Losers' : 'Winners'} Round {roundNum}{getBoardLetter(boardNum)}
                   </div>
                   <div className="p-3">
                      <div className="space-y-4">
                        {[
                          { id: match?.whitePlayerId, name: 'white', score: whiteScore },
                          { id: match?.blackPlayerId, name: 'black', score: blackScore }
                        ].map((player) => (
                          <div key={player.name} className="space-y-2">
                             <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className={cn(
                                    "w-1.5 h-1.5 rounded-full",
                                    player.id ? (player.name === 'white' ? "bg-white" : "bg-slate-600") : "bg-slate-800"
                                  )} />
                                  <span className="text-sm font-bold text-white truncate max-w-[140px]">
                                    {getPlayerName(player.id || null, roundNum, boardNum, player.name as any)}
                                  </span>
                                </div>
                                <span className="text-sm font-black text-[#81b64c]">{formatScore(player.score)}</span>
                             </div>
                             <div className="flex flex-wrap gap-1">
                                {boardMatches.map((g, i) => {
                                  let res = null;
                                  if (player.name === 'white') {
                                    if (g.result === "1-0" || g.result === "1-0F") res = "1";
                                    else if (g.result === "0-1" || g.result === "0-1F") res = "0";
                                    else if (g.result === "1/2-1/2") res = "½";
                                  } else {
                                    if (g.result === "0-1" || g.result === "0-1F") res = "1";
                                    else if (g.result === "1-0" || g.result === "1-0F") res = "0";
                                    else if (g.result === "1/2-1/2") res = "½";
                                  }
                                  
                                  return (
                                    <div key={i} className={cn(
                                      "w-8 h-8 rounded flex items-center justify-center text-[12px] font-black transition-colors",
                                      res === "1" ? "bg-[#81b64c] text-white" : 
                                      res === "0" ? "bg-red-500/20 text-red-400" :
                                      res === "½" ? "bg-slate-600 text-slate-300" :
                                      "bg-slate-800/50 text-slate-600 ring-1 ring-white/5"
                                    )}>
                                      {res || "-"}
                                    </div>
                                  );
                                })}
                             </div>
                          </div>
                        ))}
                      </div>
                   </div>
                </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {!isLastRound && (
        <div className="absolute left-72 flex items-center pointer-events-none z-0 overflow-visible" style={{ height: cellHeight, width: 72 }}>
          {/* Horizontal line out */}
          <div className={cn(
            "h-[2px] transition-colors duration-500 absolute left-0",
            isCompleted ? (isLosers ? "bg-blue-500/60" : "bg-amber-500/60 shadow-[0_0_8px_rgba(245,158,11,0.3)]") : "bg-white/10"
          )} style={{ width: 36, top: '50%' }} />

          {/* Vertical/Diagonal Branching */}
          {((!isLosers && boardNum % 2 !== 0) || (isLosers && roundNum % 2 !== 0 && boardNum % 2 !== 0)) ? (
            <>
              {/* Vertical down */}
              <div className={cn(
                "w-[2px] absolute left-9",
                isCompleted ? (isLosers ? "bg-blue-500/60" : "bg-amber-500/60 shadow-[0_0_8px_rgba(245,158,11,0.3)]") : "bg-white/10"
              )} style={{ height: cellHeight / 2, top: '50%' }} />
              {/* Horizontal into next */}
              <div className={cn(
                "h-[2px] absolute left-9",
                isCompleted ? (isLosers ? "bg-blue-500/60" : "bg-amber-500/60 shadow-[0_0_8px_rgba(245,158,11,0.3)]") : "bg-white/10"
              )} style={{ width: 36, top: `calc(50% + ${cellHeight / 2}px)` }} />
            </>
          ) : ((!isLosers && boardNum % 2 === 0) || (isLosers && roundNum % 2 !== 0 && boardNum % 2 === 0)) ? (
             <>
              {/* Vertical up */}
              <div className={cn(
                "w-[2px] absolute left-9",
                isCompleted ? (isLosers ? "bg-blue-500/60" : "bg-amber-500/60 shadow-[0_0_8px_rgba(245,158,11,0.3)]") : "bg-white/10"
              )} style={{ height: cellHeight / 2, bottom: '50%' }} />
              {/* Horizontal into next */}
              <div className={cn(
                "h-[2px] absolute left-9",
                isCompleted ? (isLosers ? "bg-blue-500/60" : "bg-amber-500/60 shadow-[0_0_8px_rgba(245,158,11,0.3)]") : "bg-white/10"
              )} style={{ width: 36, bottom: `calc(50% + ${cellHeight / 2}px)` }} />
            </>
          ) : (
            /* Straight connection for LB phases or single paths */
            <div className={cn(
              "h-[2px] absolute left-9",
              isCompleted ? (isLosers ? "bg-blue-500/60" : "bg-amber-500/60 shadow-[0_0_8px_rgba(245,158,11,0.3)]") : "bg-white/10"
            )} style={{ width: 72, top: '50%' }} />
          )}
        </div>
      )}
    </div>
  );
}

function PlayerRow({ name, rating, score, won, isPlaceholder }: any) {
  return (
    <div 
      className={cn(
        "flex items-center justify-between transition-all duration-300 relative min-h-[48px] group/row",
        won && "bg-[#81b64c]/10"
      )}
    >
      <div className="flex items-center gap-3 px-4 py-2 min-w-0 flex-1">
        <div className={cn(
          "w-1 h-8 rounded-full shrink-0 transition-all",
          won ? "bg-[#81b64c] shadow-[0_0_8px_rgba(129,182,76,0.6)]" : "bg-white/5"
        )} />
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-[14px] font-bold truncate tracking-tight leading-none",
              won ? "text-white" : "text-[#bababa]",
              isPlaceholder && "text-slate-600 italic font-medium"
            )}>
              {name}
            </span>
          </div>
          {rating && (
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tight mt-1">
              Rating: {rating}
            </span>
          )}
        </div>
      </div>
      
      <div className={cn(
        "w-14 flex items-center justify-center text-[16px] font-black self-stretch transition-all shrink-0",
        won ? "bg-[#81b64c] text-white shadow-inner" : "bg-black/40 text-[#7d7d7d] border-l border-white/5"
      )}>
        {score}
      </div>
    </div>
  );
}


function ZoomControls({ utils }: { utils: any }) {
  return (
    <>
      <Button 
        variant="ghost" 
        size="icon" 
        className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
        onClick={() => utils.zoomIn()}
      >
        <Plus className="h-4 w-4" />
      </Button>
      <Button 
        variant="ghost" 
        size="icon" 
        className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
        onClick={() => utils.zoomOut()}
      >
        <Minus className="h-4 w-4" />
      </Button>
      <div className="w-px h-4 bg-white/10 mx-1" />
      <Button 
        variant="ghost" 
        size="icon" 
        className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
        onClick={() => utils.resetTransform()}
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
    </>
  );
}

