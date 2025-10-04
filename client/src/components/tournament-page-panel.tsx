import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, Heading1, Heading2, Bold, Italic, List, ListOrdered, Link2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  buildTournamentPayload,
  parseTournamentConfig,
  serializeTournamentConfig,
  type TournamentConfig,
} from "@/lib/tournament-config";
import type { Tournament } from "@shared/schema";

type ToolbarAction = "h1" | "h2" | "bold" | "italic" | "bullet" | "numbered" | "link";

interface TournamentPagePanelProps {
  tournament: Tournament;
  onUpdated?: () => void;
}

export default function TournamentPagePanel({ tournament, onUpdated }: TournamentPagePanelProps) {
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [config, setConfig] = useState<TournamentConfig>(() => parseTournamentConfig(tournament));
  const [initialContent, setInitialContent] = useState<string>(
    parseTournamentConfig(tournament).tournamentPageContent ?? ""
  );

  useEffect(() => {
    const nextConfig = parseTournamentConfig(tournament);
    setConfig(nextConfig);
    setInitialContent(nextConfig.tournamentPageContent ?? "");
  }, [tournament]);

  const pageToolbar = useMemo(
    () => [
      { action: "h1" as ToolbarAction, icon: <Heading1 className="h-4 w-4" />, label: "Heading 1" },
      { action: "h2" as ToolbarAction, icon: <Heading2 className="h-4 w-4" />, label: "Heading 2" },
      { action: "bold" as ToolbarAction, icon: <Bold className="h-4 w-4" />, label: "Bold" },
      { action: "italic" as ToolbarAction, icon: <Italic className="h-4 w-4" />, label: "Italic" },
      { action: "bullet" as ToolbarAction, icon: <List className="h-4 w-4" />, label: "Bullet list" },
      { action: "numbered" as ToolbarAction, icon: <ListOrdered className="h-4 w-4" />, label: "Numbered list" },
      { action: "link" as ToolbarAction, icon: <Link2 className="h-4 w-4" />, label: "Insert link" },
    ],
    []
  );

  const handleContentChange = (value: string) => {
    setConfig((prev) => ({ ...prev, tournamentPageContent: value }));
  };

  const wrapSelection = (
    before: string,
    after = "",
    options: { placeholder?: string; selectPlaceholder?: boolean; newlineBefore?: boolean } = {}
  ) => {
    const textarea = textareaRef.current;
    const currentValue = config.tournamentPageContent ?? "";
    const start = textarea ? textarea.selectionStart : currentValue.length;
    const end = textarea ? textarea.selectionEnd : start;
    const needsNewline = options.newlineBefore && start > 0 && !currentValue.slice(0, start).endsWith("\n");
    const selected = currentValue.slice(start, end);
    const placeholder = selected.length > 0 ? selected : options.placeholder ?? "";
    const insertBefore = `${needsNewline ? "\n" : ""}${before}`;

    const nextValue =
      currentValue.slice(0, start) +
      insertBefore +
      placeholder +
      after +
      currentValue.slice(end);

    handleContentChange(nextValue);

    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const base = start + insertBefore.length;
      if (options.selectPlaceholder && placeholder.length > 0) {
        el.setSelectionRange(base, base + placeholder.length);
      } else {
        const position = base + placeholder.length + after.length;
        el.setSelectionRange(position, position);
      }
    });
  };

  const handleToolbarAction = (action: ToolbarAction) => {
    switch (action) {
      case "h1":
        wrapSelection("# ", "", { newlineBefore: true });
        break;
      case "h2":
        wrapSelection("## ", "", { newlineBefore: true });
        break;
      case "bold":
        wrapSelection("**", "**", { placeholder: "Bold text", selectPlaceholder: true });
        break;
      case "italic":
        wrapSelection("*", "*", { placeholder: "Italic text", selectPlaceholder: true });
        break;
      case "bullet":
        wrapSelection("- ", "", { newlineBefore: true });
        break;
      case "numbered":
        wrapSelection("1. ", "", { newlineBefore: true });
        break;
      case "link":
        wrapSelection("[", "](https://)", { placeholder: "Link text", selectPlaceholder: true });
        break;
      default:
        break;
    }
  };

  const geminiDraft = useMutation({
    mutationFn: async () =>
      apiRequest("/api/tools/gemini-draft", {
        method: "POST",
        body: JSON.stringify({ config }),
      }),
    onSuccess: (data: any) => {
      const generated = (data?.content ?? "").toString().trim();
      if (generated) {
        handleContentChange(generated);
        toast({ title: "Draft ready", description: "Review and save the generated copy." });
      } else {
        toast({
          title: "No content returned",
          description: "Gemini did not return any text. Try again soon.",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Draft failed",
        description: error?.message ?? "Unable to generate content.",
        variant: "destructive",
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildTournamentPayload(config, { format: tournament.format });
      payload.roundTimings = serializeTournamentConfig({ ...config, format: tournament.format });
      (payload as any).status = tournament.status;
      return apiRequest(`/api/tournaments/${tournament.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (updatedTournament: Tournament) => {
      const nextConfig = parseTournamentConfig(updatedTournament);
      setConfig(nextConfig);
      setInitialContent(nextConfig.tournamentPageContent ?? "");
      toast({ title: "Tournament page updated" });
      onUpdated?.();
    },
    onError: (error: any) => {
      toast({
        title: "Save failed",
        description: error?.message ?? "Unable to update tournament page.",
        variant: "destructive",
      });
    },
  });

  const hasChanges = (config.tournamentPageContent ?? "") !== initialContent;

  const resetContent = () => {
    setConfig((prev) => ({ ...prev, tournamentPageContent: initialContent }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Public Tournament Page</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Label className="text-sm font-medium">Tournament Page Content</Label>
            <p className="text-sm text-muted-foreground">
              Share parking info, highlights, livestream links, and other player guidance.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => geminiDraft.mutate()}
            disabled={geminiDraft.isPending}
            className="flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {geminiDraft.isPending ? "Drafting..." : "Draft with Gemini"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-md border bg-slate-50 p-2">
          {pageToolbar.map((item) => (
            <Button
              key={item.action}
              variant="ghost"
              size="sm"
              title={item.label}
              onClick={() => handleToolbarAction(item.action)}
            >
              {item.icon}
            </Button>
          ))}
        </div>

        <Textarea
          ref={textareaRef}
          rows={14}
          value={config.tournamentPageContent ?? ""}
          onChange={(event) => handleContentChange(event.target.value)}
          className="min-h-[320px]"
          placeholder="Welcome to our event!"
        />
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          className="flex items-center gap-2"
          onClick={resetContent}
          disabled={!hasChanges || saveMutation.isPending}
        >
          <RotateCcw className="h-4 w-4" />
          Reset to saved
        </Button>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!hasChanges || saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving..." : "Save changes"}
        </Button>
      </CardFooter>
    </Card>
  );
}
