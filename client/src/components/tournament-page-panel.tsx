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
import { renderTournamentPageContent } from "@/lib/tournament-page";
import type { Tournament } from "@shared/schema";

type ToolbarAction = "h1" | "h2" | "bold" | "italic" | "bullet" | "numbered" | "link";

interface TournamentPagePanelProps {
  tournament: Tournament;
  onUpdated?: () => void;
}

export default function TournamentPagePanel({ tournament, onUpdated }: TournamentPagePanelProps) {
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [config, setConfig] = useState<TournamentConfig>(() => parseTournamentConfig(tournament));
  const [initialContent, setInitialContent] = useState<string>(
    parseTournamentConfig(tournament).tournamentPageContent ?? ""
  );
  const previewHtml = useMemo(
    () => renderTournamentPageContent(config.tournamentPageContent ?? ""),
    [config.tournamentPageContent],
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

  const appendContentBlock = (snippet: string, { ensureSpacing = true }: { ensureSpacing?: boolean } = {}) => {
    setConfig((prev) => {
      const current = prev.tournamentPageContent ?? "";
      const prefix = ensureSpacing && current.trim().length > 0 ? "\n\n" : "";
      return { ...prev, tournamentPageContent: `${current}${prefix}${snippet}` };
    });
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
      const rawMessage = error?.message ?? "Unable to generate content.";
      let friendlyMessage = rawMessage;

      const [, jsonPortion] = rawMessage.split(/:(.+)/); // split on first colon
      if (jsonPortion) {
        try {
          const parsed = JSON.parse(jsonPortion.trim());
          if (parsed && typeof parsed === "object" && typeof parsed.message === "string") {
            friendlyMessage = parsed.message;
          }
        } catch (parseError) {
          const cleaned = jsonPortion.replace(/^["']|["']$/g, "").trim();
          if (cleaned.length > 0) {
            friendlyMessage = cleaned;
          }
        }
      }

      toast({
        title: "Draft failed",
        description: friendlyMessage.trim() || "Unable to generate content.",
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

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      let nextContent = text;
      if (/\.json$/i.test(file.name)) {
        try {
          const parsed = JSON.parse(text);
          if (typeof parsed === "string") {
            nextContent = parsed;
          } else if (parsed && typeof parsed === "object" && typeof parsed.tournamentPageContent === "string") {
            nextContent = parsed.tournamentPageContent;
          }
        } catch (parseError) {
          // fallback to raw text
        }
      }
      handleContentChange(nextContent);
      toast({ title: "Content imported", description: `Loaded ${file.name}` });
    } catch (error) {
      toast({ title: "Import failed", description: "Unable to read file", variant: "destructive" });
    } finally {
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const handleImageFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        toast({ title: "Upload failed", description: "Could not read image", variant: "destructive" });
        return;
      }
      const altText = file.name.replace(/\.[^/.]+$/, "").replace(/[\-_]+/g, " ").trim() || "Tournament image";
      appendContentBlock(`![${altText}](${dataUrl})\n`);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        const length = el.value.length;
        el.focus();
        el.setSelectionRange(length, length);
      });
      toast({ title: "Image added", description: `${file.name} embedded` });
    };
    reader.onerror = () => {
      toast({ title: "Upload failed", description: "Could not read image", variant: "destructive" });
    };
    reader.readAsDataURL(file);
    if (event.target) {
      event.target.value = "";
    }
  };

  const handleAddImageUrl = () => {
    const url = window.prompt("Enter the image URL");
    if (!url) {
      return;
    }
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      return;
    }
    const altText = (window.prompt("Describe this image", "Tournament flyer") ?? "Tournament image").trim();
    appendContentBlock(`![${altText || "Tournament image"}](${trimmedUrl})`);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const length = el.value.length;
      el.focus();
      el.setSelectionRange(length, length);
    });
    toast({ title: "Image added", description: "Image URL embedded" });
  };

  const handleInsertMapButtons = () => {
    const query = window.prompt("Enter the venue or address to link on maps");
    if (!query) {
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    appendContentBlock(`{{map-buttons:${trimmed}}}`);
    toast({ title: "Map buttons added", description: "Google and Apple Maps links inserted" });
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
          <div className="flex flex-wrap items-center gap-2">
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
            <Button
              size="sm"
              variant="outline"
              onClick={() => importInputRef.current?.click()}
              className="flex items-center gap-2"
            >
              Import content
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => imageInputRef.current?.click()}
              className="flex items-center gap-2"
            >
              Upload image
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddImageUrl}
              className="flex items-center gap-2"
            >
              Link image URL
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleInsertMapButtons}
              className="flex items-center gap-2"
            >
              Add map buttons
            </Button>
          </div>
        </div>

        <input
          type="file"
          ref={importInputRef}
          accept=".txt,.md,.markdown,.json,.html,.htm"
          className="hidden"
          onChange={handleImportFile}
        />
        <input
          type="file"
          ref={imageInputRef}
          accept="image/*"
          className="hidden"
          onChange={handleImageFile}
        />

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

        <div className="space-y-2">
          <Label className="text-sm font-medium">Live preview</Label>
          {config.tournamentPageContent?.trim() ? (
            <div
              className="prose prose-slate max-w-none rounded-md border bg-white p-4"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : (
            <div className="rounded-md border border-dashed bg-slate-50 p-6 text-sm text-slate-500">
              Start writing or import content to preview your tournament page.
            </div>
          )}
        </div>
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
