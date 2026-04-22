import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, Users, Info, ChevronRight, Star, Plus, Minus, RotateCcw, Crown, Settings2, Swords, History, CheckCircle2, RefreshCcw, Maximize2, Zap, Target } from "lucide-react";
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
import { calculateMatchupScore, getMatchFormat, isMatchDecided, parseTournamentConfig } from "@shared/tournament-config";

interface KnockoutBracketProps {
  tournamentId: number;
  sectionId?: string;
  initialProgressCollapsed?: boolean;
}

// Utility to calculate scoring and winner for a series of games
const getMatchupScoring = (boardMatches: Match[], tournament?: Tournament) => {
  if (boardMatches.length === 0 || !tournament) {
    return { player1Id: null, player2Id: null, p1Score: 0, p2Score: 0, winnerId: null, isCompleted: false, isBye: false, isArmageddon: false };
  }

  const firstMatch = boardMatches[0];
  const bracketType = firstMatch.bracketType || 'winners';
  const config = parseTournamentConfig(tournament);
  const format = getMatchFormat(config, firstMatch.round, bracketType as any);
  
  const score = calculateMatchupScore(boardMatches);
  const decision = isMatchDecided(score, format, boardMatches[boardMatches.length - 1]);
  const winnerId = decision.winnerId;
  
  const isCompleted = decision.decided;
  const isBye = firstMatch.isBye || (!score.p2Id && score.p1Id && boardMatches.some(m => m.status === 'completed'));
  const isArmageddon = boardMatches.some(m => m.isArmageddon);

  return { 
    player1Id: score.p1Id, 
    player2Id: score.p2Id, 
    p1Score: score.p1Score, 
    p2Score: score.p2Score, 
    winnerId, 
    isCompleted, 
    isBye,
    isArmageddon
  };
};

export default function KnockoutBracket({ tournamentId, sectionId, initialProgressCollapsed }: KnockoutBracketProps) {
  const { user } = useAuth();
  const isTD = user?.role === 'tournament_director';
  const BASE_CELL_HEIGHT = 200; // Increased for more breathability
  
  const getRoundCellHeight = (round: number, isLosers: boolean = false) => {
    if (isLosers) {
      const p = Math.floor((round - 1) / 2);
      return Math.pow(2, p) * BASE_CELL_HEIGHT;
    }
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
    return matches.filter(m => {
      if (!sectionId) return true;
      return m.sectionId === sectionId;
    });
  }, [matches, sectionId]);

  const { data: tournament, isLoading: tournamentLoading, refetch: refetchTournament } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
    refetchInterval: 5000,
  });

  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [isManagementOpen, setIsManagementOpen] = useState(false);
  const [isProgressExpanded, setIsProgressExpanded] = useState(!initialProgressCollapsed);

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
    
    Object.keys(grouped).forEach(type => {
      Object.values(grouped[type as keyof typeof grouped]).forEach(boards => {
        Object.values(boards).forEach(games => {
          games.sort((a, b) => (a.gameNumber || 1) - (b.gameNumber || 1));
        });
      });
    });
    
    return grouped;
  }, [filteredMatches]);

  // Round display helper
  const getRoundName = (roundNum: number, totalRoundsCount: number) => {
    if (roundNum === totalRoundsCount) return "Grand Final";
    if (roundNum === totalRoundsCount - 1) return "Semifinals";
    if (roundNum === totalRoundsCount - 2) return "Quarterfinals";
    return `Round ${roundNum}`;
  };

  const getPlayer = (playerId: number | null) => {
    if (!playerId || !players) return null;
    return players.find(p => p.id === playerId);
  };

  const getBoardLetter = (board: number) => String.fromCharCode(64 + board);

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

  // Dimensions
  const playersCount = players?.length || 0;
  const mainRoundSize = Math.pow(2, Math.floor(Math.log2(Math.max(playersCount, 2))));
  const hasPrelim = playersCount > mainRoundSize;
  const bracketSize = hasPrelim ? mainRoundSize * 2 : mainRoundSize;
  const totalRoundsCount = Math.log2(bracketSize);
  const TOTAL_BRACKET_HEIGHT = (bracketSize / 2) * BASE_CELL_HEIGHT;
  const roundIndices = Array.from({ length: totalRoundsCount }, (_, i) => i + 1);
  const maxRound = totalRoundsCount;

  const finalScoring = getMatchupScoring(
    tournament?.isDoubleElimination 
      ? (matchesByRoundAndBoard.grand_final[1]?.[1] || [])
      : ((maxRound > 0) ? (matchesByRoundAndBoard.winners[maxRound]?.[1] || []) : []),
    tournament || undefined
  );

  const isTournamentCompleted = finalScoring.isCompleted && finalScoring.winnerId !== null;
  const winnerId = finalScoring.winnerId;

  if (playersLoading || matchesLoading || tournamentLoading) {
    return (
      <div className="w-full h-[750px] bg-[#0a0c10] rounded-3xl flex items-center justify-center border border-white/5">
        <div className="flex flex-col items-center gap-6">
          <div className="relative">
            <div className="w-20 h-20 rounded-full border-4 border-amber-500/10 border-t-amber-500 animate-spin" />
            <Trophy className="absolute inset-0 m-auto h-8 w-8 text-amber-500 animate-pulse" />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-white font-black uppercase tracking-[0.3em] text-xs">Architecting Bracket</h3>
            <p className="text-slate-500 text-[10px] font-bold tracking-widest">SYNCHRONIZING TOURNAMENT DATA</p>
          </div>
        </div>
      </div>
    );
  }

  if (totalRoundsCount === 0) {
    return (
      <Card className="bg-[#0a0c10] border-white/5 rounded-3xl overflow-hidden">
        <CardContent className="py-24 text-center">
          <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-8 ring-1 ring-amber-500/20">
            <Info className="h-10 w-10 text-amber-500/50" />
          </div>
          <h3 className="text-xl font-black text-white uppercase tracking-tighter">System Idle</h3>
          <p className="text-slate-500 mt-4 max-w-xs mx-auto text-sm leading-relaxed font-medium">
            The knockout engine is ready. Initialize the bracket from the dashboard to begin the championship journey.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="w-full h-[800px] border rounded-[3rem] bg-[#08090d] overflow-hidden relative group shadow-[0_40px_100px_-20px_rgba(0,0,0,0.9)] border-white/5 select-none">
      {/* Premium Background System */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-40">
        <filter id="noiseFilter">
          <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#noiseFilter)" />
      </svg>
      
      {/* Dynamic Grid */}
      <div className="absolute inset-0 opacity-[0.05] pointer-events-none" 
        style={{ 
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: '80px 80px' 
        }} 
      />

      {/* Ambient Glows */}
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-amber-500/10 rounded-full blur-[150px] pointer-events-none animate-pulse-slow" />
      <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[120px] pointer-events-none animate-pulse-slow" style={{ animationDelay: '2s' }} />

      {/* Header Info */}
      <div className="absolute top-10 left-10 z-20 flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <motion.div initial={{ x: -30, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
            <div className="bg-white/[0.03] backdrop-blur-3xl border border-white/10 rounded-2xl p-1.5 flex items-center gap-1.5 shadow-2xl ring-1 ring-white/5">
              <div className="bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl p-3 shadow-[0_0_30px_rgba(245,158,11,0.5)]">
                <Trophy className="h-6 w-6 text-black" />
              </div>
              <div className="px-5 py-1">
                <h2 className="text-[10px] font-black text-amber-500 uppercase tracking-[0.4em] leading-none mb-1.5">World Class Tournament</h2>
                <p className="text-white font-black text-lg tracking-tight uppercase">Knockout Stage</p>
              </div>
            </div>
          </motion.div>
          
          <motion.div initial={{ x: -30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.1 }}>
            <div className="bg-white/[0.03] backdrop-blur-2xl border border-white/10 rounded-2xl px-6 py-4 shadow-2xl ring-1 ring-white/5 flex items-center gap-6">
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em] mb-1.5">Total Entrants</span>
                <span className="text-white font-black text-sm tabular-nums tracking-wider">{players?.length || 0} CONTENDERS</span>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em] mb-1.5">System Status</span>
                <div className="flex items-center gap-2.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.9)]" />
                  <span className="text-emerald-400 font-black text-[11px] uppercase tracking-widest">Live Engine</span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Enhanced Progress Panel */}
      <div className="absolute top-10 right-10 z-20 w-80">
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-[#12141a]/95 backdrop-blur-3xl border border-white/10 shadow-[0_40px_80px_rgba(0,0,0,0.7)] rounded-[3rem] overflow-hidden ring-1 ring-white/5"
        >
          <div 
            className="p-8 bg-gradient-to-b from-white/[0.08] to-transparent border-b border-white/10 cursor-pointer group/header flex items-center justify-between transition-colors hover:bg-white/[0.04]"
            onClick={() => setIsProgressExpanded(!isProgressExpanded)}
          >
            <div className="flex items-center gap-5">
              <div className={cn(
                "p-3 rounded-2xl transition-all duration-500 transform",
                isProgressExpanded ? "bg-amber-500/20 text-amber-500 ring-1 ring-amber-500/40 rotate-180" : "bg-slate-800 text-slate-500 group-hover/header:text-white"
              )}>
                {isProgressExpanded ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mb-1">Global Roadmap</span>
                <span className="text-white font-black text-xs tracking-tight uppercase">Tournament Progress</span>
              </div>
            </div>
            <Target className="h-5 w-5 text-slate-600 group-hover/header:text-amber-500 transition-colors" />
          </div>
          
          <AnimatePresence>
            {isProgressExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
              >
                <div className="max-h-[450px] overflow-y-auto custom-scrollbar-premium">
                  {roundIndices.map((r, i) => {
                    const roundMatches: Match[] = [];
                    ['winners', 'losers', 'grand_final'].forEach(type => {
                      const boards = (matchesByRoundAndBoard as any)[type][r] || {};
                      Object.values(boards).forEach((matches: any) => roundMatches.push(...matches));
                    });

                    const completed = roundMatches.filter(m => m.status === 'completed').length;
                    const total = roundMatches.length;
                    if (total === 0) return null;
                    
                    const progress = (completed / total) * 100;
                    const isActive = r === (tournament?.currentRound || 0);

                    return (
                      <div key={r} className={cn(
                        "p-8 transition-all duration-500 border-b border-white/5 relative group/item",
                        isActive ? "bg-amber-500/[0.05]" : "hover:bg-white/[0.03]"
                      )}>
                        {isActive && <div className="absolute left-0 top-6 bottom-6 w-1.5 bg-amber-500 rounded-full shadow-[0_0_20px_rgba(245,158,11,0.6)]" />}
                        <div className="flex items-center justify-between mb-5">
                           <div className="flex flex-col">
                             <span className={cn(
                               "text-[11px] font-black uppercase tracking-[0.3em] transition-colors",
                               isActive ? "text-amber-400" : "text-slate-500 group-hover/item:text-slate-300"
                             )}>
                              {getRoundName(r, totalRoundsCount)}
                             </span>
                             {isActive && <span className="text-[8px] text-amber-500/50 font-bold uppercase mt-1 tracking-tighter">Current Phase</span>}
                           </div>
                           <div className="flex items-center gap-3">
                             <span className={cn("text-sm font-black tabular-nums tracking-tighter", isActive ? "text-amber-500" : "text-slate-400")}>
                               {completed}<span className="text-slate-700 px-1">/</span>{total}
                             </span>
                           </div>
                        </div>
                        <div className="h-2.5 w-full bg-white/[0.05] rounded-full overflow-hidden ring-1 ring-white/10 relative shadow-inner">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${progress}%` }}
                            className={cn(
                              "h-full transition-all duration-1000 relative",
                              isActive ? "bg-gradient-to-r from-amber-600 to-amber-300 shadow-[0_0_25px_rgba(245,158,11,0.4)]" : "bg-slate-700/50"
                            )}
                          >
                            {isActive && (
                               <motion.div 
                                 animate={{ x: ['-100%', '200%'] }}
                                 transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
                                 className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                               />
                            )}
                          </motion.div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                {/* Visual Legend */}
                <div className="p-6 bg-white/[0.02] flex items-center justify-center gap-6">
                   <div className="flex items-center gap-2">
                     <div className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
                     <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Active</span>
                   </div>
                   <div className="flex items-center gap-2">
                     <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                     <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Standby</span>
                   </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Main Bracket Viewer */}
      <TransformWrapper
        initialScale={0.65}
        minScale={0.3}
        maxScale={2.5}
        centerOnInit
        limitToBounds={false}
        panning={{ velocityDisabled: true }}
        wheel={{ step: 0.02 }}
        pinch={{ step: 0.02 }}
        doubleClick={{ disabled: true }}
      >
        {(utils: any) => (
          <div className="relative w-full h-full">
            {/* Viewport Controls Interface */}
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20">
               <motion.div 
                 initial={{ y: 30, opacity: 0 }}
                 animate={{ y: 0, opacity: 1 }}
                 className="bg-[#12141a]/95 backdrop-blur-3xl p-4 rounded-[2.5rem] border border-white/10 shadow-[0_30px_70px_rgba(0,0,0,0.8)] ring-1 ring-white/5 flex items-center gap-6"
               >
                 <div className="flex items-center gap-3 px-6 border-r border-white/10 h-10">
                    <Maximize2 className="h-5 w-5 text-slate-500" />
                    <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em]">Optics Control</span>
                 </div>
                 <ZoomControls utils={utils} />
               </motion.div>
            </div>

            <TransformComponent 
              wrapperClass="!w-full !h-full" 
              contentClass="flex items-center justify-center min-h-full py-[500px] px-[800px]"
            >
              <div className="flex items-center gap-x-56">
                <div className="flex flex-col gap-y-72">
                  {/* Winners Bracket Tree */}
                  <div className="flex flex-col gap-y-24">
                    <div className="flex flex-start gap-x-0">
                      {roundIndices.map((roundNum, rIdx) => {
                        const numMatchesInRound = bracketSize / Math.pow(2, roundNum);
                        const boardIndices = Array.from({ length: numMatchesInRound }, (_, i) => i + 1);
                        const cellHeight = getRoundCellHeight(roundNum);
                        
                        return (
                          <motion.div 
                            key={`winners-${roundNum}`} 
                            initial={{ x: 100, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            transition={{ delay: rIdx * 0.2, duration: 1, ease: [0.23, 1, 0.32, 1] }}
                            className="flex flex-col shrink-0" 
                            style={{ width: 420 }}
                          >
                            <div className="px-16 mb-16 flex flex-col items-center">
                              <div className="text-[13px] font-black text-amber-500 uppercase tracking-[0.5em] mb-3">{getRoundName(roundNum, totalRoundsCount)}</div>
                              <div className="h-px w-32 bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
                            </div>
                            <div className="flex flex-col" style={{ height: TOTAL_BRACKET_HEIGHT }}>
                               {boardIndices.map((boardNum) => {
                                 const boardMatches = (matchesByRoundAndBoard.winners[roundNum]?.[boardNum] || []);
                                 return (
                                   <div key={`slot-${roundNum}-${boardNum}`} style={{ height: cellHeight }} className="flex items-center justify-center relative">
                                     <MatchCard 
                                       id={`winners-match-${roundNum}-${getBoardLetter(boardNum)}`}
                                       boardMatches={boardMatches}
                                       roundNum={roundNum}
                                       boardNum={boardNum}
                                       isLastRound={roundNum === totalRoundsCount && !tournament?.isDoubleElimination}
                                       getBoardLetter={getBoardLetter}
                                       getPlayerName={getPlayerName}
                                       getPlayerRating={getPlayerRating}
                                       cellHeight={BASE_CELL_HEIGHT}
                                       tournament={tournament}
                                       onSelect={() => {
                                         if (isTD && boardMatches.length > 0) {
                                           setSelectedMatch(boardMatches[0]);
                                           setIsManagementOpen(true);
                                         }
                                       }}
                                     />
                                   </div>
                                 );
                               })}
                             </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Losers Bracket Tree */}
                  {tournament?.isDoubleElimination && (
                    <div className="flex flex-col gap-y-24 border-t border-white/10 pt-48 relative">
                      <div className="absolute top-12 left-12 bg-blue-500/10 px-6 py-2 rounded-full border border-blue-500/20 shadow-2xl">
                         <span className="text-[11px] font-black text-blue-500 uppercase tracking-[0.4em]">Lower Bracket Retrieval</span>
                      </div>
                      <div className="flex items-start gap-x-0">
                        {Array.from({ length: (totalRoundsCount - 1) * 2 }, (_, i) => i + 1).map((roundNum, rIdx) => {
                          const roundBoards = matchesByRoundAndBoard.losers[roundNum] || {};
                          const maxBoard = Math.max(...Object.keys(roundBoards).map(Number), 0);
                          const cellHeight = getRoundCellHeight(roundNum, true);
                          const p = Math.floor((roundNum - 1) / 2);
                          const numMatchesInRound = (bracketSize / 4) / Math.pow(2, p);
                          const boardIndices = Array.from({ length: Math.max(numMatchesInRound, maxBoard) }, (_, i) => i + 1);
                          
                          return (
                            <motion.div 
                              key={`losers-${roundNum}`} 
                              initial={{ x: 100, opacity: 0 }}
                              animate={{ x: 0, opacity: 1 }}
                              transition={{ delay: rIdx * 0.15, duration: 1 }}
                              className="flex flex-col shrink-0" 
                              style={{ width: 420 }}
                            >
                              <div className="px-16 mb-16 flex flex-col items-center">
                                <div className="text-[12px] font-black text-blue-500/60 uppercase tracking-[0.4em] mb-2">LB Round {roundNum}</div>
                                <div className="h-px w-24 bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />
                              </div>
                              <div className="flex flex-col" style={{ height: TOTAL_BRACKET_HEIGHT }}>
                                {boardIndices.map((boardNum) => (
                                  <div key={`loser-slot-${roundNum}-${boardNum}`} style={{ height: cellHeight }} className="flex items-center justify-center relative">
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
                                        tournament={tournament}
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
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Cinematic Finale Group */}
                <div className="flex items-center gap-x-64 pt-60">
                  {tournament?.isDoubleElimination && (
                    <div className="flex flex-col items-center relative">
                       {/* Spotlight Glow */}
                       <div className="absolute inset-0 bg-purple-500/10 blur-[100px] scale-150 pointer-events-none" />
                       
                       <div className="mb-16 bg-gradient-to-r from-purple-500/20 via-purple-500/30 to-purple-500/20 px-10 py-3 rounded-full border border-purple-500/30 shadow-[0_0_50px_rgba(168,85,247,0.2)]">
                         <span className="text-[12px] font-black text-purple-400 uppercase tracking-[0.6em]">Absolute Finale</span>
                       </div>
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
                          className="w-[460px] scale-[1.35] z-10"
                          tournament={tournament}
                          onSelect={() => {
                            if (isTD) {
                              setSelectedMatch(matchesByRoundAndBoard.grand_final[1]?.[1]?.[0] || null);
                              setIsManagementOpen(true);
                            }
                          }}
                        />
                    </div>
                  )}

                  {/* Ultimate Champion Throne */}
                  <motion.div 
                    initial={{ scale: 0.3, opacity: 0, rotateY: 90 }}
                    animate={{ scale: 1, opacity: 1, rotateY: 0 }}
                    transition={{ type: "spring", damping: 20, stiffness: 80, delay: 0.8 }}
                    className="flex flex-col items-center relative perspective-[1000px]"
                  >
                    <div className="relative">
                      {/* Celestial Background Effect */}
                      <div className="absolute inset-0 bg-amber-500/40 rounded-full blur-[120px] animate-pulse-slow pointer-events-none" />
                      <motion.div 
                         animate={{ rotate: -360 }}
                         transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
                         className="absolute inset-0 opacity-20"
                      >
                         <div className="w-full h-full border-[2px] border-dashed border-amber-500 rounded-full scale-[2.2]" />
                      </motion.div>
                      
                      <div className="w-80 h-80 rounded-[4rem] bg-gradient-to-br from-amber-100 via-amber-500 to-amber-950 flex items-center justify-center relative shadow-[0_0_150px_rgba(245,158,11,0.6)] border-[16px] border-white/20 group cursor-pointer overflow-hidden backdrop-blur-md">
                        <Trophy className="h-40 w-40 text-white drop-shadow-[0_20px_40px_rgba(0,0,0,0.6)] transform group-hover:scale-110 transition-all duration-1000 ease-out" />
                        <motion.div 
                          animate={{ rotate: 360 }}
                          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                          className="absolute inset-0 border-[30px] border-dotted border-white/10 rounded-full scale-[1.8]"
                        />
                        {/* Interactive Sparkle Layer */}
                        <div className="absolute inset-0 bg-gradient-to-tr from-white/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                      </div>
                    </div>
                    
                    <motion.div 
                       initial={{ y: 60, opacity: 0 }}
                       animate={{ y: 0, opacity: 1 }}
                       transition={{ delay: 1.2, duration: 1, ease: [0.23, 1, 0.32, 1] }}
                       className="mt-24 text-center bg-[#15171e]/90 backdrop-blur-[40px] p-20 rounded-[5rem] border border-white/15 min-w-[600px] shadow-[0_60px_120px_rgba(0,0,0,0.9)] relative group overflow-hidden ring-1 ring-white/10"
                    >
                      <div className="absolute inset-0 bg-gradient-to-b from-amber-500/[0.1] to-transparent pointer-events-none" />
                      
                      <div className="flex items-center justify-center gap-6 mb-10">
                         <div className="h-px w-20 bg-gradient-to-r from-transparent to-amber-500/40" />
                         <div className="bg-amber-500/10 px-4 py-1.5 rounded-full border border-amber-500/30">
                            <span className="text-[12px] font-black text-amber-500 uppercase tracking-[0.6em]">Eternal Glory</span>
                         </div>
                         <div className="h-px w-20 bg-gradient-to-l from-transparent to-amber-500/40" />
                      </div>
                      
                      <div className="text-7xl font-black text-white uppercase tracking-tighter drop-shadow-[0_10px_20px_rgba(0,0,0,1)] mb-10 leading-none">
                        {isTournamentCompleted ? getPlayerName(winnerId ?? null, 0, 0, 'white') : "Awaiting the One"}
                      </div>
                      
                      {isTournamentCompleted && (
                        <div className="flex items-center justify-center gap-6">
                           <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 2 }}>
                             <Star className="h-8 w-8 text-amber-500 fill-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.5)]" />
                           </motion.div>
                           <motion.div animate={{ y: [-5, 5, -5] }} transition={{ repeat: Infinity, duration: 3 }}>
                             <Star className="h-12 w-12 text-amber-400 fill-amber-400 shadow-[0_0_30px_rgba(251,191,36,0.6)]" />
                           </motion.div>
                           <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 2, delay: 0.5 }}>
                             <Star className="h-8 w-8 text-amber-500 fill-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.5)]" />
                           </motion.div>
                        </div>
                      )}
                      
                      {/* Decorative Corner Elements */}
                      <div className="absolute top-0 left-0 w-24 h-24 border-t-2 border-l-2 border-amber-500/20 rounded-tl-[4rem] pointer-events-none" />
                      <div className="absolute bottom-0 right-0 w-24 h-24 border-b-2 border-r-2 border-amber-500/20 rounded-br-[4rem] pointer-events-none" />
                    </motion.div>
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
  className, boardMatches, roundNum, boardNum, isLastRound, isLosers, tournament, getBoardLetter, getPlayerName, getPlayerRating, cellHeight, onSelect, id 
}: {
  className?: string, boardMatches: Match[], roundNum: number, boardNum: number, isLastRound: boolean, isLosers?: boolean, tournament?: Tournament,
  getBoardLetter: (b: number) => string, getPlayerName: any, getPlayerRating: any, cellHeight: number, onSelect?: () => void, id?: string
}) {
  const { 
    player1Id, player2Id, p1Score, p2Score, winnerId, isCompleted, isBye, isArmageddon 
  } = getMatchupScoring(boardMatches, tournament);

  const formatScore = (score: number) => {
    if (score % 1 === 0) return score.toString();
    return (Math.floor(score) === 0 ? "" : Math.floor(score)) + "\u00BD";
  };

  const p1Won = winnerId === player1Id && player1Id !== null;
  const p2Won = winnerId === player2Id && player2Id !== null;

  return (
    <div className={cn("relative flex items-center group/match-wrapper", className)}>
      {/* Dynamic Side Indicator */}
      <div className="absolute -left-20 flex flex-col items-center opacity-0 group-hover/match-wrapper:opacity-100 transition-all duration-700 -translate-x-6 group-hover/match-wrapper:translate-x-0 z-20">
        <div className={cn(
          "w-12 h-12 rounded-[1.25rem] flex items-center justify-center border-2 text-sm font-black shadow-[0_15px_30px_rgba(0,0,0,0.5)] backdrop-blur-3xl transition-transform hover:scale-110",
          isLosers ? "bg-blue-500/20 border-blue-500/40 text-blue-400" : "bg-amber-500/20 border-amber-500/40 text-amber-400"
        )}>
          {getBoardLetter(boardNum)}
        </div>
      </div>

      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <motion.div
              whileHover={{ scale: 1.06, translateY: -8, rotateZ: 0.5 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
              className="relative"
            >
              <Card 
                id={id}
                onClick={onSelect}
                className={cn(
                  "w-[340px] overflow-hidden border-0 transition-all duration-700 relative group/match shadow-[0_40px_90px_-20px_rgba(0,0,0,0.8)]",
                  "bg-[#15171e]/98 backdrop-blur-[50px] ring-1 ring-white/10 hover:ring-amber-500/60 cursor-pointer rounded-[2rem] p-1",
                  isCompleted && (isLosers ? "ring-blue-500/40 shadow-[0_0_40px_rgba(59,130,246,0.1)]" : "ring-amber-500/40 shadow-[0_0_40px_rgba(245,158,11,0.1)]"),
                  boardMatches.length === 0 && "opacity-15 grayscale scale-90 pointer-events-none"
                )}
              >
                {/* Visual Metadata Overlay */}
                {isArmageddon && (
                  <div className="absolute top-2 right-2 z-30">
                    <motion.div 
                      animate={{ scale: [1, 1.1, 1], opacity: [0.8, 1, 0.8] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="bg-red-500/30 text-red-400 border border-red-500/40 px-3 py-1 rounded-xl text-[8px] font-black tracking-[0.2em] uppercase flex items-center gap-1.5 backdrop-blur-xl shadow-lg"
                    >
                      <Zap className="h-3 w-3 fill-current" />
                      Armageddon
                    </motion.div>
                  </div>
                )}

                {/* Internal Glow Effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.05] via-transparent to-transparent opacity-0 group-hover/match:opacity-100 transition-opacity duration-1000" />
                
                <div className="flex flex-col relative z-10 bg-black/20 rounded-[1.75rem] overflow-hidden divide-y divide-white/[0.03]">
                  <PlayerRow 
                     name={isBye && !player1Id ? "BYE" : getPlayerName(player1Id, roundNum, boardNum, 'white', isLosers ? 'losers' : 'winners')}
                     rating={getPlayerRating(player1Id)}
                     score={isBye && !player1Id ? "-" : formatScore(p1Score)}
                     won={p1Won}
                     isPlaceholder={!player1Id}
                     isByeSlot={isBye && !player1Id}
                  />
                  
                  <PlayerRow 
                     name={isBye && !player2Id ? "BYE" : getPlayerName(player2Id, roundNum, boardNum, 'black', isLosers ? 'losers' : 'winners')}
                     rating={getPlayerRating(player2Id)}
                     score={isBye && !player2Id ? "-" : formatScore(p2Score)}
                     won={p2Won}
                     isPlaceholder={!player2Id}
                     isByeSlot={isBye && !player2Id}
                  />
                </div>
              </Card>
            </motion.div>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-[#0a0c10]/98 border border-white/10 p-0 overflow-hidden shadow-[0_60px_120px_rgba(0,0,0,1)] w-[360px] backdrop-blur-[60px] rounded-[2.5rem] ring-1 ring-white/10">
               <div className="bg-white/[0.04] px-8 py-6 border-b border-white/5 flex items-center justify-between">
                 <div className="flex items-center gap-5">
                   <div className="w-10 h-10 rounded-2xl bg-amber-500/15 flex items-center justify-center border border-amber-500/30">
                     <History className="h-5 w-5 text-amber-500" />
                   </div>
                   <div className="flex flex-col">
                     <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mb-1">Combat Records</span>
                     <span className="text-white font-black text-[12px] tracking-tight uppercase">BATTLE LOG HISTORY</span>
                   </div>
                 </div>
                 <Badge variant="outline" className="text-[9px] font-black border-amber-500/20 text-amber-500/70">{isLosers ? 'Survival Path' : 'Champions Path'}</Badge>
               </div>
               <div className="p-8 space-y-8">
                  {[
                    { id: player1Id, pos: 'white', score: p1Score },
                    { id: player2Id, pos: 'black', score: p2Score }
                  ].map((pInfo) => (
                    <div key={pInfo.pos} className="space-y-5">
                       <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className={cn(
                              "w-2 h-2 rounded-full shadow-[0_0_15px_rgba(255,255,255,0.5)]",
                              pInfo.id ? (pInfo.pos === 'white' ? "bg-white" : "bg-slate-600") : "bg-slate-800"
                            )} />
                            <span className="text-sm font-black text-white/95 truncate max-w-[200px] tracking-tight uppercase">
                              {getPlayerName(pInfo.id, roundNum, boardNum, pInfo.pos as any)}
                            </span>
                          </div>
                          <span className="text-lg font-black text-amber-500 tabular-nums drop-shadow-[0_0_10px_rgba(245,158,11,0.3)]">{formatScore(pInfo.score)}</span>
                       </div>
                       <div className="grid grid-cols-4 gap-3">
                          {boardMatches.map((g, i) => {
                            let res = null;
                            const isWhite = g.whitePlayerId === pInfo.id;
                            const isBlack = g.blackPlayerId === pInfo.id;
                            if (isWhite) {
                              if (g.result === "1-0" || g.result === "1-0F") res = "1";
                              else if (g.result === "0-1" || g.result === "0-1F") res = "0";
                              else if (g.result === "1/2-1/2") res = "\u00BD";
                            } else if (isBlack) {
                              if (g.result === "0-1" || g.result === "0-1F") res = "1";
                              else if (g.result === "1-0" || g.result === "1-0F") res = "0";
                              else if (g.result === "1/2-1/2") res = "\u00BD";
                            }
                            return (
                              <div key={i} className="flex flex-col items-center gap-2 p-3 rounded-[1.25rem] bg-white/[0.03] border border-white/10 transition-transform hover:scale-105">
                                <span className="text-[7px] font-black text-slate-600 uppercase tracking-widest mb-1">G{g.gameNumber || i + 1}</span>
                                <div className={cn(
                                  "text-[14px] font-black",
                                  res === "1" ? "text-emerald-400" : res === "0" ? "text-red-400" : "text-slate-400"
                                )}>
                                  {res || "-"}
                                </div>
                              </div>
                            );
                          })}
                       </div>
                    </div>
                  ))}
               </div>
            </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* SVG Kinetic Connections */}
      {!isLastRound && (
        <div className="absolute left-[340px] pointer-events-none z-0" style={{ height: cellHeight, width: 80 }}>
           <svg className="w-full h-full overflow-visible">
              <BracketCurve 
                cellHeight={cellHeight} 
                boardNum={boardNum} 
                roundNum={roundNum} 
                isLosers={isLosers} 
                isCompleted={isCompleted} 
              />
           </svg>
        </div>
      )}
    </div>
  );
}

function BracketCurve({ cellHeight, boardNum, roundNum, isLosers, isCompleted }: any) {
  const isTop = ((!isLosers && boardNum % 2 !== 0) || (isLosers && roundNum % 2 !== 0 && boardNum % 2 !== 0));
  const isBottom = ((!isLosers && boardNum % 2 === 0) || (isLosers && roundNum % 2 !== 0 && boardNum % 2 === 0));
  const isStraight = !isTop && !isBottom;

  const strokeColor = isCompleted 
    ? (isLosers ? "rgba(59, 130, 246, 0.5)" : "rgba(245, 158, 11, 0.6)") 
    : "rgba(255, 255, 255, 0.1)";
  
  const glowColor = isLosers ? "rgba(59, 130, 246, 0.4)" : "rgba(245, 158, 11, 0.4)";

  if (isStraight) {
    return (
      <g>
        <line x1="0" y1="50%" x2="80" y2="50%" stroke={strokeColor} strokeWidth="4" strokeLinecap="round" />
        {isCompleted && (
           <motion.line 
             x1="0" y1="50%" x2="80" y2="50%" 
             stroke={isLosers ? "#3b82f6" : "#f59e0b"} 
             strokeWidth="4" 
             strokeDasharray="15 30"
             animate={{ strokeDashoffset: -45 }}
             transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
             style={{ filter: `drop-shadow(0 0 8px ${glowColor})` }}
           />
        )}
      </g>
    );
  }

  const yTarget = isTop ? (cellHeight / 2) : (-cellHeight / 2);
  const path = `M 0 ${cellHeight/2} C 40 ${cellHeight/2}, 40 ${cellHeight/2 + yTarget}, 80 ${cellHeight/2 + yTarget}`;

  return (
    <g>
      <path d={path} fill="none" stroke={strokeColor} strokeWidth="4" strokeLinecap="round" className="transition-all duration-1000" />
      {isCompleted && (
        <>
          <path d={path} fill="none" stroke={glowColor} strokeWidth="12" strokeLinecap="round" style={{ filter: 'blur(12px)' }} opacity="0.4" />
          <motion.path 
            d={path} 
            fill="none" 
            stroke={isLosers ? "#3b82f6" : "#f59e0b"} 
            strokeWidth="4" 
            strokeLinecap="round"
            strokeDasharray="15 45"
            animate={{ strokeDashoffset: -60 }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
            style={{ filter: `drop-shadow(0 0 10px ${glowColor})` }}
          />
        </>
      )}
    </g>
  );
}

function PlayerRow({ name, rating, score, won, isPlaceholder, isByeSlot }: any) {
  return (
    <div className={cn(
      "flex items-center justify-between transition-all duration-700 relative min-h-[72px] px-8 py-5",
      won && "bg-emerald-500/[0.08]"
    )}>
      <div className="flex items-center gap-6 min-w-0 flex-1 relative z-10">
        {/* State Indicator */}
        <div className={cn(
          "w-2 h-14 rounded-full shrink-0 transition-all duration-1000 transform",
          won ? "bg-emerald-500 shadow-[0_0_30px_rgba(16,185,129,1)] scale-y-110" : "bg-white/[0.05]",
          isByeSlot && "opacity-0"
        )} />
        
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <span className={cn(
              "text-[17px] font-black truncate tracking-tighter transition-colors duration-500 uppercase",
              won ? "text-white" : "text-slate-400",
              isPlaceholder && "text-slate-600/50 italic",
              isByeSlot && "text-slate-700 italic tracking-[0.4em] font-black uppercase text-[11px]"
            )}>
              {name}
            </span>
            {won && <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}><CheckCircle2 className="h-4 w-4 text-emerald-500 fill-emerald-500/10" /></motion.div>}
          </div>
          {rating && (
            <div className="flex items-center gap-2.5">
              <span className="text-[9px] text-slate-600 font-black uppercase tracking-[0.2em]">Grandmaster Rating</span>
              <span className="text-[11px] text-amber-500 font-black tabular-nums">{rating}</span>
            </div>
          )}
        </div>
      </div>
      
      <div className={cn(
        "w-24 flex items-center justify-center text-2xl font-black transition-all duration-700 shrink-0 relative",
        won ? "text-emerald-400 drop-shadow-[0_0_20px_rgba(16,185,129,0.5)]" : "text-slate-800 border-l border-white/10 ml-6"
      )}>
        {won && <div className="absolute inset-0 bg-emerald-500/20 blur-3xl rounded-full" />}
        <span className="relative z-10 tabular-nums">{score}</span>
      </div>
    </div>
  );
}

function ZoomControls({ utils }: { utils: any }) {
  return (
    <div className="flex items-center gap-3 bg-white/[0.04] p-2 rounded-2xl">
      <Button 
        variant="ghost" 
        size="icon" 
        className="h-12 w-12 text-slate-500 hover:text-white hover:bg-white/10 rounded-2xl transition-all"
        onClick={() => utils.zoomIn()}
      >
        <Plus className="h-6 w-6" />
      </Button>
      <Button 
        variant="ghost" 
        size="icon" 
        className="h-12 w-12 text-slate-500 hover:text-white hover:bg-white/10 rounded-2xl transition-all"
        onClick={() => utils.zoomOut()}
      >
        <Minus className="h-6 w-6" />
      </Button>
      <div className="w-px h-8 bg-white/10 mx-2" />
      <Button 
        variant="ghost" 
        size="icon" 
        className="h-12 w-12 text-slate-500 hover:text-white hover:bg-white/10 rounded-2xl transition-all"
        onClick={() => utils.resetTransform()}
      >
        <RotateCcw className="h-6 w-6" />
      </Button>
    </div>
  );
}
