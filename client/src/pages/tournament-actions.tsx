import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, ChevronLeft, Mail, Share2, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  parseTournamentConfig,
  buildTournamentPayload,
  serializeTournamentConfig,
  type BoardNumberingSettings,
} from "@/lib/tournament-config";
import {
  TOURNAMENT_TEMPLATE_OPTIONS,
  applyTournamentTemplateSnapshot,
  buildTournamentTemplateSnapshot,
  isTournamentTemplateSnapshot,
  type TemplateSectionKey,
  type TournamentTemplateSnapshot,
} from "@/lib/tournament-templates";
import type { Tournament } from "@shared/schema";
import { BoardNumberingCard } from "@/components/tournament-settings/BoardNumberingCard";


interface TournamentActionsPageProps {
  tournamentId: number;
}

export default function TournamentActionsPage({ tournamentId }: TournamentActionsPageProps) {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const [shareEmails, setShareEmails] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [templateSelections, setTemplateSelections] = useState<TemplateSectionKey[]>(() =>
    TOURNAMENT_TEMPLATE_OPTIONS.map((option) => option.id),
  );
  const [templateSaving, setTemplateSaving] = useState(false);
  const templateImportInputRef = useRef<HTMLInputElement | null>(null);
  const [boardNumbering, setBoardNumbering] = useState<BoardNumberingSettings>({});

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const parsedConfig = useMemo(() => (tournament ? parseTournamentConfig(tournament) : null), [tournament]);

  useEffect(() => {
    if (parsedConfig) {
      setBoardNumbering(parsedConfig.boardNumbering);
    }
  }, [parsedConfig]);

  const updateBoardNumbering = (update: Partial<BoardNumberingSettings>) => {
    setBoardNumbering((prev) => ({ ...prev, ...update }));
  };
  
  const canManageTournament = useMemo(() => {
    if (!user || !tournament) return false;
    return user.role === "tournament_director" && user.id === tournament.createdBy;
  }, [user, tournament]);

  useEffect(() => {
    if (authLoading || tournamentLoading) return;
    if (!user) {
      setLocation("/");
      return;
    }
    if (!canManageTournament && tournament) {
      setLocation(`/tournaments/${tournamentId}`);
    }
  }, [authLoading, canManageTournament, tournament, tournamentId, tournamentLoading, user, setLocation]);

  useEffect(() => {
    setTemplateSelections(TOURNAMENT_TEMPLATE_OPTIONS.map((option) => option.id));
  }, [tournamentId]);

  if (authLoading || tournamentLoading || !tournament) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-slate-500">
          <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
          Loading tournament actions...
        </div>
      </div>
    );
  }

  if (!canManageTournament) {
    return null;
  }

  const updateTemplateSelection = (key: TemplateSectionKey, checked: boolean) => {
    setTemplateSelections((prev) => {
      if (checked) {
        if (prev.includes(key)) return prev;
        return [...prev, key];
      }
      return prev.filter((value) => value !== key);
    });
  };

  const handleTemplateSelectAll = () => {
    setTemplateSelections(TOURNAMENT_TEMPLATE_OPTIONS.map((option) => option.id));
  };

  const handleTemplateClear = () => {
    setTemplateSelections([]);
  };

  const handleTemplateExport = () => {
    if (!parsedConfig) {
      toast({ title: "Tournament not ready", variant: "destructive" });
      return;
    }
    if (templateSelections.length === 0) {
      toast({ title: "Select sections to export", variant: "destructive" });
      return;
    }

    const format = parsedConfig.format ?? tournament.format;
    const mode = parsedConfig.mode ?? "rated";
    const snapshot = buildTournamentTemplateSnapshot(parsedConfig, format, mode, templateSelections);
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const slug = tournament.name
      ? tournament.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
      : `tournament-${tournament.id}`;
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slug || "tournament"}-template.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast({ title: "Template exported", description: "Download complete." });
  };

  const handleTemplateImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!isTournamentTemplateSnapshot(parsed)) {
        throw new Error("File is not a valid tournament template.");
      }
      if (!parsedConfig) {
        throw new Error("Tournament configuration unavailable.");
      }

      const snapshot: TournamentTemplateSnapshot = {
        ...parsed,
        selected:
          parsed.selected && parsed.selected.length > 0
            ? (parsed.selected as TemplateSectionKey[])
            : TOURNAMENT_TEMPLATE_OPTIONS.map((option) => option.id),
      };

      const mergedConfig = applyTournamentTemplateSnapshot(parsedConfig, snapshot);
      const format = mergedConfig.format ?? tournament.format;
      const payload = buildTournamentPayload(mergedConfig, { format });
      payload.roundTimings = serializeTournamentConfig({ ...mergedConfig, format });
      (payload as any).status = tournament.status;

      setTemplateSaving(true);
      await apiRequest(`/api/tournaments/${tournamentId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setTemplateSelections(snapshot.selected);
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      toast({ title: "Template applied", description: "Tournament configuration updated." });
    } catch (error) {
      toast({
        title: "Template import failed",
        description: error instanceof Error ? error.message : "Unable to load template file.",
        variant: "destructive",
      });
    } finally {
      setTemplateSaving(false);
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete this tournament? This action cannot be undone.")) {
      return;
    }

    try {
      setDeleting(true);
      await apiRequest(`/api/tournaments/${tournamentId}`, {
        method: "DELETE",
      });
      toast({ title: "Tournament deleted" });
      setLocation("/dashboard");
    } catch (error: any) {
      toast({
        title: "Unable to delete tournament",
        description: error?.message ?? "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleShare = () => {
    const recipients = shareEmails
      .split(/[,;\s]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (recipients.length === 0) {
      toast({ title: "Add at least one email", variant: "destructive" });
      return;
    }

    const subject = encodeURIComponent(`Tournament Coordination: ${tournament.name}`);
    const link = typeof window !== "undefined" ? `${window.location.origin}/tournaments/${tournamentId}` : "";
    const message = shareMessage.trim().length > 0 ? `${shareMessage.trim()}

` : "";
    const body = encodeURIComponent(`${message}Event details: ${link}`);
    const to = encodeURIComponent(recipients.join(","));
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <Button
          variant="link"
          onClick={() => setLocation(`/tournaments/${tournamentId}/manage`)}
          className="pl-0 text-slate-500 hover:text-slate-900"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back to management
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Tournament actions</h1>
            <p className="text-sm text-muted-foreground">
              Manage advanced settings for {tournament.name}.
            </p>
          </div>
          <Badge variant="outline">ID #{tournament.id}</Badge>
        </div>

        <Card className="border-red-200 bg-red-50/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-700">
              <Trash2 className="h-5 w-5" /> Delete tournament
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-red-700">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              <p>
                This will remove the tournament, its players, pairings, and history. This action cannot be undone.
              </p>
            </div>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete tournament"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Templates
            </CardTitle>
            <CardDescription>
              Export selected configuration areas or apply a saved template to this tournament.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <Button type="button" variant="ghost" size="sm" onClick={handleTemplateSelectAll}>
                Select all
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={handleTemplateClear}>
                Clear
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {TOURNAMENT_TEMPLATE_OPTIONS.map((option) => {
                const checked = templateSelections.includes(option.id);
                return (
                  <label
                    key={option.id}
                    className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => updateTemplateSelection(option.id, value === true)}
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-900">{option.label}</p>
                      <p className="text-xs text-slate-500">{option.description}</p>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => templateImportInputRef.current?.click()} disabled={templateSaving}>
                {templateSaving ? "Applying template..." : "Import template"}
              </Button>
              <Button onClick={handleTemplateExport} disabled={templateSelections.length === 0}>
                Export template
              </Button>
              <input
                ref={templateImportInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={handleTemplateImport}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5" /> Share event with directors
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="share-emails">
                Email addresses
              </label>
              <Input
                id="share-emails"
                value={shareEmails}
                onChange={(event) => setShareEmails(event.target.value)}
                placeholder="director1@example.com, director2@example.com"
              />
              <p className="text-xs text-muted-foreground">Separate recipients with commas or spaces.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="share-message">
                Personal message (optional)
              </label>
              <Textarea
                id="share-message"
                rows={4}
                value={shareMessage}
                onChange={(event) => setShareMessage(event.target.value)}
                placeholder="Add context or instructions for fellow directors."
              />
            </div>

            <Button onClick={handleShare} className="flex items-center gap-2">
              <Mail className="h-4 w-4" /> Share via email
            </Button>
          </CardContent>
        </Card>
        
        <BoardNumberingCard value={boardNumbering} onChange={updateBoardNumbering} />
        <Button
          onClick={async () => {
            if (!parsedConfig) return;
            const newConfig = { ...parsedConfig, boardNumbering };
            const payload = buildTournamentPayload(newConfig, { format: tournament.format });
            await apiRequest(`/api/tournaments/${tournamentId}`, {
              method: "PUT",
              body: JSON.stringify(payload),
            });
            toast({ title: "Board numbering settings saved" });
          }}
        >
          Save Board Numbering
        </Button>

      </div>
    </div>
  );
}
