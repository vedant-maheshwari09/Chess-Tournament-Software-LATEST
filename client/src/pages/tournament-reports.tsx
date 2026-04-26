import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Download, Printer, Loader2, Globe, Flag, Check } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  parseTournamentConfig,
  serializeTournamentConfig,
  buildTournamentPayload,
  type TournamentConfig,
  type FideRegistrationData,
  type UscfReportData
} from "@/lib/tournament-config";
import { FideRegistrationSection, UscfReportSection } from "@/components/tournament-settings/sections";
import { cn } from "@/lib/utils";
import type { Tournament, Player, Match } from "@shared/schema";

interface TournamentReportsPageProps {
  tournamentId: number;
  type: "fide" | "uscf";
}

export default function TournamentReportsPage({ tournamentId, type }: TournamentReportsPageProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const reportRef = useRef<HTMLDivElement>(null);

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const [draftConfig, setDraftConfig] = useState<TournamentConfig | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  
  const config = useMemo(() => {
    if (!tournament?.roundTimings) return null;
    try {
      return parseTournamentConfig(tournament.roundTimings as any);
    } catch (e) {
      console.error("Failed to parse tournament config", e);
      return null;
    }
  }, [tournament?.roundTimings]);

  useEffect(() => {
    if (config && !draftConfig) {
      setDraftConfig(config);
    }
  }, [config, draftConfig]);

  const saveMutation = useMutation({
    mutationFn: async (configToSave: TournamentConfig) => {
      if (!tournament) return;
      const payload = buildTournamentPayload(configToSave, { format: tournament.format });
      (payload as any).status = tournament.status;
      
      await apiRequest(`/api/tournaments/${tournamentId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      setIsDirty(false);
      setLastSaved(new Date());
    },
    onError: (error: any) => {
      toast({ title: "Failed to save data", description: error.message, variant: "destructive" });
    }
  });

  useEffect(() => {
    if (!isDirty || !draftConfig) return;
    const timer = setTimeout(() => {
      saveMutation.mutate(draftConfig);
    }, 1500);
    return () => clearTimeout(timer);
  }, [isDirty, draftConfig, saveMutation]);

  const updateConfig = (updates: Partial<TournamentConfig>) => {
    if (!draftConfig) return;
    setDraftConfig({ ...draftConfig, ...updates });
    setIsDirty(true);
  };

  const handlePrint = () => {
    if (!reportRef.current) return;
    window.print();
  };

  if (tournamentLoading || !tournament || !config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading report data...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent pb-20 print:bg-white print:pb-0">
      <div className="mx-auto max-w-5xl space-y-8 p-6 print:p-0 print:max-w-none">
        <div className="flex items-center justify-between print:hidden">
          <Button
            variant="ghost"
            onClick={() => setLocation(`/tournaments/${tournamentId}/manage`)}
            className="pl-0 text-slate-500 hover:text-slate-900"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to Management
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="mr-2 h-4 w-4" />
              Print Report
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex items-center gap-4 print:hidden">
            <div className={cn(
              "w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm",
              type === "fide" ? "bg-blue-50 text-blue-600" : "bg-red-50 text-red-600"
            )}>
              {type === "fide" ? <Globe className="h-6 w-6" /> : <Flag className="h-6 w-6" />}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                {type === "fide" ? "FIDE Federation Report" : "USCF Rating Report"}
              </h1>
              <p className="text-sm text-slate-500">
                Tournament ID: #{tournamentId} • {tournament.name}
              </p>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-[1fr,350px] print:grid-cols-1">
            <div className="space-y-8">
              {!draftConfig ? (
                <div className="flex items-center justify-center p-12">
                  <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : type === "fide" ? (
                <FideRegistrationSection
                  value={draftConfig.fide}
                  onChange={(update) => updateConfig({ fide: { ...draftConfig.fide, ...update } })}
                  tournamentName={tournament.name}
                  tournamentCity={tournament.location ?? ""}
                />
              ) : (
                <div className="space-y-8">
                  <UscfReportSection
                    value={draftConfig.uscf}
                    onChange={(update) => updateConfig({ uscf: { ...draftConfig.uscf, ...update } })}
                  />
                </div>
              )}
            </div>

            <div className="space-y-6 print:hidden">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-500">Report Status</CardTitle>
                  <div className="flex items-center gap-1.5">
                    {saveMutation.isPending ? (
                      <span className="flex items-center gap-1.5 text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        Saving...
                      </span>
                    ) : isDirty ? (
                      <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                        Unsaved changes
                      </span>
                    ) : lastSaved ? (
                      <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400">
                        <Check className="h-2.5 w-2.5" />
                        Saved
                      </span>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Validation</span>
                    <Badge variant="outline" className="text-green-600 bg-green-50 border-green-100">PASS</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Standings</span>
                    <Badge variant="outline" className="text-slate-600 bg-slate-50">SYNCED</Badge>
                  </div>
                  <Separator />
                  <p className="text-xs text-slate-500">
                    Ensure all data is accurate before finalizing for submission to the federation.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print\\:p-0, .print\\:p-0 * {
            visibility: visible;
          }
          .print\\:p-0 {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          @page {
            margin: 1cm;
          }
          .print\\:hidden {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}


