import React, { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Users, Trophy, Calendar, Play, Plus, Undo, FileText, Settings as SettingsIcon, CalendarClock, Calculator, LayoutDashboard, RefreshCw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import SwissPairings from "@/components/swiss-pairings";
import Standings from "@/components/standings";
import SwissStandings from "@/components/swiss-standings";
import RoundRobinCrosstable from "@/components/round-robin-crosstable";
import KnockoutBracket from "@/components/knockout-bracket";
import TournamentBuilder from "@/components/tournament-builder";
import type { Tournament, Player, PlayerRegistration } from "@shared/schema";
import PlayerManager from "@/components/player-manager";
import TournamentPagePanel from "@/components/tournament-page-panel";
import { parseTournamentConfig, buildTournamentPayload, type BoardNumberingSettings } from "@/lib/tournament-config";
import { ArenaLobby, ArenaActiveMatches, ArenaTimer } from "@/components/arena-ui";
import { BoardNumberingCard } from "@/components/tournament-settings/BoardNumberingCard";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";



interface TournamentManagementProps {
  tournamentId: number;
}

export default function TournamentManagement({ tournamentId }: TournamentManagementProps) {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [arenaSubTab, setArenaSubTab] = useState<'lobby' | 'matches'>('lobby');
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Fetch tournament details
  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  // Check if user owns this tournament
  const isOwner = user?.role === 'tournament_director' && tournament && user && tournament.createdBy === user.id;

  // Redirect non-owners to tournament view
  useEffect(() => {
    if (tournament && user && !isOwner) {
      setLocation(`/tournaments/${tournamentId}`);
    }
  }, [tournament, user, isOwner, tournamentId, setLocation]);

  // Ensure activeTab is valid for Arena format
  useEffect(() => {
    if (tournament?.format === 'arena' && activeTab === 'standings') {
      setActiveTab('rounds'); // 'rounds' is renamed to 'Arena Lobby' in the UI
    }
  }, [tournament?.format, activeTab]);

  // Fetch players
  const { data: players = [] } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const [activeRoundSection, setActiveRoundSection] = useState("all");
  const tournamentConfig = useMemo(() => tournament ? parseTournamentConfig(tournament) : null, [tournament]);
  const sections = useMemo(() => tournamentConfig?.sections ?? [], [tournamentConfig]);

  const [boardNumbering, setBoardNumbering] = useState<BoardNumberingSettings>({});
  const [isBoardDirty, setIsBoardDirty] = useState(false);

  useEffect(() => {
    if (tournamentConfig?.boardNumbering) {
      setBoardNumbering(tournamentConfig.boardNumbering);
    }
  }, [tournamentConfig]);

  const updateBoardNumbering = (update: Partial<BoardNumberingSettings>) => {
    setBoardNumbering((prev) => ({ ...prev, ...update }));
    setIsBoardDirty(true);
  };

  const saveBoardNumberingMutation = useMutation({
    mutationFn: async () => {
      if (!tournamentConfig || !tournament) return;
      const updatedConfig = {
        ...tournamentConfig,
        boardNumbering
      };

      await apiRequest(`/api/tournaments/${tournamentId}`, {
        method: "PATCH",
        body: JSON.stringify({ config: JSON.stringify(updatedConfig) })
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
    }
  });

  // Autosave effect for board numbering
  useEffect(() => {
    if (!isBoardDirty) return;

    const timer = setTimeout(() => {
      saveBoardNumberingMutation.mutate();
      setIsBoardDirty(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, [boardNumbering, isBoardDirty, saveBoardNumberingMutation]);


  const generateKnockoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(`/api/tournaments/${tournamentId}/generate-knockout`, {
        method: "POST"
      });
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      queryClient.invalidateQueries({ queryKey: [`/api/standings/${tournamentId}`] });
      toast({ title: "Success", description: "Knockout bracket generated using current player list." });
    }
  });


  const selectTab = (value: string) => {
    setActiveTab(value);
  };

  const [upcomingDialogOpen, setUpcomingDialogOpen] = useState(false);
  const [upcomingMode, setUpcomingMode] = useState<"manual" | "auto">("manual");

  // Start tournament mutation
  const startTournamentMutation = useMutation({
    mutationFn: async (options?: { force?: boolean }) => {
      // Validate clock settings for Arena/Knockout before starting
      if (tournament?.format === 'arena' || tournament?.format === 'knockout') {
        const config = tournament.roundTimings as any;
        const timeControls = config?.details?.timeControls;
        if (!timeControls || timeControls.length === 0 || timeControls.some((c: any) => !c.minutes || c.minutes <= 0)) {
          throw new Error("All clock settings (Minutes) must be configured in Tournament Settings before starting.");
        }
      }

      const body = options?.force ? JSON.stringify({ force: true }) : undefined;
      await apiRequest(`/api/tournaments/${tournamentId}/start`, {
        method: "POST",
        body,
      });
    },
    onSuccess: () => {
      toast({
        title: "Tournament Started",
        description: tournament?.format === 'arena'
          ? "The Arena has begun! Players can now be paired in the Lobby."
          : "Round 1 pairings have been generated!",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      selectTab("rounds");
    },
    onError: (error: unknown) => {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to start tournament. Please try again.",
        variant: "destructive",
      });
    },
  });




  // Generate next round mutation
  const nextRoundMutation = useMutation({
    mutationFn: async () => {
      await apiRequest(`/api/tournaments/${tournamentId}/next-round`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      toast({
        title: "Next Round Generated",
        description: `Round ${(tournament?.currentRound || 0) + 1} pairings are ready!`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      selectTab("rounds");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to generate next round. Ensure all current round matches are completed.",
        variant: "destructive",
      });
    },
  });

  const setUpcomingMutation = useMutation({
    mutationFn: async (mode: "manual" | "auto") => {
      await apiRequest(`/api/tournaments/${tournamentId}/upcoming`, {
        method: "POST",
        body: JSON.stringify({ autoStartMode: mode }),
      });
    },
    onSuccess: (_data, mode) => {
      toast({
        title: "Tournament Updated",
        description:
          mode === "auto"
            ? "Tournament marked as upcoming. It will go live automatically on the start date."
            : "Tournament marked as upcoming. Start it manually when you're ready.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Unable to mark tournament as upcoming. Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setUpcomingDialogOpen(false);
      setUpcomingMode("manual");
    },
  });

  if (tournamentLoading) {
    console.log("Rendering loading state");
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading tournament...</p>
        </div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96">
          <CardContent className="pt-6 text-center">
            <Trophy className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Tournament Not Found</h3>
            <p className="text-gray-600 mb-4">The tournament you're looking for doesn't exist.</p>
            <Button onClick={() => setLocation("/")}>
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isStartStatus = tournament && ["draft", "upcoming"].includes(tournament.status);

  const canGenerateNextRound = tournament?.status === 'active' && (tournament?.currentRound || 0) > 0;

  const handleTabChange = (value: string) => {
    selectTab(value);
  };

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-7xl space-y-6 p-6">

        {/* Tournament Header */}
        <Card className="overflow-hidden shadow-sm">
          <CardContent className="space-y-4 p-6">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2 text-center md:text-left">
                <h1 className="text-3xl font-bold text-gray-900 tracking-tight">{tournament?.name}</h1>
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 text-sm text-gray-600">
                  <Badge variant={tournament?.status === 'active' ? 'default' : tournament?.status === 'completed' ? 'secondary' : 'outline'} className="px-2.5 py-0.5">
                    {tournament?.status.charAt(0).toUpperCase() + tournament?.status.slice(1)}
                  </Badge>
                  <span className="font-medium">{tournament?.format.charAt(0).toUpperCase() + tournament?.format.slice(1)}</span>
                  {tournament?.rounds && tournament.format !== 'arena' && tournament.format !== 'knockout' && (
                    <span className="text-slate-400">• {tournament.rounds} rounds</span>
                  )}
                  <span className="text-slate-400">• {players.length} players</span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center justify-center md:justify-end gap-3 w-full md:w-auto">

                {isStartStatus && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        disabled={startTournamentMutation.isPending}
                        className="w-full sm:w-auto bg-green-600 hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
                      >
                        <Play className="h-4 w-4 mr-2" />
                        {startTournamentMutation.isPending ? "Starting..." : "Start Tournament"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Start this tournament?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {players.length === 0
                            ? "This tournament currently has no registered players. You can still start it now."
                            : `This tournament has ${players.length} player${players.length === 1 ? "" : "s"}. ${tournament.format === 'arena' ? "Are you sure you want to start the arena?" : "Are you sure you want to start round 1?"}`}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => startTournamentMutation.mutate({ force: players.length < 2 })}>
                          Confirm Start
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                {isOwner && tournament.status === "draft" && (
                  <AlertDialog
                    open={upcomingDialogOpen}
                    onOpenChange={(open) => {
                      setUpcomingDialogOpen(open);
                      if (!open) {
                        setUpcomingMode("manual");
                      }
                    }}
                  >
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        onClick={() => setUpcomingDialogOpen(true)}
                        disabled={setUpcomingMutation.isPending || startTournamentMutation.isPending}
                        className="w-full sm:w-auto flex items-center shadow-sm"
                      >
                        <CalendarClock className="h-4 w-4 mr-2" />
                        {setUpcomingMutation.isPending ? "Setting..." : "Set Upcoming Tournament"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Mark as upcoming?</AlertDialogTitle>
                      </AlertDialogHeader>
                      <div className="space-y-4 py-2">
                        <RadioGroup
                          value={upcomingMode}
                          onValueChange={(value) => setUpcomingMode(value as "manual" | "auto")}
                          className="grid gap-3"
                        >
                          <div className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 transition hover:border-slate-300">
                            <RadioGroupItem id="upcoming-manual" value="manual" className="mt-1" />
                            <div>
                              <Label htmlFor="upcoming-manual" className="font-medium">
                                Start Tournament Manually
                              </Label>
                              <p className="text-sm text-slate-500">You will move it live yourself when you're ready.</p>
                            </div>
                          </div>
                          <div className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 transition hover:border-slate-300">
                            <RadioGroupItem id="upcoming-auto" value="auto" className="mt-1" />
                            <div>
                              <Label htmlFor="upcoming-auto" className="font-medium">
                                Auto Set Tournament Live
                              </Label>
                              <p className="text-sm text-slate-500">We will automatically start it on the scheduled start date.</p>
                            </div>
                          </div>
                        </RadioGroup>
                        <p className="text-sm text-slate-600">Are you sure you want to mark this tournament as upcoming?</p>
                      </div>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => setUpcomingMutation.mutate(upcomingMode)}
                          disabled={setUpcomingMutation.isPending}
                        >
                          Confirm
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                {isOwner && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 w-full sm:w-auto border-slate-200 text-slate-600 hover:text-slate-900 font-medium shadow-sm"
                      onClick={() => setLocation(`/tournaments/${tournamentId}/settings`)}
                    >
                      <SettingsIcon className="h-4 w-4 mr-2" />
                      Settings
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 w-full sm:w-auto border-slate-200 text-slate-600 hover:text-slate-900 font-medium shadow-sm"
                      onClick={() => setLocation("/dashboard")}
                    >
                      <Undo className="h-4 w-4 mr-2" />
                      Back to Dashboard
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tournament Management Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="flex w-full min-h-[48px] h-auto flex-nowrap overflow-x-auto no-scrollbar items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200/60 shadow-sm backdrop-blur-sm">
            <TabsTrigger
              value="dashboard"
              className="flex-none md:flex-1 h-full min-h-[38px] flex items-center justify-center gap-2 px-6 rounded-lg text-center text-sm font-semibold text-slate-500 transition-all data-[state=active]:bg-white data-[state=active]:text-black data-[state=active]:shadow-sm"
            >
              <LayoutDashboard className="h-5 w-5" />
              <span className="capitalize">Dashboard</span>
            </TabsTrigger>
            <TabsTrigger
              value="players"
              className="flex-none md:flex-1 h-full min-h-[38px] flex items-center justify-center gap-2 px-6 rounded-lg text-center text-sm font-semibold text-slate-500 transition-all data-[state=active]:bg-white data-[state=active]:text-black data-[state=active]:shadow-sm"
            >
              <Users className="h-5 w-5" />
              <span className="capitalize">Players</span>
            </TabsTrigger>
            <TabsTrigger
              value="rounds"
              className="flex-none md:flex-1 h-full min-h-[38px] flex items-center justify-center gap-2 px-6 rounded-lg text-center text-sm font-semibold text-slate-500 transition-all data-[state=active]:bg-white data-[state=active]:text-black data-[state=active]:shadow-sm"
            >
              <Calendar className="h-5 w-5" />
              <span className="capitalize">
                {tournament.format === 'arena' ? 'Arena' : tournament.format === 'knockout' ? 'Pairings' : 'Rounds'}
              </span>
            </TabsTrigger>
            {tournament.format !== 'arena' && (
              <TabsTrigger
                value="standings"
                className="flex-none md:flex-1 h-full min-h-[38px] flex items-center justify-center gap-2 px-6 rounded-lg text-center text-sm font-semibold text-slate-500 transition-all data-[state=active]:bg-white data-[state=active]:text-black data-[state=active]:shadow-sm"
              >
                <Trophy className="h-5 w-5" />
                <span className="capitalize">
                  {tournament.format === 'knockout' ? 'Bracket' : 'Standings'}
                </span>
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="dashboard" className="mt-6 space-y-8">
            <TournamentBuilder
              mode="edit"
              format={tournament.format}
              tournament={tournament}
              onComplete={() => {
                queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
              }}
            />
          </TabsContent>


          <TabsContent value="players" className="mt-6">
            <PlayerManager tournament={tournament} tournamentId={tournamentId} />
          </TabsContent>




          <TabsContent value="rounds" className="mt-6 space-y-6">
            {tournament.format === 'arena' ? (
              <div className="flex flex-col gap-6">

                <div className="flex flex-col gap-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex bg-slate-100 p-0.5 rounded-lg shadow-inner border border-slate-200">
                        <button
                          onClick={() => setArenaSubTab('lobby')}
                          className={cn(
                            "px-8 py-1.5 rounded-md text-sm font-bold transition-all duration-300",
                            arenaSubTab === 'lobby'
                              ? "bg-white text-black shadow-sm"
                              : "text-slate-500 hover:text-black hover:bg-white/50"
                          )}
                        >
                          Lobby
                        </button>
                        <button
                          onClick={() => setArenaSubTab('matches')}
                          className={cn(
                            "px-8 py-1.5 rounded-md text-sm font-bold transition-all duration-300",
                            arenaSubTab === 'matches'
                              ? "bg-white text-black shadow-sm"
                              : "text-slate-500 hover:text-black hover:bg-white/50"
                          )}
                        >
                          Active Matches
                        </button>
                      </div>

                    </div>

                    {isOwner && (
                      <Sheet>
                        <SheetTrigger asChild>
                          <Button variant="outline" size="sm" className="h-12 px-6 rounded-xl border-slate-200 bg-white hover:bg-slate-50 transition-all shadow-sm font-bold">
                            <SettingsIcon className="h-4 w-4 mr-2" />
                            Board Settings
                          </Button>
                        </SheetTrigger>
                        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
                          <SheetHeader>
                            <SheetTitle>Board Assignment Settings</SheetTitle>
                            <SheetDescription>
                              Configure how board numbers are assigned for this tournament.
                            </SheetDescription>
                          </SheetHeader>
                          <div className="py-6 space-y-6">
                            <BoardNumberingCard value={boardNumbering} onChange={updateBoardNumbering} />
                            <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground pt-2 border-t">
                              {saveBoardNumberingMutation.isPending ? (
                                <span className="flex items-center gap-1.5 text-blue-600 animate-pulse font-medium">
                                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                  Saving...
                                </span>
                              ) : isBoardDirty ? (
                                <span className="flex items-center gap-1.5 text-amber-600 font-medium">
                                  <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                  Unsaved changes
                                </span>
                              ) : (
                                <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                  Saved
                                </span>
                              )}
                            </div>
                          </div>
                        </SheetContent>
                      </Sheet>
                    )}
                  </div>

                  <div className="animate-in fade-in zoom-in-95 duration-1000">
                    {arenaSubTab === 'lobby' ? (
                      <ArenaLobby
                        tournamentId={tournament.id}
                        isTD={!!isOwner}
                        userId={user?.id}
                        onArenaStart={() => setArenaSubTab('matches')}
                      />
                    ) : (
                      <ArenaActiveMatches
                        tournamentId={tournament.id}
                        isTD={!!isOwner}
                        userId={user?.id}
                      />
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <Tabs value={activeRoundSection} onValueChange={setActiveRoundSection}>
                <TabsList>
                  <TabsTrigger value="all">All</TabsTrigger>
                  {sections.map(section => (
                    <TabsTrigger key={section.id} value={section.id}>
                      {section.name}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <Card className="mt-4">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center space-x-2">
                          <Calendar className="h-5 w-5" />
                          <span>Tournament Pairings</span>
                          {(tournament.currentRound || 0) > 0 && (
                            <Badge>Round {tournament.currentRound || 0}</Badge>
                          )}
                        </div>

                        {tournament.status === 'active' && tournament.format !== 'knockout' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-3 text-blue-600 hover:text-blue-700 hover:bg-blue-50/50 rounded-lg font-medium"
                          >
                            <Undo className="h-3.5 w-3.5 mr-1.5" />
                            Undo
                          </Button>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {canGenerateNextRound && tournament.format !== 'knockout' && (
                          <Button
                            size="sm"
                            onClick={() => nextRoundMutation.mutate()}
                            disabled={nextRoundMutation.isPending}
                            className="h-8 bg-blue-600 hover:bg-blue-700 text-[11px] font-bold"
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            {nextRoundMutation.isPending ? "Generating..." : "Next Round"}
                          </Button>
                        )}

                        <Sheet>
                          <SheetTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 px-3 text-slate-500 hover:text-black">
                              <SettingsIcon className="h-4 w-4 mr-1" />
                              Board Settings
                            </Button>
                          </SheetTrigger>
                          <SheetContent className="w-full sm:max-w-md overflow-y-auto">
                            <SheetHeader>
                              <SheetTitle>Board Assignment Settings</SheetTitle>
                              <SheetDescription>
                                Configure how board numbers are assigned for this tournament.
                              </SheetDescription>
                            </SheetHeader>
                            <div className="py-6 space-y-6">
                              <BoardNumberingCard value={boardNumbering} onChange={updateBoardNumbering} />
                              <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground pt-2 border-t">
                                {saveBoardNumberingMutation.isPending ? (
                                  <span className="flex items-center gap-1.5 text-blue-600 animate-pulse font-medium">
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                    Saving...
                                  </span>
                                ) : isBoardDirty ? (
                                  <span className="flex items-center gap-1.5 text-amber-600 font-medium">
                                    <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                    Unsaved changes
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                    Saved
                                  </span>
                                )}
                              </div>
                            </div>
                          </SheetContent>
                        </Sheet>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {tournament.format === 'swiss' || tournament.format === 'roundrobin' || tournament.format === 'knockout' ? (
                      <div className="overflow-x-auto">
                        <SwissPairings tournamentId={tournamentId} activeSection={activeRoundSection} />
                      </div>
                    ) : (
                      <div className="py-8 text-center">
                        <Calendar className="mx-auto mb-4 h-12 w-12 text-gray-400" />
                        <p className="text-gray-600">Pairings will be available once the tournament starts.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Tabs>
            )}
          </TabsContent>

          {tournament.format !== 'arena' && (
            <TabsContent value="standings" className="mt-6">
              {tournament.format === 'roundrobin' ? (
                <RoundRobinCrosstable tournamentId={tournamentId} />
              ) : tournament.format === 'swiss' ? (
                <SwissStandings tournamentId={tournamentId} />
              ) : tournament.format === 'knockout' ? (
                <div className="space-y-6">
                  {(tournament.status === 'draft' || tournament.status === 'registration' || tournament.status === 'upcoming') && (
                    <div className="flex flex-col items-center gap-4 p-6 bg-blue-50/50 rounded-xl border border-blue-100 border-dashed">


                      <Button
                        variant="outline"
                        className="bg-white border-blue-200 text-blue-700 hover:bg-blue-50 font-bold shadow-sm h-11 px-8 rounded-lg"
                        onClick={() => {
                          const playerText = players.length === 1 ? "1 player" : `${players.length} players`;
                          const hasBracket = (tournament.rounds || 0) > 0;
                          const elimType = tournament.isDoubleElimination ? "Double Elimination" : "Single Elimination";
                          const confirmText = hasBracket
                            ? `REGENERATE the ${elimType} bracket for ${playerText}? Any existing scores will be cleared.`
                            : `Generate the ${elimType} bracket for ${playerText}?`;
                          if (window.confirm(confirmText)) {
                            generateKnockoutMutation.mutate();
                          }
                        }}
                        disabled={generateKnockoutMutation.isPending}
                      >
                        <Trophy className="mr-2 h-4 w-4" />
                        {"Generate Knockout Bracket"}
                      </Button>
                      <p className="text-xs text-slate-500 font-medium">Seeding will be based on ratings (Professional FIDE/Symmetrical sequence)</p>
                    </div>
                  )}
                  <KnockoutBracket
                    tournamentId={tournamentId}
                    sectionId={activeRoundSection === 'all' ? undefined : activeRoundSection}
                  />
                </div>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <Trophy className="h-5 w-5" />
                      <span>Tournament Standings</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Standings tournamentId={tournamentId} />
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          )}

        </Tabs>


      </div>
    </div>
  );
}
