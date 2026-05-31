import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  Download,
  Loader2,
  Globe,
  Flag,
  Check,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  parseTournamentConfig,
  buildTournamentPayload,
  type TournamentConfig,
  type FideRegistrationData,
  type UscfReportData,
} from "@/lib/tournament-config";
import { FideRegistrationSection, UscfReportSection } from "@/components/tournament-settings/sections";
import { cn } from "@/lib/utils";
import type { Tournament } from "@shared/schema";

interface TournamentReportsPageProps {
  tournamentId: number;
  type: "fide" | "uscf";
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
  if (utf8Match?.[1]) {
    try { return decodeURIComponent(utf8Match[1]); } catch { /* ignore */ }
  }
  const quotedMatch = /filename="?([^";]+)"?/i.exec(disposition);
  return quotedMatch?.[1] ?? null;
}

// ---------- FIDE validation ----------
interface ValidationItem {
  label: string;
  ok: boolean;
  required: boolean;
}

function getFideValidation(config: TournamentConfig, tournament: Tournament): ValidationItem[] {
  const b = config.basic;
  const d = config.details;
  const f = config.fide;
  return [
    { label: "Tournament name", ok: !!(b?.name || tournament.name), required: true },
    { label: "City / location", ok: !!(b?.city || tournament.location), required: true },
    { label: "Federation", ok: !!b?.federation, required: true },
    { label: "Start date", ok: !!b?.startDate, required: true },
    { label: "End date", ok: !!b?.endDate, required: true },
    { label: "Chief Arbiter", ok: !!(d?.chiefArbiter || f?.chiefArbiter), required: true },
    { label: "Time control", ok: !!(f?.timeControl || (d?.timeControls && d.timeControls.length > 0)), required: true },
    { label: "Organizer", ok: !!f?.organizer, required: false },
    { label: "Prize fund", ok: !!f?.prizeFund, required: false },
    { label: "Expected players", ok: !!f?.expectedPlayers, required: false },
  ];
}

function getUscfValidation(config: TournamentConfig, tournament: Tournament): ValidationItem[] {
  const b = config.basic;
  const u = config.uscf;
  return [
    { label: "Tournament name", ok: !!(b?.name || tournament.name), required: true },
    { label: "State", ok: !!u?.state, required: true },
    { label: "Affiliate ID", ok: !!u?.affiliateId, required: true },
    { label: "Chief TD USCF ID / Name", ok: !!u?.tournamentDirector, required: true },
    { label: "Time control", ok: !!u?.timeControl, required: true },
    { label: "Start date", ok: !!b?.startDate, required: true },
    { label: "End date", ok: !!b?.endDate, required: true },
    { label: "Organizer", ok: !!u?.organizer, required: false },
    { label: "Assistant TD", ok: !!u?.assistantDirector, required: false },
    { label: "Grand Prix points", ok: !!u?.grandPrixPoints, required: false },
  ];
}

export default function TournamentReportsPage({ tournamentId, type }: TournamentReportsPageProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const [draftConfig, setDraftConfig] = useState<TournamentConfig | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const baseConfig = useMemo(() => {
    if (!tournament?.roundTimings) return null;
    try {
      return parseTournamentConfig(tournament.roundTimings as any);
    } catch {
      return null;
    }
  }, [tournament?.roundTimings]);

  useEffect(() => {
    if (baseConfig && !draftConfig) {
      // Auto-populate FIDE fields from tournament config if not explicitly set
      const autoFide: Partial<FideRegistrationData> = {};
      if (!baseConfig.fide?.chiefArbiter && baseConfig.details?.chiefArbiter) {
        autoFide.chiefArbiter = baseConfig.details.chiefArbiter;
      }
      if (!baseConfig.fide?.timeControl && baseConfig.details?.timeControls?.length) {
        const tc = baseConfig.details.timeControls[0];
        if (tc) {
          autoFide.timeControl = tc.addonValue
            ? `${tc.minutes} min + ${tc.addonValue}s increment`
            : `${tc.minutes} min`;
        }
      }

      // Auto-populate USCF fields from tournament config if not explicitly set
      const autoUscf: Partial<UscfReportData> = {};
      if (!baseConfig.uscf?.tournamentDirector && baseConfig.details?.chiefArbiter) {
        autoUscf.tournamentDirector = baseConfig.details.chiefArbiter;
      }
      if (!baseConfig.uscf?.timeControl && baseConfig.details?.timeControls?.length) {
        const tc = baseConfig.details.timeControls[0];
        if (tc) {
          autoUscf.timeControl = tc.addonValue
            ? `G/${tc.minutes};inc${tc.addonValue}`
            : `G/${tc.minutes}`;
        }
      }

      const merged: TournamentConfig = {
        ...baseConfig,
        fide: { ...baseConfig.fide, ...autoFide },
        uscf: { ...baseConfig.uscf, ...autoUscf },
      };
      setDraftConfig(merged);
    }
  }, [baseConfig, draftConfig]);


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
    },
  });

  // Autosave debounce
  useEffect(() => {
    if (!isDirty || !draftConfig) return;
    const timer = setTimeout(() => { saveMutation.mutate(draftConfig); }, 1500);
    return () => clearTimeout(timer);
  }, [isDirty, draftConfig]);

  const updateConfig = (updates: Partial<TournamentConfig>) => {
    if (!draftConfig) return;
    setDraftConfig({ ...draftConfig, ...updates });
    setIsDirty(true);
  };

  // ---------- Download handlers ----------

  const handleDownloadFideTrf = useCallback(async () => {
    try {
      const response = await apiRequest(`/api/tournaments/${tournamentId}/exports/fide-trf`);
      if (!(response instanceof Response)) throw new Error("Unexpected response payload");
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
        toast({ title: "FIDE TRF16 downloaded", description: `Saved as ${filename}` });
      }
    } catch (error) {
      toast({ title: "TRF export failed", description: error instanceof Error ? error.message : "Unable to download TRF export.", variant: "destructive" });
    }
  }, [toast, tournamentId]);

  const handleDownloadFideRegistration = useCallback(() => {
    if (!draftConfig || !tournament) return;
    downloadJson(`tournament-${tournamentId}-fide-registration.json`, {
      tournamentId,
      tournamentName: tournament.name,
      form: "FIDERegistration",
      data: draftConfig.fide,
    });
    toast({ title: "FIDE registration data downloaded" });
  }, [draftConfig, tournament, tournamentId, toast]);

  const handleDownloadFideFa1 = useCallback(() => {
    if (!draftConfig || !tournament) return;
    downloadJson(`tournament-${tournamentId}-fa1.json`, {
      tournamentId,
      tournamentName: tournament.name,
      form: "FA1",
      data: draftConfig.fide,
    });
    toast({ title: "FA1 form data downloaded" });
  }, [draftConfig, tournament, tournamentId, toast]);

  const handleDownloadFideIa1 = useCallback(() => {
    if (!draftConfig || !tournament) return;
    downloadJson(`tournament-${tournamentId}-ia1.json`, {
      tournamentId,
      tournamentName: tournament.name,
      form: "IA1",
      data: draftConfig.fide,
    });
    toast({ title: "IA1 form data downloaded" });
  }, [draftConfig, tournament, tournamentId, toast]);

  const handleDownloadUscfZip = useCallback(async () => {
    try {
      const response = await apiRequest(`/api/tournaments/${tournamentId}/exports/uscf-dbf`);
      if (!(response instanceof Response)) throw new Error("Unexpected response payload");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `tournament-${tournamentId}-uscf-export.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast({ title: "USCF DBF ZIP downloaded", description: "Contains THEXPORT.DBF, TSEXPORT.DBF, TDEXPORT.DBF" });
    } catch (error) {
      toast({ title: "USCF export failed", description: error instanceof Error ? error.message : "Unable to download USCF DBF export.", variant: "destructive" });
    }
  }, [toast, tournamentId]);

  const handleDownloadUscfSummary = useCallback(() => {
    if (!draftConfig || !tournament) return;
    downloadJson(`tournament-${tournamentId}-uscf-report.json`, {
      tournamentId,
      tournamentName: tournament.name,
      form: "USCF",
      data: draftConfig.uscf,
    });
    toast({ title: "USCF summary downloaded" });
  }, [draftConfig, tournament, tournamentId, toast]);

  // ---------- Validation ----------
  const validation = useMemo(() => {
    if (!draftConfig || !tournament) return [];
    return type === "fide"
      ? getFideValidation(draftConfig, tournament)
      : getUscfValidation(draftConfig, tournament);
  }, [draftConfig, tournament, type]);

  const requiredOk = validation.filter(v => v.required && v.ok).length;
  const requiredTotal = validation.filter(v => v.required).length;
  const allRequired = requiredOk === requiredTotal;

  if (tournamentLoading || !tournament || !baseConfig) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading report data...
        </div>
      </div>
    );
  }

  const isFide = type === "fide";
  const accentColor = isFide ? "blue" : "red";

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <div className="mx-auto max-w-6xl space-y-8 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => setLocation(`/tournaments/${tournamentId}/manage`)}
            className="pl-0 text-slate-500 hover:text-slate-900"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to Management
          </Button>
        </div>

        {/* Title banner */}
        <div className={cn(
          "rounded-2xl border p-6 flex items-center gap-5",
          isFide ? "bg-blue-50/60 border-blue-100" : "bg-red-50/60 border-red-100"
        )}>
          <div className={cn(
            "w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm flex-shrink-0",
            isFide ? "bg-blue-100 text-blue-600" : "bg-red-100 text-red-600"
          )}>
            {isFide ? <Globe className="h-7 w-7" /> : <Flag className="h-7 w-7" />}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className={cn("text-2xl font-bold", isFide ? "text-blue-900" : "text-red-900")}>
              {isFide ? "FIDE Federation Report" : "USCF Rating Report"}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {tournament.name} &nbsp;•&nbsp; Tournament #{tournamentId}
            </p>
          </div>
          {/* Save status */}
          <div className="flex items-center gap-1.5 text-xs shrink-0">
            {saveMutation.isPending ? (
              <span className="flex items-center gap-1.5 text-blue-600 bg-blue-50 px-2.5 py-1.5 rounded-full font-medium">
                <Loader2 className="h-3 w-3 animate-spin" /> Saving…
              </span>
            ) : isDirty ? (
              <span className="text-amber-600 bg-amber-50 px-2.5 py-1.5 rounded-full font-medium">Unsaved changes</span>
            ) : lastSaved ? (
              <span className="flex items-center gap-1 text-emerald-600 font-medium">
                <Check className="h-3.5 w-3.5" /> Saved
              </span>
            ) : null}
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr,320px]">
          {/* Main form */}
          <div className="space-y-8">
            {!draftConfig ? (
              <div className="flex items-center justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : isFide ? (
              <FideRegistrationSection
                value={draftConfig.fide}
                onChange={(update) => updateConfig({ fide: { ...draftConfig.fide, ...update } })}
                tournamentName={tournament.name}
                tournamentCity={tournament.location ?? ""}
                onDownloadTrf={handleDownloadFideTrf}
                onDownloadRegistration={handleDownloadFideRegistration}
                onDownloadFa1={handleDownloadFideFa1}
                onDownloadIa1={handleDownloadFideIa1}
              />
            ) : (
              <UscfReportSection
                value={draftConfig.uscf}
                onChange={(update) => updateConfig({ uscf: { ...draftConfig.uscf, ...update } })}
                onDownload={handleDownloadUscfSummary}
                onDownloadZip={handleDownloadUscfZip}
              />
            )}
          </div>

          {/* Sidebar: Readiness & Downloads */}
          <div className="space-y-6">
            {/* Readiness card */}
            <Card className={cn(
              "border shadow-sm",
              allRequired ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/30"
            )}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-600 flex items-center gap-2">
                  {allRequired
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    : <AlertTriangle className="h-4 w-4 text-amber-500" />}
                  Report Readiness
                </CardTitle>
                <CardDescription>
                  {requiredOk}/{requiredTotal} required fields complete
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {validation.map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-xs">
                    <span className={cn("font-medium", item.ok ? "text-slate-700" : item.required ? "text-red-700" : "text-slate-500")}>
                      {item.label}
                      {item.required && !item.ok && (
                        <span className="ml-1 text-red-500 font-bold">*</span>
                      )}
                    </span>
                    {item.ok
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                      : <XCircle className={cn("h-3.5 w-3.5 flex-shrink-0", item.required ? "text-red-400" : "text-slate-300")} />
                    }
                  </div>
                ))}
                <Separator className="my-2" />
                <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
                  <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  {allRequired
                    ? "All required fields are complete. Your report is ready to export."
                    : "Fill in the required fields (marked with *) before exporting."}
                </p>
              </CardContent>
            </Card>

            {/* Quick downloads */}
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-600">
                  Downloads
                </CardTitle>
                <CardDescription>
                  {isFide
                    ? "Export files for FIDE submission"
                    : "Export files for USCF submission"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {isFide ? (
                  <>
                    <Button
                      className="w-full bg-slate-900 text-white hover:bg-slate-800 justify-start gap-2"
                      onClick={handleDownloadFideTrf}
                    >
                      <Download className="h-4 w-4" />
                      Download TRF16 (.trf)
                    </Button>
                    <p className="text-[11px] text-slate-400 px-1">
                      TRF16 is the standard FIDE Tournament Report Format for rating submission.
                    </p>
                    <Separator className="my-2" />
                    <Button
                      variant="outline"
                      className="w-full border-indigo-100 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 justify-start gap-2"
                      onClick={handleDownloadFideRegistration}
                    >
                      <Download className="h-4 w-4" />
                      Registration data (.json)
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2"
                      onClick={handleDownloadFideFa1}
                    >
                      <Download className="h-4 w-4" />
                      FA1 Norm Form (.json)
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2"
                      onClick={handleDownloadFideIa1}
                    >
                      <Download className="h-4 w-4" />
                      IA1 Norm Form (.json)
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      className="w-full bg-red-600 text-white hover:bg-red-700 justify-start gap-2"
                      onClick={handleDownloadUscfZip}
                      disabled={!allRequired}
                    >
                      <Download className="h-4 w-4" />
                      Generate USCF DBF ZIP
                    </Button>
                    <p className="text-[11px] text-slate-400 px-1">
                      Generates <code>THEXPORT.DBF</code>, <code>TSEXPORT.DBF</code>, and <code>TDEXPORT.DBF</code> bundled as a ZIP file for upload to the USCF MSA system.
                    </p>
                    {!allRequired && (
                      <p className="text-[11px] text-amber-600 px-1 flex items-start gap-1.5">
                        <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        Fill in required fields before downloading.
                      </p>
                    )}
                    <Separator className="my-2" />
                    <Button
                      variant="outline"
                      className="w-full border-indigo-100 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 justify-start gap-2"
                      onClick={handleDownloadUscfSummary}
                    >
                      <Download className="h-4 w-4" />
                      Download Summary (.json)
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Help card */}
            <Card className="shadow-sm border-slate-100 bg-slate-50/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-600">Submission Guide</CardTitle>
              </CardHeader>
              <CardContent className="text-[12px] text-slate-500 space-y-2 leading-relaxed">
                {isFide ? (
                  <>
                    <p>1. Complete all required fields (marked with *) in the Registration Form tab.</p>
                    <p>2. Download the <strong>TRF16</strong> file and submit it to your national federation or directly to FIDE Online Arena.</p>
                    <p>3. If a player achieved a norm, fill in the norm details and download the <strong>FA1</strong> or <strong>IA1</strong> form as well.</p>
                  </>
                ) : (
                  <>
                    <p>1. Complete all required fields including State, Affiliate ID, and Chief TD information.</p>
                    <p>2. Click <strong>Generate USCF DBF ZIP</strong> to create the three-file package.</p>
                    <p>3. Upload the ZIP file to the <a href="https://www.uschess.org/tdforms/tdforms.php" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">USCF TD Forms portal</a>.</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
