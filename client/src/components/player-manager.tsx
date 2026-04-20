import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import {
  Trash2,
  CheckSquare,
  Check,
  PauseCircle,
  Mail,
  Loader2,
  Copy,
  CheckCircle2,
  X,
  ArrowUpDown,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parseTournamentConfig } from "@/lib/tournament-config";
import type { Tournament, Player, Pairing } from "@shared/schema";

type SortKey = "name" | "rating";
type SortDirection = "asc" | "desc";

interface PlayerManagerProps {
  tournament: Tournament;
  tournamentId: number;
}

export default function PlayerManager({ tournament, tournamentId }: PlayerManagerProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingSeedId, setEditingSeedId] = useState<number | null>(null);
  const [seedValue, setSeedValue] = useState<string>("");

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [confirmedMap, setConfirmedMap] = useState<Record<number, boolean>>({});
  const [isDeleting, setIsDeleting] = useState(false);
  const [isStatusDialogOpen, setStatusDialogOpen] = useState(false);
  const [withdrawScope, setWithdrawScope] = useState<"all" | "specific">("all");
  const [selectedRounds, setSelectedRounds] = useState<number[]>([]);
  const [byeType, setByeType] = useState<"zero_point" | "half_point" | "full_point">("zero_point");
  const [isProcessingStatus, setProcessingStatus] = useState(false);
  const [isMessageDialogOpen, setMessageDialogOpen] = useState(false);
  const [messageBody, setMessageBody] = useState("");
  const [isCopyingRecipients, setIsCopyingRecipients] = useState(false);
  const [isCopyingMessage, setIsCopyingMessage] = useState(false);
  const [removingByeIds, setRemovingByeIds] = useState<number[]>([]);
  const [messageChannels, setMessageChannels] = useState({ email: true, sms: false });
  const hasChannelSelected = messageChannels.email || messageChannels.sms;
  const [activeSection, setActiveSection] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const tournamentConfig = useMemo(() => parseTournamentConfig(tournament), [tournament]);
  const sections = tournamentConfig.sections;

  const { data: players = [], isLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const processedPlayers = useMemo(() => {
    let processed = [...players];

    if (activeSection !== "all") {
      processed = processed.filter(p => p.sectionId === activeSection || p.sectionName === activeSection);
    }
    
    processed.sort((a, b) => {
      if (sortKey === 'name') {
        const nameA = `${a.lastName}, ${a.firstName}`;
        const nameB = `${b.lastName}, ${b.firstName}`;
        return sortDirection === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
      }
      if (sortKey === 'rating') {
        const isFide = tournamentConfig.details.primaryRatingSystem === 'fide';
        const ratingA = isFide ? (a.fideRating ?? a.rating ?? 0) : (a.uscfRating ?? a.rating ?? 0);
        const ratingB = isFide ? (b.fideRating ?? b.rating ?? 0) : (b.uscfRating ?? b.rating ?? 0);
        return sortDirection === 'asc' ? ratingA - ratingB : ratingB - ratingA;
      }
      return 0;
    });

    return processed;
  }, [players, activeSection, sortKey, sortDirection]);

  const { data: pairings = [], isLoading: pairingsLoading } = useQuery<Pairing[]>({
    queryKey: [`/api/tournaments/${tournamentId}/pairings`],
  });

  const storageKey = useMemo(() => `tournament-${tournamentId}-confirmed-players`, [tournamentId]);

  const playerByeMap = useMemo(() => {
    const map = new Map<number, Pairing[]>();
    pairings.forEach((pairing) => {
      if (!pairing.isBye) return;
      const entries = map.get(pairing.playerId) ?? [];
      entries.push(pairing);
      map.set(pairing.playerId, entries);
    });
    map.forEach((entries) => {
      entries.sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
    });
    return map;
  }, [pairings]);


  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as Record<number, boolean>;
        setConfirmedMap(parsed);
      } else {
        setConfirmedMap({});
      }
    } catch (error) {
      console.warn("Failed to parse confirmed players from storage", error);
      setConfirmedMap({});
    }
  }, [storageKey]);

  useEffect(() => {
    if (!players.length) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds((prev) => prev.filter((id) => players.some((player) => player.id === id)));
    setConfirmedMap((prev) => {
      const next: Record<number, boolean> = {};
      players.forEach((player) => {
        if (prev[player.id]) {
          next[player.id] = true;
        }
      });
      return next;
    });
  }, [players]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(confirmedMap));
    } catch (error) {
      console.warn("Failed to persist confirmed players", error);
    }
  }, [confirmedMap, storageKey]);

  const selectionCount = selectedIds.length;
  const allIds = useMemo(() => players.map((player) => player.id), [players]);
  const allSelected = selectionCount > 0 && selectionCount === allIds.length && allIds.length > 0;
  const hasSelection = selectionCount > 0;
  const headerCheckboxValue = allSelected ? true : hasSelection ? "indeterminate" : false;
  const allConfirmed = hasSelection && selectedIds.every((id) => confirmedMap[id]);
  const selectionSummary = hasSelection ? `${selectionCount} selected` : "No players selected";

  const totalRounds = useMemo(() => {
    if (!tournament) return 0;
    const planned = tournament.rounds ?? 0;
    const current = tournament.currentRound ?? 0;
    return Math.max(planned, current, 0);
  }, [tournament]);

  const roundOptions = useMemo(() => {
    const rounds = totalRounds > 0 ? totalRounds : 5;
    return Array.from({ length: rounds }, (_, index) => index + 1);
  }, [totalRounds]);

  const selectedPlayers = useMemo(
    () => players.filter((p) => selectedIds.includes(p.id)),
    [players, selectedIds],
  );

  const handleUpdateSeed = async (playerId: number, newSeed: string) => {
    try {
      await apiRequest(`/api/players/${playerId}/seed`, {
        method: "PATCH",
        body: JSON.stringify({ seed: newSeed || null }),
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      setEditingSeedId(null);
    } catch (error: any) {
      toast({
        title: "Failed to update seed",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    }
  };

  const toggleSelectAll = useCallback(
    (checked: boolean) => {
      setSelectedIds(checked ? allIds : []);
    },
    [allIds],
  );

  const toggleSelectPlayer = useCallback((playerId: number, checked: boolean) => {
    setSelectedIds((prev) => {
      if (checked) {
        if (prev.includes(playerId)) return prev;
        return [...prev, playerId];
      }
      return prev.filter((id) => id !== playerId);
    });
  }, []);

  const handleToggleConfirm = useCallback(() => {
    if (!hasSelection) return;
    setConfirmedMap((prev) => {
      const next = { ...prev };
      if (allConfirmed) {
        selectedIds.forEach((id) => {
          delete next[id];
        });
      } else {
        selectedIds.forEach((id) => {
          next[id] = true;
        });
      }
      return next;
    });

    toast({
      title: allConfirmed ? "Players unconfirmed" : "Players confirmed",
      description: `${selectionCount} player${selectionCount === 1 ? "" : "s"} updated.`,
    });
  }, [allConfirmed, hasSelection, selectedIds, selectionCount, toast]);

  const handleDeleteSelected = useCallback(async () => {
    if (!hasSelection) return;
    setIsDeleting(true);
    try {
      await Promise.all(
        selectedIds.map((id) =>
          apiRequest(`/api/players/${id}`, {
            method: "DELETE",
          }),
        ),
      );
      toast({
        title: "Players removed",
        description: `${selectionCount} player${selectionCount === 1 ? "" : "s"} deleted from the roster.`,
      });
      setSelectedIds([]);
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
    } catch (error: any) {
      toast({
        title: "Unable to delete players",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  }, [hasSelection, queryClient, selectedIds, selectionCount, toast, tournamentId]);

  const handleRemoveBye = useCallback(
    async (pairingId: number) => {
      setRemovingByeIds((prev) => (prev.includes(pairingId) ? prev : [...prev, pairingId]));
      try {
        await apiRequest(`/api/pairings/${pairingId}`, {
          method: "DELETE",
        });
        toast({ title: "Bye removed" });
        queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
        queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
        queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      } catch (error: any) {
        toast({
          title: "Unable to remove bye",
          description: error?.message ?? "Please try again.",
          variant: "destructive",
        });
      } finally {
        setRemovingByeIds((prev) => prev.filter((id) => id !== pairingId));
      }
    },
    [queryClient, toast, tournamentId],
  );

  const handleRoundToggle = useCallback((round: number) => {
    setSelectedRounds((prev) => {
      if (prev.includes(round)) {
        return prev.filter((value) => value !== round);
      }
      return [...prev, round].sort((a, b) => a - b);
    });
  }, []);

  const resetStatusForm = useCallback(() => {
    setWithdrawScope("all");
    setSelectedRounds([]);
    setByeType("zero_point");
  }, []);

  const handleStatusSubmit = useCallback(async () => {
    if (!hasSelection) return;
    if (withdrawScope === "specific" && selectedRounds.length === 0) {
      toast({
        title: "Select rounds",
        description: "Choose at least one round when assigning custom byes.",
        variant: "destructive",
      });
      return;
    }

    setProcessingStatus(true);
    try {
      if (withdrawScope === "all") {
        await Promise.all(
          selectedIds.map((id) =>
            apiRequest(`/api/players/${id}/status`, {
              method: "PUT",
              body: JSON.stringify({ status: "withdrawn" }),
            }),
          ),
        );
        toast({
          title: "Players withdrawn",
          description: `${selectionCount} player${selectionCount === 1 ? " was" : "s were"} withdrawn from future rounds.`,
        });
      } else {
        const byePayload = selectedRounds.map((round) => ({ round, type: byeType }));
        await Promise.all(
          selectedIds.map((id) =>
            apiRequest(`/api/players/${id}/status`, {
              method: "PUT",
              body: JSON.stringify({ status: "active", byeRounds: byePayload }),
            }),
          ),
        );
        toast({
          title: "Byes recorded",
          description: `Scheduled ${byePayload.length} round${byePayload.length === 1 ? "" : "s"} for ${selectionCount} player${selectionCount === 1 ? "" : "s"}.`,
        });
      }

      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      setSelectedIds([]);
      resetStatusForm();
      setStatusDialogOpen(false);
    } catch (error: any) {
      toast({
        title: "Unable to update player status",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setProcessingStatus(false);
    }
  }, [
    byeType,
    hasSelection,
    queryClient,
    resetStatusForm,
    selectedIds,
    selectedRounds,
    selectionCount,
    toast,
    tournamentId,
    withdrawScope,
  ]);

  const recipientsList = useMemo(
    () =>
      selectedPlayers
        .map((player) => `${player.firstName ?? ""} ${player.lastName ?? ""}`.trim())
        .filter((name) => name.length > 0)
        .join(", "),
    [selectedPlayers],
  );

  const handleCopyRecipients = useCallback(async () => {
    if (!recipientsList) return;
    try {
      setIsCopyingRecipients(true);
      await navigator.clipboard.writeText(recipientsList);
      toast({ title: "Recipients copied" });
    } catch (error: any) {
      toast({
        title: "Clipboard error",
        description: error?.message ?? "Unable to copy recipients.",
        variant: "destructive",
      });
    } finally {
      setIsCopyingRecipients(false);
    }
  }, [recipientsList, toast]);

  const handleCopyMessage = useCallback(async () => {
    if (!messageBody) return;
    try {
      setIsCopyingMessage(true);
      await navigator.clipboard.writeText(messageBody);
      toast({ title: "Message copied" });
    } catch (error: any) {
      toast({
        title: "Clipboard error",
        description: error?.message ?? "Unable to copy message.",
        variant: "destructive",
      });
    } finally {
      setIsCopyingMessage(false);
    }
  }, [messageBody, toast]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[240px,1fr]">
      <Card className="self-start">
        <CardHeader>
          <CardTitle className="text-lg">Player tools</CardTitle>
          <p className="text-sm text-muted-foreground">Manage roster actions for this tournament.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full" onClick={() => setLocation(`/tournaments/${tournamentId}/players/new`)}>
            Add Player
          </Button>
          <Button variant="outline" className="w-full" disabled>
            Entry fees
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className="w-full" disabled>
              Export
            </Button>
            <Button variant="secondary" className="w-full" disabled>
              Import
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Chess-Results syncing will use these controls once backend automation is enabled.
          </p>
        </CardContent>
      </Card>

      <Tabs value={activeSection} onValueChange={setActiveSection} className="lg:col-span-1">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          {sections.map(section => (
            <TabsTrigger key={section.id} value={section.id}>
              {section.name}
            </TabsTrigger>
          ))}
        </TabsList>
        <Card className="mt-4">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-xl">Players</CardTitle>
              <p className="text-sm text-muted-foreground">Overview of everyone registered for this event.</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Total: {players.length}</Badge>
              <Badge variant={hasSelection ? "default" : "outline"}>{selectionSummary}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading players…</p>
            ) : players.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-muted-foreground">No players registered yet.</p>
              </div>
            ) : (
              <TooltipProvider>
                <div className="flex flex-col gap-6 lg:flex-row">
                  <div className="flex-1 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>
                            <Button variant="ghost" onClick={() => handleSort('name')}>
                              Surname, Name
                              {sortKey === 'name' && <ArrowUpDown className="ml-2 h-4 w-4 inline" />}
                            </Button>
                          </TableHead>
                          <TableHead>
                            <Button variant="ghost" onClick={() => handleSort('rating')}>
                              {tournamentConfig.details.primaryRatingSystem === 'fide' ? 'FIDE' : 'USCF'} Rating
                              {sortKey === 'rating' && <ArrowUpDown className="ml-2 h-4 w-4 inline" />}
                            </Button>
                          </TableHead>
                          {tournament.format === 'knockout' && (
                            <TableHead className="w-20">Seed</TableHead>
                          )}
                          <TableHead>Byes</TableHead>
                          <TableHead className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <span>Birthdate</span>
                              <Checkbox
                                checked={headerCheckboxValue}
                                onCheckedChange={(value) => toggleSelectAll(Boolean(value))}
                                aria-label="Select all players"
                                disabled={players.length === 0}
                              />
                            </div>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {processedPlayers.map((player, index) => {
                          const isSelected = selectedIds.includes(player.id);
                          const isConfirmed = Boolean(confirmedMap[player.id]);
                          const playerByes = playerByeMap.get(player.id) ?? [];
                          const rowClasses = isSelected
                            ? "border-b border-slate-200 cursor-pointer transition bg-indigo-50/40 hover:bg-indigo-100/40 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/30"
                            : "border-b border-slate-200 cursor-pointer transition hover:bg-slate-50 dark:bg-slate-800/60 dark:hover:bg-slate-700/60";
                          return (
                            <TableRow
                              key={player.id}
                              className={rowClasses}
                              onClick={() => setLocation(`/tournaments/${tournamentId}/players/${player.id}`)}
                            >
                              <TableCell>
                                <div className="text-sm font-medium text-gray-900">{index + 1}</div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div className="flex flex-col">
                                    <span className="text-sm font-medium text-slate-900">
                                      {player.lastName}, {player.firstName}
                                    </span>
                                  </div>
                                  <span className="text-xs text-muted-foreground">
                                    ({new Date(player.createdAt).getMonth() + 1}/{new Date(player.createdAt).getDate()})
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                {tournamentConfig.details.primaryRatingSystem === 'fide' 
                                  ? (player.fideRating ?? player.rating ?? "-")
                                  : (player.uscfRating ?? player.rating ?? "-")}
                              </TableCell>
                              {tournament.format === 'knockout' && (
                                <TableCell>
                                  {editingSeedId === player.id ? (
                                    <Input
                                      type="number"
                                      className="h-8 w-16"
                                      value={seedValue}
                                      onChange={(e) => setSeedValue(e.target.value)}
                                      onBlur={() => handleUpdateSeed(player.id, seedValue)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleUpdateSeed(player.id, seedValue);
                                        if (e.key === 'Escape') setEditingSeedId(null);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      autoFocus
                                    />
                                  ) : (
                                    <div 
                                      className="cursor-pointer hover:bg-slate-100 p-1 rounded min-w-[2rem] text-center"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingSeedId(player.id);
                                        setSeedValue(player.seed?.toString() || "");
                                      }}
                                    >
                                      {player.seed ?? "-"}
                                    </div>
                                  )}
                                </TableCell>
                              )}
                              <TableCell>
                                {pairingsLoading ? (
                                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                                ) : playerByes.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {playerByes.map((bye) => {
                                      const isRequested = Boolean(bye.isRequested);
                                      const isRemoving = removingByeIds.includes(bye.id);
                                      const byeLabel = bye.byeType === "half_point"
                                        ? "½ point"
                                        : bye.byeType === "full_point"
                                        ? "1 point"
                                        : bye.byeType === "zero_point"
                                        ? "0 point"
                                        : bye.points === 1
                                        ? "½ point"
                                        : bye.points === 2
                                        ? "1 point"
                                        : "0 point";
                                      const toneClass = isRequested
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                        : "border-slate-200 bg-slate-100 text-slate-600";
                                      return (
                                        <div
                                          key={bye.id}
                                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium ${toneClass}`}
                                          title={isRequested ? "Manual bye" : "System-assigned"}
                                        >
                                          <span>{`Rd ${bye.round}`}</span>
                                          <span aria-hidden="true">·</span>
                                          <span>{byeLabel}</span>
                                          {isRequested ? (
                                            <button
                                              type="button"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                handleRemoveBye(bye.id);
                                              }}
                                              className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-emerald-700 transition hover:bg-emerald-100 hover:text-emerald-900"
                                              disabled={isRemoving}
                                              aria-label={`Remove bye in round ${bye.round}`}
                                            >
                                              {isRemoving ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                              ) : (
                                                <X className="h-3 w-3" />
                                              )}
                                            </button>
                                          ) : null}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <span className="text-sm text-muted-foreground">—</span>
                                  {isConfirmed ? (
                                    <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-label="Confirmed" />
                                  ) : null}
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={(value) => toggleSelectPlayer(player.id, Boolean(value))}
                                    onClick={(event) => event.stopPropagation()}
                                    aria-label={`Select ${player.lastName}, ${player.firstName}`}
                                    disabled={isDeleting || isProcessingStatus}
                                  />
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="flex items-center justify-end gap-2 lg:flex-col lg:items-stretch lg:justify-start">
            <AlertDialog>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 rounded-lg border border-slate-200"
                      disabled={!hasSelection || isDeleting || isProcessingStatus}
                      aria-label="Delete selected players"
                    >
                      {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </AlertDialogTrigger>
                </TooltipTrigger>
                <TooltipContent>Delete selected</TooltipContent>
              </Tooltip>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove players from this tournament?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action can&apos;t be undone. The selected player(s) and any matches involving them will be deleted permanently.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(event) => {
                      event.preventDefault();
                      void handleDeleteSelected();
                    }}
                  >
                    Confirm removal
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 rounded-lg border border-slate-200"
                          onClick={handleToggleConfirm}
                          disabled={!hasSelection || isDeleting || isProcessingStatus}
                          aria-label={allConfirmed ? "Unconfirm selected players" : "Confirm selected players"}
                        >
                          {allConfirmed ? <Check className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{allConfirmed ? "Unconfirm" : "Confirm"}</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 rounded-lg border border-slate-200"
                          onClick={() => setStatusDialogOpen(true)}
                          disabled={!hasSelection || isProcessingStatus || isDeleting}
                          aria-label="Set byes or withdraw"
                        >
                          <PauseCircle className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Set byes / withdraw</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 rounded-lg border border-slate-200"
                          onClick={() => setMessageDialogOpen(true)}
                          disabled={!hasSelection}
                          aria-label="Compose message"
                        >
                          <Mail className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Message selected</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </TooltipProvider>
            )}
          </CardContent>
        </Card>
      </Tabs>


    {/* Detail panel removed; players now open dedicated page */}

      <Dialog
        open={isStatusDialogOpen}
        onOpenChange={(open) => {
          setStatusDialogOpen(open);
          if (!open) {
            resetStatusForm();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage player availability</DialogTitle>
            <DialogDescription>
              Withdraw selected players from upcoming rounds or assign custom byes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="status-scope">Action</Label>
              <Select
                value={withdrawScope}
                onValueChange={(value) => setWithdrawScope(value as typeof withdrawScope)}
              >
                <SelectTrigger id="status-scope" className="w-full">
                  <SelectValue placeholder="Choose action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Withdraw from all future rounds</SelectItem>
                  <SelectItem value="specific">Assign custom byes for specific rounds</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {withdrawScope === "specific" ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Rounds</Label>
                  {roundOptions.length ? (
                    <div className="flex flex-wrap gap-2">
                      {roundOptions.map((round) => {
                        const active = selectedRounds.includes(round);
                        return (
                          <Button
                            key={round}
                            type="button"
                            variant={active ? "default" : "outline"}
                            size="sm"
                            onClick={() => handleRoundToggle(round)}
                          >
                            Rd {round}
                          </Button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No rounds scheduled yet. Update the tournament to enable bye assignments.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bye-type">Bye result</Label>
                  <Select
                    value={byeType}
                    onValueChange={(value) => setByeType(value as typeof byeType)}
                  >
                    <SelectTrigger id="bye-type" className="w-full">
                      <SelectValue placeholder="Select bye result" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="zero_point">Zero-point bye</SelectItem>
                      <SelectItem value="half_point">Half-point bye</SelectItem>
                      <SelectItem value="full_point">Full-point bye</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Confirming will issue zero-point byes for every remaining round and mark players as withdrawn.
              </p>
            )}
          </div>
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStatusDialogOpen(false);
                resetStatusForm();
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleStatusSubmit}
              disabled={
                isProcessingStatus ||
                !hasSelection ||
                (withdrawScope === "specific" && (selectedRounds.length === 0 || roundOptions.length === 0))
              }
            >
              {isProcessingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isMessageDialogOpen} onOpenChange={setMessageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Message selected players</DialogTitle>
            <DialogDescription>
              Choose delivery channels, draft your note, then copy it into the tools you use.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Recipients</Label>
              <div className="min-h-[48px] rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                {recipientsList || "Select at least one player to populate recipients."}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyRecipients}
                disabled={!recipientsList || isCopyingRecipients}
              >
                {isCopyingRecipients ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                Copy recipients
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="message-body">Message</Label>
              <Textarea
                id="message-body"
                rows={6}
                value={messageBody}
                onChange={(event) => setMessageBody(event.target.value)}
                placeholder="Draft your message here…"
              />
            </div>
            <div className="space-y-2">
              <Label>Send via</Label>
              <div className="flex flex-col gap-2 pt-1">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <Checkbox
                    checked={messageChannels.email}
                    onCheckedChange={(checked) =>
                      setMessageChannels((prev) => ({ ...prev, email: checked === true }))
                    }
                  />
                  <span>Email</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <Checkbox
                    checked={messageChannels.sms}
                    onCheckedChange={(checked) =>
                      setMessageChannels((prev) => ({ ...prev, sms: checked === true }))
                    }
                  />
                  <span>SMS</span>
                </label>
                {!hasChannelSelected && (
                  <p className="text-xs text-destructive">Select at least one channel to continue.</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={handleCopyMessage}
              disabled={!messageBody || isCopyingMessage}
            >
              {isCopyingMessage ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              Copy message
            </Button>
            <div className="flex w-full justify-end gap-2 sm:w-auto">
              <Button type="button" variant="ghost" onClick={() => setMessageDialogOpen(false)}>
                Close
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setMessageDialogOpen(false);
                  const destinations = [
                    messageChannels.email ? "email" : null,
                    messageChannels.sms ? "SMS" : null,
                  ].filter(Boolean);
                  toast({
                    title: "Message draft ready",
                    description:
                      destinations.length > 0
                        ? `Share this update via ${destinations.join(" & ")}.`
                        : "Paste the copied content into your communication tool to send.",
                  });
                }}
                disabled={(!messageBody && !recipientsList) || !hasChannelSelected}
              >
                Done
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
