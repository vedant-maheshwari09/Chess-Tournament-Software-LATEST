import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Tournament } from "@shared/schema";
import {
  type ChessResultsConfig,
  type FideRegistrationData,
  type RegistersConfig,
  type TournamentConfig,
  type UscfReportData,
  type BoardNumberingSettings,
  buildTournamentPayload,
  parseTournamentConfig,
  serializeTournamentConfig,
} from "@/lib/tournament-config";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChessResultsSettingsCard,
  FideRegistrationSection,
  UscfReportSection,
  ArenaSettingsCard,
} from "@/components/tournament-settings/sections";
import { GeneralSettingsCard } from "@/components/tournament-settings/GeneralSettingsCard";
import { BoardNumberingCard } from "@/components/tournament-settings/BoardNumberingCard";
import { 
  ChevronLeft, 
  Loader2, 
  Settings, 
  Hash, 
  BarChart3, 
  Globe, 
  Flag, 
  RotateCw, 
  Timer,
  Info,
  Calendar,
  CreditCard,
  Trophy,
  UserPlus
} from "lucide-react";


type SettingsSection = "basic" | "details" | "schedule" | "payments" | "prizes" | "player-signup" | "rate-tournament" | "general" | "board-numbering" | "fide" | "uscf" | "chess-results" | "arena";

interface TournamentSettingsPageProps {
  tournamentId: number;
  section?: string;
}

function cloneConfig(config: TournamentConfig): TournamentConfig {
  return JSON.parse(JSON.stringify(config)) as TournamentConfig;
}

function downloadJson(filename: string, data: unknown) {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify(data, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function extractFilenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8Match && utf8Match[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch (error) {
      console.warn("Failed to decode UTF-8 filename", error);
    }
  }
  const quotedMatch = /filename="?([^";]+)"?/i.exec(disposition);
  if (quotedMatch && quotedMatch[1]) {
    return quotedMatch[1];
  }
  return null;
}

export default function TournamentSettingsPage({ tournamentId, section }: TournamentSettingsPageProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const [config, setConfig] = useState<TournamentConfig | null>(null);
  const [baseline, setBaseline] = useState<TournamentConfig | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [chessResultsEnabled, setChessResultsEnabled] = useState(false);

  const allowedSections = [
    "general",
    "basic",
    "details",
    "schedule",
    "payments",
    "prizes",
    "player-signup",
    "rate-tournament",
    "fide",
    "uscf",
    "chess-results",
    "board-numbering",
    "arena",
  ] satisfies SettingsSection[];

  const currentSection: SettingsSection = useMemo(() => {
    const normalized = (section ?? "basic") as SettingsSection;
    return allowedSections.includes(normalized)
      ? normalized
      : "basic";
  }, [section]);

  useEffect(() => {
    if (!tournament) return;
    const parsed = parseTournamentConfig(tournament);
    const cloned = cloneConfig(parsed);
    setConfig(cloned);
    setBaseline(cloneConfig(parsed));
    setChessResultsEnabled(!!tournament.chessResultsUrl);
    setIsDirty(false);
  }, [tournament]);

  useEffect(() => {
    if (tournament && user && user.role === "tournament_director" && tournament.createdBy !== user.id) {
      setLocation(`/tournaments/${tournamentId}`);
    }
  }, [tournament, user, tournamentId, setLocation]);

  const markDirty = () => {
    setIsDirty(true);
  };



  const updateBoardNumbering = (update: Partial<BoardNumberingSettings>) => {
    if (!config) return;
    setConfig((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        boardNumbering: {
          ...prev.boardNumbering,
          ...update,
        },
      };
      return next;
    });
    markDirty();
  };

  const updateRegisters = (update: Partial<RegistersConfig>) => {
    if (!config) return;
    setConfig((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        registers: {
          ...prev.registers,
          ...update,
        },
      };
      return next;
    });
    markDirty();
  };

  const updateFide = (update: Partial<FideRegistrationData>) => {
    if (!config) return;
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        fide: {
          ...prev.fide,
          ...update,
        },
      };
    });
    markDirty();
  };

  const updateUscf = (update: Partial<UscfReportData>) => {
    if (!config) return;
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        uscf: {
          ...prev.uscf,
          ...update,
        },
      };
    });
    markDirty();
  };

  const updateChessResults = (update: Partial<ChessResultsConfig>) => {
    if (!config) return;
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        chessResults: {
          ...prev.chessResults,
          ...update,
        },
      };
    });
    markDirty();
  };

  const updateArena = (update: any) => {
    if (!config) return;
    setConfig((prev) => {
      if (!prev || !prev.arena) return prev;
      return {
        ...prev,
        arena: {
          ...prev.arena,
          ...update,
        },
      };
    });
    markDirty();
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!config || !tournament) throw new Error("Configuration not ready");
      const serialized = serializeTournamentConfig(cloneConfig(config));
      const payload = buildTournamentPayload(serialized, { format: tournament.format });
      (payload as any).status = tournament.status;
      return apiRequest(`/api/tournaments/${tournamentId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (updatedTournament: Tournament) => {
      const parsed = parseTournamentConfig(updatedTournament);
      const cloned = cloneConfig(parsed);
      setConfig(cloned);
      setBaseline(cloneConfig(parsed));
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      toast({ title: "Tournament settings saved" });
    },
    onError: (error: any) => {
      toast({
        title: "Unable to save settings",
        description: error?.message ?? "Please review the form and try again.",
        variant: "destructive",
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!config) throw new Error("Configuration not ready");
      await apiRequest(`/api/tournaments/${tournamentId}/chess-results/test`, {
        method: "POST",
        body: JSON.stringify({ config }),
      });
    },
    onSuccess: () => {
      toast({ title: "Chess-Results connection successful" });
    },
    onError: (error: any) => {
      toast({
        title: "Connection failed",
        description: error?.message ?? "Verify credentials and try again.",
        variant: "destructive",
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!config) throw new Error("Configuration not ready");
      const response = await apiRequest(`/api/tournaments/${tournamentId}/chess-results/sync`, {
        method: "POST",
        body: JSON.stringify({ config }),
      });
      return response;
    },
    onSuccess: (result) => {
      if (result?.config) {
        setConfig(cloneConfig(result.config));
      }
      toast({ title: "Chess-Results sync complete" });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      setIsDirty(true);
    },
    onError: (error: any) => {
      toast({
        title: "Sync failed",
        description: error?.message ?? "Check credentials and network access.",
        variant: "destructive",
      });
    },
  });



  useEffect(() => {
    if (!config) return;
    if (!allowedSections.includes(currentSection)) {
      setLocation(`/tournaments/${tournamentId}/settings/${allowedSections[0] ?? "registers"}`);
    }
  }, [allowedSections, config, currentSection, setLocation, tournamentId]);

  const unsavedChanges = isDirty || JSON.stringify(config) !== JSON.stringify(baseline);

  const handleDownloadFideRegistration = useCallback(() => {
    if (!config) return;
    downloadJson(`tournament-${tournamentId}-fide-registration.json`, {
      tournamentId,
      tournamentName: tournament?.name,
      form: "FIDERegistration",
      data: config.fide,
    });
  }, [config, tournament?.name, tournamentId]);

  const handleDownloadFideFa1 = useCallback(() => {
    if (!config) return;
    downloadJson(`tournament-${tournamentId}-fa1.json`, {
      tournamentId,
      tournamentName: tournament?.name,
      form: "FA1",
      data: config.fide,
    });
  }, [config, tournament?.name, tournamentId]);

  const handleDownloadFideIa1 = useCallback(() => {
    if (!config) return;
    downloadJson(`tournament-${tournamentId}-ia1.json`, {
      tournamentId,
      tournamentName: tournament?.name,
      form: "IA1",
      data: config.fide,
    });
  }, [config, tournament?.name, tournamentId]);

  const handleDownloadFideTrf = useCallback(async () => {
    try {
      const response = await apiRequest(`/api/tournaments/${tournamentId}/exports/fide-trf`);
      if (!(response instanceof Response)) {
        throw new Error("Unexpected response payload");
      }

      const blob = await response.blob();
      const suggestedName = extractFilenameFromDisposition(response.headers.get("content-disposition"));
      const filename = suggestedName ?? `tournament-${tournamentId}-fide-trf16.trf`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);

      const warnings = response.headers.get("x-export-warnings");
      if (warnings) {
        toast({ title: "TRF exported with warnings", description: warnings, variant: "destructive" });
      } else {
        toast({ title: "FIDE TRF16 downloaded" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to download TRF export.";
      toast({ title: "TRF export failed", description: message, variant: "destructive" });
    }
  }, [toast, tournamentId]);

  const handleDownloadUscf = useCallback(() => {
    if (!config) return;
    downloadJson(`tournament-${tournamentId}-uscf-report.json`, {
      tournamentId,
      tournamentName: tournament?.name,
      form: "USCF",
      data: config.uscf,
    });
  }, [config, tournament?.name, tournamentId]);

  const handleDownloadChessResults = useCallback(() => {
    if (!config) return;
    downloadJson(`tournament-${tournamentId}-chess-results.json`, {
      tournamentId,
      tournamentName: tournament?.name,
      form: "ChessResults",
      data: config.chessResults,
    });
  }, [config, tournament?.name, tournamentId]);

  if (authLoading || tournamentLoading || !config || !baseline) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading tournament settings...
        </div>
      </div>
    );
  }

  const sectionLabels: Record<SettingsSection, string> = {
    basic: "Basic Info",
    general: "General",
    details: "Details",
    schedule: "Schedule",
    payments: "Payments",
    prizes: "Prizes",
    "player-signup": "Player Signup",
    "rate-tournament": "Rating Hub",
    fide: "FIDE Settings",
    uscf: "USCF Settings",
    "chess-results": "Chess-Results",
    "board-numbering": "Boards",
    arena: "Arena Scoring",
  };

  const sectionIcons: Record<SettingsSection, any> = {
    basic: Info,
    general: Settings,
    details: Settings, // or another one
    schedule: Calendar,
    payments: CreditCard,
    prizes: Trophy,
    "player-signup": UserPlus,
    "rate-tournament": BarChart3,
    fide: Globe,
    uscf: Flag,
    "chess-results": RotateCw,
    "board-numbering": Hash,
    arena: Timer,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <Button
          variant="link"
          onClick={() => setLocation(`/tournaments/${tournamentId}/manage`)}
          className="pl-0 text-slate-500 hover:text-slate-900"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back to management
        </Button>

        <div className="flex flex-col gap-4 border-b pb-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {unsavedChanges && <Badge variant="destructive">Unsaved changes</Badge>}
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Tournament settings</h1>
              <p className="text-sm text-muted-foreground">
                Manage federation forms and Chess-Results synchronization for {tournament?.name}.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (!baseline) return;
                setConfig(cloneConfig(baseline));
                setIsDirty(false);
              }}
              disabled={!unsavedChanges}
            >
              Reset
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!unsavedChanges || saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-8 md:flex-row">
          {/* Sidebar Navigation */}
          <aside className="w-full shrink-0 md:w-64">
            <nav className="flex flex-wrap gap-1 md:flex-col">
              {(Object.entries(sectionLabels) as [SettingsSection, string][]).map(([key, label]) => {
                const isActive = currentSection === key;
                const Icon = sectionIcons[key];

                // Only show arena settings if it's relevant
                if (key === 'arena' && tournament?.format !== 'arena') return null;

                return (
                  <button
                    key={key}
                    onClick={() => setLocation(`/tournaments/${tournamentId}/settings/${key}`)}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-indigo-100 text-indigo-900"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    )}
                  >
                    {Icon && <Icon className={cn("h-4 w-4", isActive ? "text-indigo-900" : "text-slate-400")} />}
                    <span>{label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Settings Content */}
          <div className="flex-1 space-y-6 pb-12">
          {currentSection === "general" && (
            <div className="space-y-6">
              <GeneralSettingsCard value={config.registers} onChange={updateRegisters} />
            </div>
          )}

          {currentSection === "board-numbering" && (
            <div className="space-y-6">
              <BoardNumberingCard value={config.boardNumbering} onChange={updateBoardNumbering} />
            </div>
          )}

          {currentSection === "rate-tournament" && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Rate Tournament</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button>USCF Report</Button>
                  <Button>FIDE Report</Button>
                </CardContent>
              </Card>
            </div>
          )}

          {currentSection === "fide" && (
            <FideRegistrationSection
              value={config.fide}
              onChange={updateFide}
              onDownloadTrf={handleDownloadFideTrf}
              onDownloadRegistration={handleDownloadFideRegistration}
              onDownloadFa1={handleDownloadFideFa1}
              onDownloadIa1={handleDownloadFideIa1}
            />
          )}

          {currentSection === "uscf" && (
            <UscfReportSection value={config.uscf} onChange={updateUscf} onDownload={handleDownloadUscf} />
          )}

          {currentSection === "chess-results" && (
            <>
              <ChessResultsSettingsCard
                value={config.chessResults}
                onChange={updateChessResults}
                onTest={() => testMutation.mutate()}
                onSync={() => syncMutation.mutate()}
                testing={testMutation.isPending}
                syncing={syncMutation.isPending}
                disabled={config.chessResults.syncMode === "disabled"}
                onDownload={handleDownloadChessResults}
                enabled={chessResultsEnabled}
                onEnabledChange={setChessResultsEnabled}
              />
              {chessResultsEnabled && (
                <Button onClick={() => setLocation("/tournaments/" + tournamentId + "/settings/chess-results-connection")}>
                  Connect to Chess-Results
                </Button>
              )}
            </>
          )}

          {currentSection === "arena" && config.arena && (
            <ArenaSettingsCard value={config.arena} onChange={updateArena} />
          )}
        </div>
      </div>
    </div>
  </div>
  );
}
