import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeCanvas } from "qrcode.react";
import { ChessResultsSettingsCard } from "@/components/tournament-settings/sections";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OfficialSearchInput } from "@/components/ui/official-search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import type { Tournament } from "@shared/schema";
import {
  TournamentConfig,
  TournamentMode,
  type EntryFeeRule,
  type PrizeRule,
  type SectionDefinition,
  type OfflinePaymentMethod,
  type ScoringRules,
  TimeControlDefinition,
  TimeAddonType,
  TimeControlType,
  buildTournamentPayload,
  createDefaultConfig,
  normalizeCityState,
  parseTournamentConfig,
  serializeTournamentConfig,
  createDefaultSchedule,
  ScheduleEvent,
  SCHEDULE_EVENT_OPTIONS,
} from "@/lib/tournament-config";
import {
  TOURNAMENT_TEMPLATE_OPTIONS,
  applyTournamentTemplateSnapshot,
  isTournamentTemplateSnapshot,
  type TemplateSectionKey,
  type TournamentTemplateSnapshot,
} from "@/lib/tournament-templates";
import { Upload, Check, ChevronRight, Settings, X, ChevronUp, ChevronDown, Plus, CreditCard, ExternalLink } from "lucide-react";
import qrcode from "qrcode";

type BuilderMode = "create" | "edit";
type SettingsShortcutTab = "rate-tournament" | "fide" | "uscf" | "chess-results";

interface TournamentBuilderProps {
  mode: BuilderMode;
  format: Tournament["format"];
  tournament?: Tournament;
  onCancel?: () => void;
  onComplete?: (tournament: Tournament) => void;
}

const FORMAT_CARDS: Array<{ 
  id: Tournament["format"];
  title: string;
  description: string;
  features: string[];
}> = [
  {
    id: "swiss",
    title: "Swiss System",
    description:
      "Players are paired by score each round. Best for medium to large events with limited rounds.",
    features: ["Flexible number of rounds", "Smart pairings", "No elimination"],
  },
  {
    id: "roundrobin",
    title: "Round Robin",
    description: "Every player faces each opponent. Ideal for invitational or elite groups.",
    features: ["Balanced schedule", "Single or double round", "Fair pairings"],
  },
  {
    id: "knockout",
    title: "Knockout",
    description: "Elimination brackets with finals. Perfect for playoffs and quick championships.",
    features: ["Brackets", "Automatic advancement", "Supports seeding"],
  },
  {
    id: "arena",
    title: "Arena",
    description: "Players are continuously paired in a time-based format. Ideal for quick, high-volume events.",
    features: ["Time-based pairings", "Continuous play", "High volume"],
  },
];

const MODE_OPTIONS: Array<{ id: TournamentMode; label: string; description: string }> = [
  {
    id: "online",
    label: "Online Event",
    description: "Optimized for virtual tournaments with quick registration links and remote play workflows.",
  },
  {
    id: "rated",
    label: "Standard Event",
    description: "Includes federation reporting, USCF/ FIDE forms, and official compliance steps.",
  },
];

const FEDERATION_OPTIONS = [
  { code: "United States", label: "United States" },
  { code: "Canada", label: "Canada" },
  { code: "United Kingdom", label: "United Kingdom" },
  { code: "Germany", label: "Germany" },
  { code: "France", label: "France" },
  { code: "Spain", label: "Spain" },
  { code: "India", label: "India" },
  { code: "China", label: "China" },
  { code: "Australia", label: "Australia" },
];

const TIME_CONTROL_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "rapid", label: "Rapid" },
  { value: "blitz", label: "Blitz" },
];

const TIEBREAK_OPTIONS = [
  { value: "rating", label: "Rating-based" },
  { value: "uscf", label: "USCF System" },
  { value: "buchholz", label: "Buchholz" },
  { value: "median", label: "Median" },
];

const RATING_TYPE_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "rapid", label: "Rapid" },
  { value: "blitz", label: "Blitz" },
];

const ENTRY_FEE_CURRENCY_OPTIONS = ["USD", "CAD", "EUR"] as const;
const OFFLINE_METHOD_OPTIONS: Array<{ id: OfflinePaymentMethod; label: string; hint?: string }> = [
  { id: "cash", label: "Cash" },
  { id: "check", label: "Check" },
  { id: "venmo", label: "Venmo" },
  { id: "zelle", label: "Zelle" },
  { id: "paypal", label: "PayPal" },
  { id: "other", label: "Other" },
];

function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result?.toString() ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
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

function cloneConfig(config: TournamentConfig): TournamentConfig {
  return JSON.parse(JSON.stringify(config)) as TournamentConfig;
}


const templateLabelToRound = (label: string): number | null => {
  const match = label.match(/^Round\s+(\d+)/i);
  if (!match) return null;
  const value = parseInt(match[1] ?? "", 10);
  return Number.isFinite(value) ? value : null;
};

// Exported for BasicInformationFields to use
export const ensureRoundSchedule = (schedule: ScheduleEvent[], rounds: number): ScheduleEvent[] => {
  const roundEvents: ScheduleEvent[] = [];
  const nonRoundEvents: ScheduleEvent[] = [];
  const seenRounds = new Set<number>();

  schedule.forEach((event) => {
    if (event.round && event.round >= 1 && event.round <= rounds) {
      if (!seenRounds.has(event.round)) {
        seenRounds.add(event.round);
        roundEvents.push({
          ...event,
          label: event.label || `Round ${event.round}`,
          round: event.round,
        });
      }
    } else if (event.round && event.round > rounds) {
      // Intentionally drop rounds that exceed the current round count.
      // This prevents "ghost" rounds (e.g. Round 7-9 when only 6 are selected)
      // from showing up as unlinked events.
    } else {
      nonRoundEvents.push(event);
    }
  });

  for (let round = 1; round <= rounds; round++) {
    if (!seenRounds.has(round)) {
      roundEvents.push({
        id: `${Date.now()}-${round}-${Math.random()}`,
        date: null,
        time: null,
        label: SCHEDULE_EVENT_OPTIONS[round - 1] ?? `Round ${round}`,
        round,
      });
    }
  }

  roundEvents.sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
  return [...roundEvents, ...nonRoundEvents];
};

interface BasicInformationFieldsProps {
  config: TournamentConfig;
  onConfigChange: (config: TournamentConfig) => void;
  variant?: "minimal" | "full";
}

function BasicInformationFields({ config, onConfigChange, variant = "full" }: BasicInformationFieldsProps) {
  const updateBasic = (updates: Partial<TournamentConfig["basic"]>) => {
    onConfigChange({
      ...config,
      basic: { ...config.basic, ...updates },
    });
  };
  const updateRegisters = (updates: Partial<TournamentConfig["registers"]>) => {
    onConfigChange({
      ...config,
      registers: { ...config.registers, ...updates },
    });
  };
  const handleCityStateChange = (raw: string) => {
    // Allows letters, numbers, spaces, commas, hyphens, and periods
    const sanitized = raw.replace(/[^0-9a-zA-Z\s.,-]+/g, "");
    updateBasic({ state: sanitized });
  };

  const openMaps = (provider: "google" | "apple") => {
    const query = config.basic.city.trim();
    if (!query) return;
    const url =
      provider === "google"
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` 
        : `https://maps.apple.com/?q=${encodeURIComponent(query)}`;
    window.open(url, "_blank");
  };

  const updateDetails = (updates: Partial<TournamentConfig["details"]>) => {
    onConfigChange({
      ...config,
      details: { ...config.details, ...updates },
    });
  };

  const handleRoundsChange = (val: number) => {
    const nextRounds = Number.isFinite(val) && val > 0 ? val : 1;
    // When rounds change in basic info, immediately sync the schedule
    // This ensures that the schedule tab is pre-populated with the correct number of rows
    onConfigChange({
      ...config,
      details: { ...config.details, rounds: nextRounds },
      schedule: ensureRoundSchedule(config.schedule, nextRounds),
    });
  };

  if (variant === "minimal") {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="tournament-name">Tournament Name</Label>
          <Input
            id="tournament-name"
            value={config.basic.name}
            onChange={(event) => updateBasic({ name: event.target.value })}
            placeholder="e.g., San Diego Fall Open"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="basic-rounds">Rounds</Label>
            <Input
              id="basic-rounds"
              type="number"
              min={1}
              value={config.details.rounds}
              onChange={(event) => handleRoundsChange(parseInt(event.target.value, 10))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="basic-city-state">City &amp; State (2-letter)</Label>
            <Input
              id="basic-city-state"
              value={config.basic.state}
              onChange={(event) => handleCityStateChange(event.target.value)}
              placeholder="e.g., San Diego, CA"
            />
            <p className="text-xs text-muted-foreground">Example: San Diego, CA</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="basic-start-date">Start Date</Label>
            <Input
              id="basic-start-date"
              type="date"
              value={config.basic.startDate ?? ""}
              onChange={(event) => updateBasic({ startDate: event.target.value || null })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="basic-end-date">End Date</Label>
            <Input
              id="basic-end-date"
              type="date"
              value={config.basic.endDate ?? ""}
              onChange={(event) => updateBasic({ endDate: event.target.value || null })}
            />
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Switch
            id="fide-rated"
            checked={config.registers.fideRated}
            onCheckedChange={(checked) => updateRegisters({ fideRated: checked })}
          />
          <Label htmlFor="fide-rated">FIDE Rated</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Switch
            id="uscf-rated"
            checked={config.registers.uscfRated}
            onCheckedChange={(checked) => updateRegisters({ uscfRated: checked })}
          />
          <Label htmlFor="uscf-rated">USCF Rated</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Switch
            id="team-event"
            checked={config.registers.isTeamEvent}
            onCheckedChange={(checked) => updateRegisters({ isTeamEvent: checked })}
          />
          <Label htmlFor="team-event">Team Event</Label>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="tournament-name">Tournament Name</Label>
        <Input
          id="tournament-name"
          value={config.basic.name}
          onChange={(event) => updateBasic({ name: event.target.value })}
          placeholder="e.g., San Diego Fall Open"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="basic-address">Address</Label>
          <Input
            id="basic-address"
            value={config.basic.city}
            onChange={(event) => updateBasic({ city: event.target.value })}
            placeholder="e.g., 111 W Harbor Dr, San Diego"
          />
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              disabled={!config.basic.city.trim()}
              onClick={() => openMaps("google")}
            >
              Open in Google Maps
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!config.basic.city.trim()}
              onClick={() => openMaps("apple")}
            >
              Open in Apple Maps
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="basic-city-state">City &amp; State</Label>
          <Input
            id="basic-city-state"
            value={config.basic.state}
            onChange={(event) => handleCityStateChange(event.target.value)}
            placeholder="e.g., San Diego, CA"
          />
          <p className="text-xs text-muted-foreground">Example: San Diego, CA</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Federation</Label>
          <Select
            value={config.basic.federation}
            onValueChange={(value) => updateBasic({ federation: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select federation" />
            </SelectTrigger>
            <SelectContent>
              {FEDERATION_OPTIONS.map((option) => (
                <SelectItem key={option.code} value={option.code}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="basic-rounds">Rounds</Label>
          <Input
            id="basic-rounds"
            type="number"
            min={1}
            value={config.details.rounds}
            onChange={(event) => {
              const val = parseInt(event.target.value, 10);
              const nextRounds = Number.isFinite(val) && val > 0 ? val : 1;
              onConfigChange({
                ...config,
                details: { ...config.details, rounds: nextRounds },
              });
            }}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="basic-start-date">Start Date</Label>
          <Input
            id="basic-start-date"
            type="date"
            value={config.basic.startDate ?? ""}
            onChange={(event) => updateBasic({ startDate: event.target.value || null })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="basic-end-date">End Date</Label>
          <Input
            id="basic-end-date"
            type="date"
            value={config.basic.endDate ?? ""}
            onChange={(event) => updateBasic({ endDate: event.target.value || null })}
          />
        </div>
      </div>
    </div>
  );
}

interface StepOneProps {
  format: Tournament["format"];
  mode: TournamentMode;
  builderMode: BuilderMode;
  config: TournamentConfig;
  onFormatChange: (format: Tournament["format"]) => void;
  onModeChange: (mode: TournamentMode) => void;
  onConfigChange: (config: TournamentConfig) => void;
  onContinue: () => void;
  onCancel?: () => void;
  isProcessing?: boolean;
  continueLabel?: string;
  processingLabel?: string;
}

function StepOne({
  format,
  mode,
  builderMode,
  config,
  onFormatChange,
  onModeChange,
  onConfigChange,
  onContinue,
  onCancel,
  isProcessing,
  continueLabel,
  processingLabel,
}: StepOneProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();
  const hasRequiredBasics =
    config.basic.name.trim().length > 0 &&
    Boolean(config.basic.startDate) &&
    Boolean(config.basic.endDate) &&
    config.basic.state.trim().length > 0;
  const canContinue = builderMode === "create" ? hasRequiredBasics : true;

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await fileToText(file);
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid file format");
      }

      if (isTournamentTemplateSnapshot(parsed)) {
        const snapshot: TournamentTemplateSnapshot = {
          ...parsed,
          selected:
            Array.isArray(parsed.selected) && parsed.selected.length > 0
              ? (parsed.selected as TemplateSectionKey[])
              : TOURNAMENT_TEMPLATE_OPTIONS.map((option) => option.id),
        };
        const baseConfig = createDefaultConfig(
          snapshot.format ?? format,
          snapshot.mode ?? mode,
        );
        const mergedConfig = applyTournamentTemplateSnapshot(baseConfig, snapshot);
        onModeChange(snapshot.mode ?? mode);
        onFormatChange(snapshot.format ?? format);
        onConfigChange(mergedConfig);
        toast({ title: "Template imported", description: "Configuration applied from template." });
        return;
      }

      const parsedConfig = parseTournamentConfig({
        id: 0,
        name: typeof parsed?.basic?.name === "string" ? parsed.basic.name : "Imported Tournament",
        format: (parsed.format ?? format) as Tournament["format"],
        status: "draft",
        rounds: parsed?.details?.rounds ?? config.details.rounds,
        timeControl: parsed?.details?.timeControl ?? config.details.timeControl,
        currentRound: 0,
        isDoubleRoundRobin: false,
        playerCount: null,
        useQuickSetup: false,
        tiebreakOrder: parsed?.details?.tiebreakSystem ?? "rating",
        location: parsed?.basic?.city ?? "",
        directorPhone: null,
        directorEmail: null,
        roundTimings: parsed,
        createdBy: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Tournament);
      onModeChange(parsedConfig.mode ?? mode);
      onFormatChange(parsedConfig.format ?? format);
      onConfigChange(parsedConfig);
      toast({ title: "Configuration imported" });
    } catch (error: any) {
      toast({
        title: "Import failed",
        description: error?.message ?? "Unable to import configuration file.",
        variant: "destructive",
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const handleContinue = () => {
    if (!canContinue) {
      return;
    }
    onContinue();
  };

  const continueText = isProcessing
    ? processingLabel ?? "Processing..."
    : continueLabel ?? "Continue";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Select Format</CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose the pairing system that matches your event. You can adjust details later.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {FORMAT_CARDS.map((card) => {
              const isSelected = format === card.id;
              return (
                <button
                  type="button"
                  key={card.id}
                  onClick={() => onFormatChange(card.id)}
                  className={`text-left border rounded-lg p-4 transition-colors ${ 
                    isSelected ? "border-primary bg-primary/5" : "hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-lg font-semibold">{card.title}</div>
                    {isSelected && <Check className="h-5 w-5 text-primary" />}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{card.description}</p>
                  <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {card.features.map((feature) => (
                      <li key={feature}>• {feature}</li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Select Mode</CardTitle>
          <p className="text-sm text-muted-foreground">
            Modes enable federation-specific workflows and reports.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {MODE_OPTIONS.map((option) => {
              const isSelected = mode === option.id;
              return (
                <button
                  type="button"
                  key={option.id}
                  onClick={() => onModeChange(option.id)}
                  className={`text-left border rounded-lg p-4 transition-colors ${ 
                    isSelected ? "border-primary bg-primary/5" : "hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{option.label}</div>
                    {isSelected && <Check className="h-5 w-5 text-primary" />}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Basic Information</CardTitle>
          <p className="text-sm text-muted-foreground">
            Capture the essentials so your public page is easier to finish later.
          </p>
        </CardHeader>
        <CardContent>
          <BasicInformationFields variant="minimal" config={config} onConfigChange={onConfigChange} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3 justify-between">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" /> Import from File
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            accept="application/json"
            className="hidden"
            onChange={handleFileImport}
          />
        </div>
        <div className="flex gap-2">
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button onClick={handleContinue} disabled={isProcessing || !canContinue}>
            {continueText}
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}

interface StepTwoProps {
  format: Tournament["format"];
  mode: TournamentMode;
  config: TournamentConfig;
  onConfigChange: (config: TournamentConfig) => void;
  onBack: () => void;
  onCancel?: () => void;
  onSave: () => void;
  saving: boolean;
  tournament?: Tournament;
}

interface PaymentsConfigResponse {
  payments: TournamentConfig["payments"];
  publishableKey: string | null;
  onlineConfigured: boolean;
}

function StepTwo({ format, mode, config, onConfigChange, onBack: _onBack, onCancel, onSave, saving, tournament }: StepTwoProps) {
  const scheduleTemplateOptions = SCHEDULE_EVENT_OPTIONS;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const prizeImportInputRef = useRef<HTMLInputElement | null>(null);
  const sections = config.sections ?? [];
  const prizes = config.prizes ?? [];
  const tournamentId = tournament?.id;
  const { data: paymentsConfigData } = useQuery<PaymentsConfigResponse>({
    queryKey: ["tournament-payments-config", tournamentId],
    queryFn: async () => {
      if (!tournamentId) {
        throw new Error("Tournament id is required");
      }
      return apiRequest(`/api/tournaments/${tournamentId}/payments/config`);
    },
    enabled: Boolean(tournamentId),
    staleTime: 30_000,
  });

  const paymentsSnapshot = paymentsConfigData?.payments ?? config.payments;
  const onlinePaymentsEnabled = Boolean(paymentsSnapshot.onlineEnabled);
  const provider = paymentsSnapshot.provider;
  const hasConnectionDetails = provider === "stripe"
    ? Boolean(
        paymentsSnapshot.stripeAccountId?.trim() ||
          paymentsSnapshot.stripePublishableKey?.trim(),
      )
    : provider === "paypal"
    ? Boolean(
        paymentsSnapshot.paypalMerchantId?.trim() ||
          paymentsSnapshot.paypalClientId?.trim() ||
          paymentsSnapshot.paypalEmail?.trim(),
      )
    : false;
  const collectFeesStatus: "hidden" | "setup" | "pending" | "connected" = !tournamentId || !onlinePaymentsEnabled
    ? "hidden"
    : paymentsConfigData?.onlineConfigured
    ? "connected"
    : hasConnectionDetails
    ? "pending"
    : "setup";
  const collectFeesButtonClass = collectFeesStatus === "connected"
    ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
    : collectFeesStatus === "pending"
    ? "bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
    : "bg-red-600 hover:bg-red-700 text-white shadow-sm";
  const updateDetails = (updates: Partial<TournamentConfig["details"]>) =>
    onConfigChange({ ...config, details: { ...config.details, ...updates } });

  const handleAddAssistantTD = () => {
    const assistantTDs = config.details.assistantTDs ?? [];
    updateDetails({ assistantTDs: [...assistantTDs, ""] });
  };

  const handleUpdateAssistantTD = (index: number, value: string) => {
    const assistantTDs = [...(config.details.assistantTDs ?? [])];
    assistantTDs[index] = value;
    updateDetails({ assistantTDs });
  };

  const handleRemoveAssistantTD = (index: number) => {
    const assistantTDs = (config.details.assistantTDs ?? []).filter((_, i) => i !== index);
    updateDetails({ assistantTDs });
  };

  const updateRegisters = (updates: Partial<TournamentConfig["registers"]>) =>
    onConfigChange({ ...config, registers: { ...config.registers, ...updates } });

  const updatePayments = (updates: Partial<TournamentConfig["payments"]>) =>
    onConfigChange({ ...config, payments: { ...config.payments, ...updates } });

  const updateChessResults = (updates: Partial<TournamentConfig["chessResults"]>) =>
    onConfigChange({ ...config, chessResults: { ...config.chessResults, ...updates } });

  const addSection = () => {
    const nextSection = createSectionDefinition();
    onConfigChange({
      ...config,
      sections: [...sections, nextSection],
    });
  };

  const updateSection = (id: string, updates: Partial<SectionDefinition>) => {
    const previousSection = sections.find((section) => section.id === id);
    const nextSections = sections.map((section) => (section.id === id ? { ...section, ...updates } : section));
    let nextEntryFees = config.entryFees;
    let nextPrizes = prizes;
    if (updates.name !== undefined || updates.ratingMin !== undefined || updates.ratingMax !== undefined) {
      const target = nextSections.find((section) => section.id === id);
      if (target) {
        const previousName = previousSection?.name.trim().toLowerCase() ?? "";
        const nextName = target.name.trim().toLowerCase();
        nextEntryFees = nextEntryFees.map((fee) => {
          const matchesById = fee.sectionId === id;
          const matchesByName =
            !fee.sectionId &&
            (fee.section ?? "").trim().toLowerCase() === (previousName || nextName);
          if (!matchesById && !matchesByName) {
            return fee;
          }
          return {
            ...fee,
            sectionId: target.id,
            section: target.name,
            ratingMin: fee.ratingMin ?? target.ratingMin ?? null,
            ratingMax: fee.ratingMax ?? target.ratingMax ?? null,
          };
        });
        nextPrizes = nextPrizes.map((prize) => {
          const matchesById = prize.sectionId === id;
          const matchesByName =
            !prize.sectionId &&
            (prize.section ?? "").trim().toLowerCase() === (previousName || nextName);
          if (!matchesById && !matchesByName) {
            return prize;
          }
          return {
            ...prize,
            sectionId: target.id,
            section: target.name,
            ratingCap: prize.ratingCap ?? target.ratingMax ?? null,
          };
        });
      }
    }
    onConfigChange({
      ...config,
      sections: nextSections,
      entryFees: nextEntryFees,
      prizes: nextPrizes,
    });
  };

  const removeSection = (id: string) => {
    const removedSection = sections.find((section) => section.id === id);
    const removedName = removedSection?.name.trim().toLowerCase() ?? null;
    const nextSections = sections.filter((section) => section.id !== id);
    const nextEntryFees = config.entryFees.filter((fee) => {
      if (fee.sectionId === id) return false;
      if (removedName && (fee.section ?? "").trim().toLowerCase() === removedName) {
        return false;
      }
      return true;
    });
    const nextPrizes = prizes.filter((prize) => {
      if (prize.sectionId === id) return false;
      if (removedName && (prize.section ?? "").trim().toLowerCase() === removedName) {
        return false;
      }
      return true;
    });
    onConfigChange({
      ...config,
      sections: nextSections,
      entryFees: nextEntryFees,
      prizes: nextPrizes,
    });
  };

  const addEntryFee = () => {
    if (sections.length === 0) {
      toast({
        title: "Add a section first",
        description: "Create sections under Details before configuring pricing.",
        variant: "destructive",
      });
      return;
    }
    const sectionWithGap = sections.find((section) =>
      !entryFees.some((fee) => {
        if (fee.sectionId && fee.sectionId === section.id) return true;
        return (fee.section ?? "").trim().toLowerCase() === section.name.trim().toLowerCase();
      }),
    );
    const targetSection = sectionWithGap ?? sections[0];
    const defaultCurrency = config.payments.defaultCurrency ?? "USD";
    onConfigChange({
      ...config,
      entryFees: [
        ...config.entryFees,
        createEntryFeeRow(targetSection, defaultCurrency),
      ],
    });
  };

  const updateEntryFee = (id: string, updates: Partial<EntryFeeRule>) => {
    const nextEntryFees = config.entryFees.map((fee) => {
      if (fee.id !== id) return fee;
      let nextFee: EntryFeeRule = { ...fee, ...updates };
      const nextSectionId = updates.sectionId ?? fee.sectionId;
      let linked: SectionDefinition | undefined;
      if (nextSectionId) {
        linked = sections.find((section) => section.id === nextSectionId);
      } else if (updates.section) {
        const normalized = updates.section.trim().toLowerCase();
        linked = sections.find((section) => section.name.trim().toLowerCase() === normalized);
      }
      if (linked) {
        nextFee = {
          ...nextFee,
          sectionId: linked.id,
          section: linked.name,
        };
        if (updates.sectionId !== undefined || updates.section !== undefined) {
          nextFee.ratingMin = null;
          nextFee.ratingMax = null;
        }
        if (!nextFee.currency) {
          nextFee.currency = config.payments.defaultCurrency ?? "USD";
        }
      }
      return nextFee;
    });
    onConfigChange({
      ...config,
      entryFees: nextEntryFees,
    });
  };

  const removeEntryFee = (id: string) =>
    onConfigChange({
      ...config,
      entryFees: config.entryFees.filter((fee) => fee.id !== id),
    });

  const handleSectionRatingChange = (id: string, field: "ratingMin" | "ratingMax", raw: string) => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      updateSection(id, { [field]: null } as Partial<SectionDefinition>);
      return;
    }
    const numeric = Number(trimmed);
    updateSection(id, { [field]: Number.isFinite(numeric) ? numeric : null } as Partial<SectionDefinition>);
  };

  const handleEntryFeeAmountChange = (id: string, raw: string) => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      updateEntryFee(id, { amount: 0 });
      return;
    }
    const parsed = Number(trimmed);
    updateEntryFee(id, { amount: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 });
  };

  const handleEntryFeeRatingChange = (id: string, field: "ratingMin" | "ratingMax", raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      updateEntryFee(id, { [field]: null } as Partial<EntryFeeRule>);
      return;
    }
    const numeric = Number(trimmed);
    updateEntryFee(id, { [field]: Number.isFinite(numeric) ? numeric : null } as Partial<EntryFeeRule>);
  };

  const handleEntryFeeDateChange = (id: string, value: string) => {
    const trimmed = value.trim();
    updateEntryFee(id, { effectiveAfter: trimmed ? trimmed : null });
  };

  const addPrize = () => {
    const defaultCurrency = config.payments.defaultCurrency ?? "USD";
    const targetSection = sections.length > 0 ? sections[0] : undefined;
    onConfigChange({
      ...config,
      prizes: [...prizes, createPrizeRow(targetSection, defaultCurrency)],
    });
  };

  const updatePrize = (id: string, updates: Partial<PrizeRule>) => {
    const nextPrizes = prizes.map((prize) => {
      if (prize.id !== id) return prize;
      let nextPrize: PrizeRule = { ...prize, ...updates };
      const nextSectionId = updates.sectionId ?? prize.sectionId;
      let linked: SectionDefinition | undefined;
      if (nextSectionId) {
        linked = sections.find((section) => section.id === nextSectionId);
      } else if (updates.section) {
        const normalized = updates.section.trim().toLowerCase();
        linked = sections.find((section) => section.name.trim().toLowerCase() === normalized);
      }
      if (linked) {
        nextPrize = {
          ...nextPrize,
          sectionId: linked.id,
          section: linked.name,
        };
        if (updates.sectionId !== undefined || updates.section !== undefined) {
          nextPrize.ratingCap = linked.ratingMax ?? null;
        }
      }
      if (!nextPrize.currency) {
        nextPrize.currency = config.payments.defaultCurrency ?? "USD";
      }
      return nextPrize;
    });
    onConfigChange({
      ...config,
      prizes: nextPrizes,
    });
  };

  const removePrize = (id: string) =>
    onConfigChange({
      ...config,
      prizes: prizes.filter((prize) => prize.id !== id),
    });

  const handlePrizeRatingCapChange = (id: string, raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      updatePrize(id, { ratingCap: null });
      return;
    }
    const numeric = parseRatingCap(trimmed);
    updatePrize(id, { ratingCap: numeric });
  };

  const handlePrizeAmountChange = (id: string, raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      updatePrize(id, { amount: 0 });
      return;
    }
    const normalized = Number(trimmed.replace(/[^0-9.-]/g, ""));
    const amount = Number.isFinite(normalized) ? Number(normalized.toFixed(2)) : 0;
    updatePrize(id, { amount });
  };

  const handlePrizeCurrencyChange = (id: string, currency: string) => {
    updatePrize(id, { currency: currency.toUpperCase() });
  };

  const handlePrizePlaceChange = (id: string, value: string) => {
    updatePrize(id, { place: value.trim() });
  };

  const formatPrizeRating = (rating: number | null) => {
    if (rating === null) {
      return "Open";
    }
    return `U${rating}`;
  };

  const parseRatingCap = (input: string): number | null => {
    const match = input.match(/\d+/);
    if (!match) return null;
    const numeric = Number(match[0]);
    if (!Number.isFinite(numeric)) return null;
    return Math.max(0, Math.round(numeric));
  };

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const formatDate = (dateString: string | null): string | null => {
    if (!dateString) return null;
    const [year, month, day] = dateString.split('-').map(Number);
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  };

  const handlePrizePrint = () => {
    if (typeof window === "undefined") return;

    const groupedBySection: Record<string, PrizeRule[]> = prizes.reduce(
      (acc, prize) => {
        const sectionKey = prize.section || "Uncategorized";
        if (!acc[sectionKey]) {
          acc[sectionKey] = [];
        }
        acc[sectionKey].push(prize);
        return acc;
      },
      {} as Record<string, PrizeRule[]>,
    );

    const sectionsHtml = Object.entries(groupedBySection)
      .map(([sectionName, prizesInSection]) => {
        const sectionDef = sections.find(s => s.name === sectionName);
        const sectionRatingMax = sectionDef?.ratingMax ?? null;

        const groupedByRatingCap: Record<string, PrizeRule[]> = prizesInSection.reduce(
          (acc, prize) => {
            const ratingCapKey =
              prize.ratingCap === sectionRatingMax || prize.ratingCap === null
                ? "main"
                : `U${prize.ratingCap}`;
            if (!acc[ratingCapKey]) {
              acc[ratingCapKey] = [];
            }
            acc[ratingCapKey].push(prize);
            return acc;
          },
          {} as Record<string, PrizeRule[]>,
        );

        const ratingCapsHtml = Object.entries(groupedByRatingCap)
          .map(([ratingCapName, prizesInCap]) => {
            const prizesHtml = prizesInCap
              .map((prize) => {
                const placeLabel = escapeHtml(prize.place ?? "");
                const amountLabel = escapeHtml(
                  `${prize.currency ?? "USD"} ${Number(prize.amount || 0).toFixed(2)}`,
                );
                return `<div class="prize-item">${placeLabel} - ${amountLabel}</div>`;
              })
              .join("");

            const capTitle =
              ratingCapName !== "main" ? `<h3 class="rating-cap-title">${escapeHtml(ratingCapName)}</h3>` : "";

            return `<div class="rating-group">
                      ${capTitle}
                      ${prizesHtml}
                    </div>`;
          })
          .join("");

        return `<div class="section">
                  <h2 class="section-title">${escapeHtml(sectionName)}</h2>
                  ${ratingCapsHtml}
                </div>`;
      })
      .join("");

    const tableHtml = prizes.length ? sectionsHtml : `<p>No prizes configured.</p>`;
    const tournamentName = escapeHtml(config.basic.name || "Tournament");
    
    const formattedStartDate = formatDate(config.basic.startDate);
    const formattedEndDate = formatDate(config.basic.endDate);
    const tournamentDate = escapeHtml(
      formattedStartDate
        ? `${formattedStartDate}${formattedEndDate && formattedEndDate !== formattedStartDate ? ` - ${formattedEndDate}` : ""}`
        : "N/A",
    );

    const content = `<!doctype html><html><head><title>Prize Payouts</title><style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; color: #1e293b; }
      .header { text-align: center; margin-bottom: 2rem; }
      h1 { font-size: 1.875rem; line-height: 2.25rem; margin: 0; }
      .date { font-size: 1.125rem; line-height: 1.75rem; color: #475569; }
      .section { margin-bottom: 2.5rem; page-break-inside: avoid; }
      .section-title { text-align: center; font-size: 1.5rem; line-height: 2rem; margin-bottom: 1.5rem; color: #334155; }
      .rating-group { margin-top: 1.5rem; }
      .rating-cap-title { text-align: center; font-size: 1.125rem; font-weight: 600; color: #4f46e5; margin-bottom: 1rem; }
      .prize-item { text-align: center; font-size: 1rem; line-height: 1.5rem; margin-bottom: 0.5rem; }
      p { text-align: center; color: #64748b; }
    </style></head><body>
      <div class="header">
        <h1>${tournamentName}</h1>
        <p class="date">${tournamentDate}</p>
      </div>
      ${tableHtml}
    </body></html>`;

    const iframe = document.createElement("iframe");
    iframe.style.position = "absolute";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(content);
      doc.close();
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }

    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  };

  const handleSpectatorLinkPrint = async () => {
    if (typeof window === "undefined") return;

    const currentSpectatorLink = tournamentId ? `${window.location.origin}/tournaments/${tournamentId}` : "";
    let qrCodeDataUrl = "";
    try {
      qrCodeDataUrl = await qrcode.toDataURL(currentSpectatorLink, { errorCorrectionLevel: "H", width: 200 });
      console.log("Generated QR Code Data URL:", qrCodeDataUrl);
    } catch (error) {
      console.error("Failed to generate QR code", error);
    }

    const content = `<!doctype html><html><head><title>Spectator Link</title><style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; text-align: center; }
      h1 { font-size: 24px; margin-bottom: 16px; }
      p { margin-bottom: 16px; }
      img { margin: 0 auto; display: block; }
    </style></head><body>
      <h1>Spectator Link for ${escapeHtml(config.basic.name)}</h1>
      <p>Share this link to allow others to spectate the event:</p>
      <p><a href="${currentSpectatorLink}">${currentSpectatorLink}</a></p>
      ${qrCodeDataUrl ? `<img src="${qrCodeDataUrl}" alt="QR Code" style="width: 200px; height: 200px;"/>` : ""}
      ${config.registers.allowPlayerToJoin ? `<p>Players can register for this tournament.</p>` : `<p>Players cannot register for this tournament.</p>`}
    </body></html>`;

    const iframe = document.createElement("iframe");
    iframe.style.position = "absolute";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(content);
      doc.close();
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }

    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  };

  const handlePrizeDownload = () => {
    if (typeof window === "undefined") return;
    const header = ["Section", "Rating", "Place", "Amount", "Currency"];
    const rows = prizes.map((prize) => [
      prize.section ?? "",
      formatPrizeRating(prize.ratingCap),
      prize.place ?? "",
      String(Number(prize.amount || 0).toFixed(2)),
      prize.currency ?? "USD",
    ]);
    const toCsvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map((cell) => toCsvCell(cell ?? "")).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const slug = config.basic.name
      ? config.basic.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
      : "tournament";
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slug || "tournament"}-prizes.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrizeImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (lines.length === 0) {
        toast({
          title: "No data found",
          description: "Upload a CSV export from Google Sheets with at least one row.",
          variant: "destructive",
        });
        return;
      }
      let startIndex = 0;
      const header = lines[0].toLowerCase();
      if (header.includes("section") && header.includes("rating")) {
        startIndex = 1;
      }
      const defaultCurrency = config.payments.defaultCurrency ?? "USD";
      const headerCells =
        startIndex === 1 ? lines[0].split(",").map((cell) => cell.trim().toLowerCase()) : [];
      const imported: PrizeRule[] = [];
      for (let index = startIndex; index < lines.length; index += 1) {
        const rawLine = lines[index];
        if (!rawLine) continue;
        const cells = rawLine.split(",").map((cell) => cell.trim());
        const findIndex = (match: string) =>
          headerCells.findIndex((column) => column.includes(match));
        const sectionIndex = headerCells.length ? findIndex("section") : -1;
        const ratingIndex = headerCells.length ? findIndex("rating") : -1;
        const sectionCell = sectionIndex >= 0 && sectionIndex < cells.length ? cells[sectionIndex] : cells[0] ?? "";
        const ratingCell = ratingIndex >= 0 && ratingIndex < cells.length ? cells[ratingIndex] : cells[1] ?? "";
        const placeCell = (() => {
          if (headerCells.length) {
            const explicitPlace = findIndex("place");
            if (explicitPlace >= 0 && explicitPlace < cells.length) {
              return cells[explicitPlace];
            }
            const legacyNotes = findIndex("note");
            if (legacyNotes >= 0 && legacyNotes < cells.length) {
              return cells[legacyNotes];
            }
          }
          if (cells.length >= 5) {
            return cells[2] ?? "";
          }
          return "";
        })();
        const amountCell = (() => {
          if (headerCells.length) {
            const amountIndex = findIndex("amount");
            if (amountIndex >= 0 && amountIndex < cells.length) {
              return cells[amountIndex];
            }
          }
          if (cells.length === 4) {
            return cells[2] ?? "";
          }
          return cells[3] ?? "";
        })();
        const currencyCell = (() => {
          if (headerCells.length) {
            const currencyIndex = findIndex("currency");
            if (currencyIndex >= 0 && currencyIndex < cells.length) {
              return cells[currencyIndex];
            }
          }
          if (cells.length === 4) {
            return cells[3] ?? "";
          }
          return cells[4] ?? "";
        })();
        if (!sectionCell) continue;
        const linkedSection = sections.find(
          (section) => section.name.trim().toLowerCase() === sectionCell.trim().toLowerCase(),
        );
        const base = createPrizeRow(linkedSection, currencyCell || defaultCurrency);
        base.section = linkedSection?.name ?? sectionCell;
        base.sectionId = linkedSection?.id;
        base.ratingCap = ratingCell ? parseRatingCap(ratingCell) : linkedSection?.ratingMax ?? null;
        const normalizedAmount = Number(amountCell.replace(/[^0-9.-]/g, ""));
        base.amount = Number.isFinite(normalizedAmount) ? Number(normalizedAmount.toFixed(2)) : 0;
        base.currency = currencyCell ? currencyCell.toUpperCase() : defaultCurrency;
        base.place = placeCell.trim();
        imported.push(base);
      }
      if (imported.length === 0) {
        toast({
          title: "No rows imported",
          description: "Ensure your sheet has Section, Rating, Place, and Amount columns.",
          variant: "destructive",
        });
        return;
      }
      onConfigChange({
        ...config,
        prizes: imported,
      });
      toast({
        title: "Prizes imported",
        description: `Loaded ${imported.length} prize ${imported.length === 1 ? "row" : "rows"}`,
      });
    } catch (error) {
      toast({
        title: "Unable to import prizes",
        description:
          error instanceof Error
            ? error.message
            : "Upload failed. Export your Google Sheet as CSV and try again.",
        variant: "destructive",
      });
    } finally {
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const entryFees = config.entryFees ?? [];
  const sectionsMissingPricing = sections.filter((section) =>
    !entryFees.some((fee) => {
      if (fee.sectionId && fee.sectionId === section.id) return true;
      return (fee.section ?? "").trim().toLowerCase() === section.name.trim().toLowerCase();
    }),
  );

  const [, setLocation] = useLocation();
  const [settingsShortcut, setSettingsShortcut] = useState<SettingsShortcutTab>("rate-tournament");
  const [paymentsDialogOpen, setPaymentsDialogOpen] = useState(false);
  const [paymentSettingsDraft, setPaymentSettingsDraft] = useState(config.payments);
  const [chessResultsEnabled, setChessResultsEnabled] = useState(false);
  const [qrCodeModalOpen, setQrCodeModalOpen] = useState(false);
  const spectatorLink = tournamentId ? `${window.location.origin}/tournaments/${tournamentId}` : "";

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
        onConfigChange(cloneConfig(result.config));
      }
      toast({ title: "Chess-Results sync complete" });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
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
    if (paymentsDialogOpen) {
      setPaymentSettingsDraft(config.payments);
    }
  }, [paymentsDialogOpen, config.payments]);

  const handlePaymentSettingsDialogChange = (open: boolean) => {
    setPaymentsDialogOpen(open);
    if (!open) {
      setPaymentSettingsDraft(config.payments);
    }
  };

  const commitPaymentSettings = (next: TournamentConfig["payments"]) => {
    onConfigChange({ ...config, payments: next });
  };

  const updatePaymentDraft = <K extends keyof TournamentConfig["payments"]>(
    key: K,
    value: TournamentConfig["payments"][K],
  ) => {
    setPaymentSettingsDraft((prev) => ({ ...prev, [key]: value }));
  };

  const toggleOfflineMethod = (method: OfflinePaymentMethod) => {
    setPaymentSettingsDraft((prev) => {
      const current = prev.acceptedOfflineMethods ?? [];
      const next = current.includes(method)
        ? current.filter((value) => value !== method)
        : [...current, method];
      return { ...prev, acceptedOfflineMethods: next };
    });
  };

  const handleProcessingFeeChange = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      updatePaymentDraft("processingFeePercent", null);
      return;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const clamped = Math.max(0, Math.min(10, Number(numeric.toFixed(2))));
      updatePaymentDraft("processingFeePercent", clamped);
    }
  };

  const handlePaymentSettingsSave = () => {
    commitPaymentSettings(paymentSettingsDraft);
    setPaymentsDialogOpen(false);
  };

  const handleDownloadChessResults = () => {
    if (!config) return;
    downloadJson(`tournament-${tournamentId}-chess-results.json`, {
      tournamentId,
      tournamentName: tournament?.name,
      form: "ChessResults",
      data: config.chessResults,
    });
  };

  const handleSchedulePrint = () => {
    if (typeof window === "undefined") return;

    const scheduleHtml = config.schedule
      .map((event) => {
        const date = formatDate(event.date) ?? "";
        const time = event.time || "";
        const label = escapeHtml(event.label || "");
        return `<tr><td>${date}</td><td>${time}</td><td>${label}</td></tr>`;
      })
      .join("");

    const tableHtml = config.schedule.length
      ? `<table><thead><tr><th>Date</th><th>Time</th><th>Event</th></tr></thead><tbody>${scheduleHtml}</tbody></table>`
      : `<p>No schedule configured.</p>`;

    const content = `<!doctype html><html><head><title>${escapeHtml(
      config.basic.name,
    )}</title><style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; }
      h1 { font-size: 24px; margin-bottom: 16px; }
      h2 { font-size: 20px; margin-top: 24px; margin-bottom: 16px; }
      p { margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #cbd5f5; padding: 8px 12px; text-align: left; }
      th { background-color: #eef2ff; }
    </style></head><body>
      <h1>${escapeHtml(config.basic.name)}</h1>
      <p>${escapeHtml(config.basic.description)}</p>
      <h2>Schedule</h2>
      ${tableHtml}
    </body></html>`;

    const iframe = document.createElement("iframe");
    iframe.style.position = "absolute";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(content);
      doc.close();
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }

    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  };



  const defaultTimeControlFor = (type: TimeControlType): TimeControlDefinition => {
    switch (type) {
      case "rapid":
        return { minutes: 15, addonType: "increment", addonValue: 10 };
      case "blitz":
        return { minutes: 5, addonType: "none", addonValue: 0 };
      default:
        return { minutes: 90, addonType: "increment", addonValue: 30 };
    }
  };

  const baseTimeControls: TimeControlDefinition[] =
    config.details.timeControls && config.details.timeControls.length > 0
      ? config.details.timeControls
      : [defaultTimeControlFor(config.details.timeControl)];

  const addTimeControl = () => {
    const last = baseTimeControls[baseTimeControls.length - 1] ?? defaultTimeControlFor(config.details.timeControl);
    const next = [...baseTimeControls, { ...last }];
    onConfigChange({
      ...config,
      details: { ...config.details, timeControls: next },
    });
  };

  const updateTimeControlDefinition = (index: number, updates: Partial<TimeControlDefinition>) => {
    const next = baseTimeControls.map((control, idx) => (idx === index ? { ...control, ...updates } : control));
    onConfigChange({
      ...config,
      details: { ...config.details, timeControls: next },
    });
  };

  const removeTimeControl = (index: number) => {
    if (baseTimeControls.length <= 1) return;
    const next = baseTimeControls.filter((_, idx) => idx !== index);
    onConfigChange({
      ...config,
      details: { ...config.details, timeControls: next },
    });
  };

  const templateLabelToRound = (label: string): number | null => {
    const match = label.match(/^Round\s+(\d+)/i);
    if (!match) return null;
    const value = parseInt(match[1] ?? "", 10);
    return Number.isFinite(value) ? value : null;
  };

  const ensureRoundSchedule = (schedule: ScheduleEvent[], rounds: number): ScheduleEvent[] => {
    const roundEvents: ScheduleEvent[] = [];
    const nonRoundEvents: ScheduleEvent[] = [];
    const seenRounds = new Set<number>();

    schedule.forEach((event) => {
      if (event.round && event.round >= 1 && event.round <= rounds) {
        if (!seenRounds.has(event.round)) {
          seenRounds.add(event.round);
          roundEvents.push({
            ...event,
            label: event.label || `Round ${event.round}`,
            round: event.round,
          });
        }
      } else if (event.round && event.round > rounds) {
        nonRoundEvents.push({ ...event, round: null });
      } else {
        nonRoundEvents.push(event);
      }
    });

    for (let round = 1; round <= rounds; round++) {
      if (!seenRounds.has(round)) {
        roundEvents.push({
          id: `${Date.now()}-${round}-${Math.random()}`,
          date: null,
          time: null,
          label: scheduleTemplateOptions[round - 1] ?? `Round ${round}`,
          round,
        });
      }
    }

    roundEvents.sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
    return [...roundEvents, ...nonRoundEvents];
  };

  const addScheduleRow = () => {
    const newEvent: ScheduleEvent = {
      id: `${Date.now()}-${Math.random()}`,
      date: null,
      time: null,
      label: "Other Event",
      round: null,
    };
    onConfigChange({
      ...config,
      schedule: [...config.schedule, newEvent],
    });
  };

  const removeScheduleRow = (id: string) => {
    const nextSchedule = config.schedule.filter((event) => event.id !== id);
    onConfigChange({
      ...config,
      schedule: ensureRoundSchedule(nextSchedule, config.details.rounds),
    });
  };

  const updateScheduleRow = (id: string, updates: Partial<ScheduleEvent>) => {
    const nextSchedule = config.schedule.map((event) => {
      if (event.id !== id) return event;
      const nextEvent = { ...event, ...updates };
      if (updates.label !== undefined) {
        const derivedRound = templateLabelToRound(updates.label ?? "");
        nextEvent.round = derivedRound;
      }
      if (updates.round !== undefined && updates.round === null) {
        nextEvent.round = null;
      }
      return nextEvent;
    });

    onConfigChange({
      ...config,
      schedule: ensureRoundSchedule(nextSchedule, config.details.rounds),
    });
  };

  const handleRoundsChange = (value: number) => {
    const nextRounds = Math.max(1, value);
    // When the user explicitly changes the rounds count here,
    // we should update the config details AND update the schedule
    // to match the new count. This ensures that the generated schedule
    // respects the configured number of rounds.
    onConfigChange({
      ...config,
      details: { ...config.details, rounds: nextRounds },
      schedule: ensureRoundSchedule(config.schedule, nextRounds),
    });
  };

  const handleShortcutChange = (next: SettingsShortcutTab) => {
    if (next === "rate-tournament") {
      setSettingsShortcut("rate-tournament");
      return;
    }
    if (!tournament) {
      setSettingsShortcut("rate-tournament");
      return;
    }

    const target = `/tournaments/${tournament.id}/settings/${next}`;
    setSettingsShortcut("rate-tournament");
    setLocation(target);
  };

  const fideEnabled = config.registers.fideRated;
  

  const renderTabSaveButton = () => (
    <div className="flex justify-end pt-4">
      <Button type="button" onClick={onSave} disabled={saving}>
        {saving ? "Saving..." : "Save"}
      </Button>
    </div>
  );

  const defaultScoring = useMemo(() => createDefaultConfig(format).details.scoring, [format]);
  const scoring = config.details.scoring ?? defaultScoring;
  const tiebreaks = config.details.tiebreaks ?? [];
  const handleScoreChange = (field: keyof ScoringRules, raw: string) => {
    if (raw === "") {
      updateDetails({ scoring: { ...scoring, [field]: 0 } });
      return;
    }
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      return;
    }
    const clamped = Math.max(-10, Math.min(10, Number(numeric.toFixed(2))));
    updateDetails({ scoring: { ...scoring, [field]: clamped } });
  };
  const resetScoring = () => updateDetails({ scoring: { ...defaultScoring } });
  const setTiebreaks = (next: string[]) => updateDetails({ tiebreaks: next });
  const addTiebreakRule = () => {
    const fallback = TIEBREAK_OPTIONS.find((option) => !tiebreaks.includes(option.label))?.label ?? "Buchholz";
    setTiebreaks([...tiebreaks, fallback]);
    updateDetails({ tiebreaksEnabled: true });
  };
  const updateTiebreakRule = (index: number, value: string) => {
    const next = [...tiebreaks];
    next[index] = value;
    setTiebreaks(next);
  };
  const removeTiebreakRule = (index: number) => {
    const next = tiebreaks.filter((_, position) => position !== index);
    setTiebreaks(next);
  };
  const moveTiebreakRule = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= tiebreaks.length) {
      return;
    }
    const next = [...tiebreaks];
    const [entry] = next.splice(index, 1);
    next.splice(target, 0, entry);
    setTiebreaks(next);
  };
  const toggleTiebreaks = (checked: boolean) => updateDetails({ tiebreaksEnabled: checked });

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            Format: <Badge variant="secondary">{format.toUpperCase()}</Badge>
          </span>
          <span>
            Mode: <Badge variant="outline">{mode.toUpperCase()}</Badge>
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-1">
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-8">
                <TabsTrigger value="basic">Basic information</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="schedule">Schedule</TabsTrigger>
              <TabsTrigger value="payments">Payments</TabsTrigger>
              <TabsTrigger value="prizes">Prizes</TabsTrigger>
                <TabsTrigger value="playerSignup">Player sign up</TabsTrigger>
                <TabsTrigger value="rate-tournament">Rate Tournament</TabsTrigger>
                <TabsTrigger value="options">Options</TabsTrigger>
              </TabsList>
              <TabsContent value="basic" className="bg-white p-6 space-y-4">
                <BasicInformationFields config={config} onConfigChange={onConfigChange} />
                {renderTabSaveButton()}
              </TabsContent>

              <TabsContent value="details" className="bg-white p-6 space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Chief Arbiter</Label>
                    <OfficialSearchInput
                      value={config.details.chiefArbiter}
                      onChange={(value) => updateDetails({ chiefArbiter: value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Organizer</Label>
                    <Input
                      value={config.details.organizer}
                      onChange={(event) => updateDetails({ organizer: event.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Affiliate</Label>
                    <Input
                      value={config.details.affiliate}
                      onChange={(event) => updateDetails({ affiliate: event.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Assistant TDs</Label>
                    <Button variant="outline" size="sm" onClick={handleAddAssistantTD}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {(config.details.assistantTDs ?? []).map((td, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <OfficialSearchInput
                          value={td}
                          onChange={(value) => handleUpdateAssistantTD(index, value)}
                        />
                        <Button variant="ghost" size="icon" onClick={() => handleRemoveAssistantTD(index)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Time Control</Label>
                    <Select
                      value={config.details.timeControl}
                      onValueChange={(value) => {
                        const defaults = defaultTimeControlFor(value as TimeControlType);
                        let nextTimeControls = baseTimeControls.length === 0 ? [defaults] : baseTimeControls;
                        if (nextTimeControls.length === 1) {
                          nextTimeControls = [{ ...nextTimeControls[0], ...defaults }];
                        }
                        updateDetails({
                          timeControl: value as TimeControlType,
                          timeControls: nextTimeControls,
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIME_CONTROL_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Rating Type</Label>
                  <Select
                    value={config.details.ratingType}
                    onValueChange={(value) => updateDetails({ ratingType: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RATING_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>


                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-semibold">Clock Settings</Label>
                    <Button variant="outline" onClick={addTimeControl}>
                      Add Time Control
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {baseTimeControls.map((control, index) => (
                      <div
                        key={`${index}-${control.minutes}-${control.addonType}`}
                        className="grid gap-3 md:grid-cols-[150px,200px,1fr,auto] items-center border rounded-lg p-3"
                      >
                        <div className="space-y-1">
                          <Label>Minutes</Label>
                          <Input
                            type="number"
                            min={0}
                            value={control.minutes}
                            onChange={(event) =>
                              updateTimeControlDefinition(index, {
                                minutes: parseInt(event.target.value || "0", 10),
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Add-on</Label>
                          <Select
                            value={control.addonType}
                            onValueChange={(value) =>
                              updateTimeControlDefinition(index, {
                                addonType: value as TimeAddonType,
                                addonValue: value === "none" ? 0 : control.addonValue,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              <SelectItem value="increment">Increment</SelectItem>
                              <SelectItem value="delay">Delay</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>
                            {control.addonType === "increment"
                              ? "Increment (seconds)"
                              : control.addonType === "delay"
                              ? "Delay (seconds)"
                              : "Additional Time"}
                          </Label>
                          <Input
                            type="number"
                            min={0}
                            value={control.addonType === "none" ? 0 : control.addonValue}
                            disabled={control.addonType === "none"}
                            onChange={(event) =>
                              updateTimeControlDefinition(index, {
                                addonValue: parseInt(event.target.value || "0", 10),
                              })
                            }
                          />
                        </div>
                        <div className="flex justify-end">
                          {index > 0 && (
                            <Button
                              type="button"
                              variant="ghost"
                              className="text-red-500"
                              onClick={() => removeTimeControl(index)}
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Pairing System</Label>
                    <Input
                      value={config.details.pairingSystem}
                      onChange={(event) => updateDetails({ pairingSystem: event.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Rounds</Label>
                    <Input
                      type="number"
                      min={1}
                      value={config.details.rounds}
                      onChange={(event) => {
                        const value = Math.max(1, parseInt(event.target.value || "1", 10));
                        handleRoundsChange(value);
                      }}
                    />
                  </div>
                </div>



                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Sections & rating bands</h3>
                      <p className="text-xs text-slate-600">
                        Define the sections players can enter. Rating bounds are enforced throughout registration and pricing.
                      </p>
                    </div>
                    <Button variant="outline" onClick={addSection}>
                      Add section
                    </Button>
                  </div>

                  {sections.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-xs text-slate-600">
                      No sections configured yet. Create at least one section to enable payment configuration and registration flows.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {sections.map((section) => {
                        const ratingLabel =
                          section.ratingMin === null && section.ratingMax === null
                            ? "Open to all ratings"
                            : `${section.ratingMin ?? "Unrated"} – ${section.ratingMax ?? "Open"}`;

                        return (
                          <div key={section.id} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
                            <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,1fr))_auto] md:items-end">
                              <div>
                                <Label className="text-xs font-semibold uppercase text-slate-500">Section name</Label>
                                <Input
                                  value={section.name}
                                  onChange={(event) => updateSection(section.id, { name: event.target.value })}
                                  placeholder="e.g., Championship"
                                />
                              </div>
                              <div>
                                <Label className="text-xs font-semibold uppercase text-slate-500">Rating floor</Label>
                                <Input
                                  type="number"
                                  value={section.ratingMin ?? ""}
                                  onChange={(event) =>
                                    handleSectionRatingChange(section.id, "ratingMin", event.target.value)
                                  }
                                  placeholder="e.g., 1800"
                                />
                              </div>
                              <div>
                                <Label className="text-xs font-semibold uppercase text-slate-500">Rating ceiling</Label>
                                <Input
                                  type="number"
                                  value={section.ratingMax ?? ""}
                                  onChange={(event) =>
                                    handleSectionRatingChange(section.id, "ratingMax", event.target.value)
                                  }
                                  placeholder="Leave blank for open"
                                />
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                className="justify-self-end text-red-600"
                                onClick={() => removeSection(section.id)}
                              >
                                Remove
                              </Button>
                            </div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">{ratingLabel}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {sections.length > 0 && (
                    <p className="text-xs text-slate-500">
                      Tip: After defining sections, configure required entry fees in the Payments tab.
                    </p>
                  )}
                </div>

                {renderTabSaveButton()}
              </TabsContent>

              <TabsContent value="schedule" className="bg-white p-6 space-y-3">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-lg font-semibold">Schedule</h3>
                    <p className="text-sm text-muted-foreground">
                      Plan rounds and ceremonies. These entries appear on reports and public pages.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={addScheduleRow}>
                      Add Event
                    </Button>
                    <Button variant="outline" onClick={handleSchedulePrint}>
                      Print Schedule
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  {config.schedule.map((event) => (
                    <div
                      key={event.id}
                      className="grid gap-3 md:grid-cols-[150px,150px,1fr,auto] items-center border rounded-lg p-3"
                    >
                      <Input
                        type="date"
                        value={event.date ?? ""}
                        onChange={(e) => updateScheduleRow(event.id, { date: e.target.value || null })}
                      />
                      <Input
                        type="time"
                        value={event.time ?? ""}
                        onChange={(e) => updateScheduleRow(event.id, { time: e.target.value || null })}
                      />
                      <Select
                        value={event.label}
                        onValueChange={(value) => {
                          updateScheduleRow(event.id, { label: value });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select template" />
                        </SelectTrigger>
                        <SelectContent>
                          {scheduleTemplateOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-red-500"
                        onClick={() => removeScheduleRow(event.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>

                {renderTabSaveButton()}
              </TabsContent>
              <TabsContent value="payments" className="bg-white p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">Entry fee rules</h3>
                    <p className="text-xs text-slate-600">
                      Configure pricing by section, rating eligibility, and effective date.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {collectFeesStatus !== "hidden" && (
                      <Button
                        type="button"
                        className={cn("flex items-center gap-2", collectFeesButtonClass)}
                        onClick={() => {
                          if (tournamentId) {
                            setLocation(`/tournaments/${tournamentId}/payments/setup`);
                          }
                        }}
                        disabled={!tournamentId}
                      >
                        <CreditCard className="h-4 w-4" />
                        Collect Entry Fees
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 gap-2 border"
                      onClick={() => setPaymentsDialogOpen(true)}
                    >
                      <Settings className="h-4 w-4" />
                      <span>Settings</span>
                    </Button>
                    <Button variant="outline" onClick={addEntryFee} disabled={sections.length === 0}>
                      Add entry rule
                    </Button>
                  </div>
                </div>

                {sections.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-600">
                    Create sections under the Details tab before configuring pricing.
                  </div>
                ) : entryFees.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-600">
                    No entry rules configured yet. Add a rule for each section to open registration.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {entryFees.map((fee) => {
                      const activeSection =
                        sections.find((section) => section.id === fee.sectionId) ??
                        sections.find(
                          (section) => section.name.trim().toLowerCase() === (fee.section ?? "").trim().toLowerCase(),
                        );
                      const derivedRatingMin =
                        fee.ratingMin ?? activeSection?.ratingMin ?? null;
                      const derivedRatingMax =
                        fee.ratingMax ?? activeSection?.ratingMax ?? null;
                      const inheritsSectionRange = fee.ratingMin === null && fee.ratingMax === null;
                      const ratingSummary = formatRatingRange(derivedRatingMin, derivedRatingMax);

                      return (
                        <div key={fee.id} className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
                          <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-baseline">
                            <div className="space-y-2">
                              <Label className="text-xs font-semibold uppercase text-slate-500">Section</Label>
                              <Select
                                value={activeSection?.id ?? fee.sectionId ?? ""}
                                onValueChange={(value) => updateEntryFee(fee.id, { sectionId: value })}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Select section" />
                                </SelectTrigger>
                                <SelectContent>
                                  {sections.map((section) => (
                                    <SelectItem key={section.id} value={section.id}>
                                      {section.name || "Unnamed section"}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <p className="mt-1 text-[11px] text-slate-500">{ratingSummary}</p>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-semibold uppercase text-slate-500">Amount</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={typeof fee.amount === "number" ? String(fee.amount) : ""}
                                onChange={(event) => handleEntryFeeAmountChange(fee.id, event.target.value)}
                                placeholder="e.g., 120"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-semibold uppercase text-slate-500">Currency</Label>
                              <Select
                                value={fee.currency || config.payments.defaultCurrency || "USD"}
                                onValueChange={(value) => updateEntryFee(fee.id, { currency: value })}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ENTRY_FEE_CURRENCY_OPTIONS.map((option) => (
                                    <SelectItem key={option} value={option}>
                                      {option}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              className="justify-self-end text-red-600"
                              onClick={() => removeEntryFee(fee.id)}
                            >
                              Remove
                            </Button>
                          </div>

                          <div className="grid gap-3 md:grid-cols-3">
                            <div>
                              <Label className="text-xs font-semibold uppercase text-slate-500">Rating floor</Label>
                              <Input
                                type="number"
                                value={fee.ratingMin ?? ""}
                                onChange={(event) =>
                                  handleEntryFeeRatingChange(fee.id, "ratingMin", event.target.value)
                                }
                                placeholder={inheritsSectionRange ? "Inherits section" : "e.g., 2000"}
                              />
                            </div>
                            <div>
                              <Label className="text-xs font-semibold uppercase text-slate-500">Rating ceiling</Label>
                              <Input
                                type="number"
                                value={fee.ratingMax ?? ""}
                                onChange={(event) =>
                                  handleEntryFeeRatingChange(fee.id, "ratingMax", event.target.value)
                                }
                                placeholder={inheritsSectionRange ? "Inherits section" : "Leave blank for open"}
                              />
                            </div>
                            <div>
                              <Label className="text-xs font-semibold uppercase text-slate-500">Effective after</Label>
                              <Input
                                type="date"
                                value={fee.effectiveAfter ?? ""}
                                onChange={(event) => handleEntryFeeDateChange(fee.id, event.target.value)}
                              />
                            </div>
                          </div>


                          <p className="text-[11px] text-slate-500">
                            {inheritsSectionRange
                              ? "Leaving the rating fields blank inherits the section rating window."
                              : "Custom rating bounds override the section window for this rule."}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {sections.length > 0 && sectionsMissingPricing.length > 0 && (
                  <div className="rounded-lg border border-dashed border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                    {sectionsMissingPricing.length === 1
                      ? `${sectionsMissingPricing[0].name || "Unnamed section"} still needs an entry rule.`
                      : `The following sections still need at least one entry rule: ${sectionsMissingPricing
                          .map((section) => section.name || "Unnamed section")
                          .join(", ")}.`}
                  </div>
                )}

                {renderTabSaveButton()}
              </TabsContent>

              <TabsContent value="prizes" className="bg-white p-6 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-4">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">Prize payouts</h3>
                        <p className="text-xs text-slate-600">
                          Define prize amounts by section and U-rating cutoff (e.g., U1600).
                        </p>
                      </div>
                      <Switch
                        checked={config.prizesEnabled}
                        onCheckedChange={(checked) => onConfigChange({ ...config, prizesEnabled: checked })}
                      />
                    </div>
                    {config.prizesEnabled && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" onClick={handlePrizePrint} disabled={prizes.length === 0}>
                          Print
                        </Button>
                        <Button variant="outline" onClick={handlePrizeDownload} disabled={prizes.length === 0}>
                          Download
                        </Button>
                        <Button variant="outline" onClick={() => prizeImportInputRef.current?.click()}>
                          Import Google Sheet
                        </Button>
                        <input
                          ref={prizeImportInputRef}
                          type="file"
                          accept=".csv,text/csv"
                          className="hidden"
                          onChange={handlePrizeImport}
                        />
                        <Button onClick={addPrize}>
                          Add prize
                        </Button>
                      </div>
                    )}
                  </div>

                  {config.prizesEnabled && (
                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      <table className="min-w-full divide-y divide-slate-200 bg-white">
                        <thead className="bg-slate-50">
                          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                            <th className="px-4 py-3">Section</th>
                            <th className="px-4 py-3">Rating cap (U)</th>
                            <th className="px-4 py-3">Place</th>
                            <th className="px-4 py-3">Prize amount</th>
                            <th className="px-4 py-3">Currency</th>
                            <th className="px-4 py-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
                          {prizes.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">
                                {sections.length === 0
                                  ? "Create sections before defining prizes."
                                  : "No prizes added yet. Select Add prize to create your first payout."}
                              </td>
                            </tr>
                          ) : (
                            prizes.map((prize) => {
                              const activeSection =
                                sections.find((section) => section.id === prize.sectionId) ??
                                sections.find(
                                  (section) =>
                                    section.name.trim().toLowerCase() === (prize.section ?? "").trim().toLowerCase(),
                                );
                              return (
                                <tr key={prize.id} className="align-top">
                                  <td className="px-4 py-3">
                                    <Select
                                      value={activeSection?.id ?? prize.sectionId ?? ""}
                                      onValueChange={(value) => updatePrize(prize.id, { sectionId: value })}
                                    >
                                      <SelectTrigger>
                                        <SelectValue placeholder="Select section" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {sections.map((section) => (
                                          <SelectItem key={section.id} value={section.id}>
                                            {section.name || "Unnamed section"}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <p className="mt-1 text-[11px] text-slate-500">
                                      {prize.section || "Choose a section"}
                                    </p>
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm text-slate-500">U</span>
                                      <Input
                                        type="number"
                                        value={prize.ratingCap ?? ""}
                                        onChange={(event) => handlePrizeRatingCapChange(prize.id, event.target.value)}
                                        placeholder="e.g., 1600"
                                      />
                                    </div>
                                    <p className="mt-1 text-[11px] text-slate-500">
                                      {prize.ratingCap === null
                                        ? "Open to all ratings"
                                        : `Players rated under ${prize.ratingCap}`}
                                    </p>
                                  </td>
                                  <td className="px-4 py-3">
                                    <Input
                                      value={prize.place ?? ""}
                                      onChange={(event) => handlePrizePlaceChange(prize.id, event.target.value)}
                                      placeholder="e.g., 1st"
                                    />
                                    <p className="mt-1 text-[11px] text-slate-500">Label how this prize is awarded.</p>
                                  </td>
                                  <td className="px-4 py-3">
                                    <Input
                                      type="number"
                                      step="0.01"
                                      value={typeof prize.amount === "number" ? String(prize.amount) : ""}
                                      onChange={(event) => handlePrizeAmountChange(prize.id, event.target.value)}
                                      placeholder="Amount"
                                    />
                                  </td>
                                  <td className="px-4 py-3">
                                    <Select
                                      value={prize.currency || config.payments.defaultCurrency || "USD"}
                                      onValueChange={(value) => handlePrizeCurrencyChange(prize.id, value)}
                                    >
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {ENTRY_FEE_CURRENCY_OPTIONS.map((option) => (
                                          <SelectItem key={option} value={option}>
                                            {option}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <Button variant="ghost" className="text-red-600" onClick={() => removePrize(prize.id)}>
                                      Remove
                                    </Button>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {config.prizesEnabled && (
                    <p className="text-xs text-slate-500">
                      Export your Google Sheet as CSV with columns: Section, Rating, Place, Amount, Currency.
                    </p>
                  )}

                {renderTabSaveButton()}
              </TabsContent>

              <TabsContent value="playerSignup" className="bg-white p-6 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                    <div>
                      <Label className="text-sm font-medium">Email notifications</Label>
                      <p className="text-xs text-muted-foreground">Send pairing updates by email to registered players.</p>
                    </div>
                    <Switch
                      checked={config.registers.notifyPairingsEmail}
                      onCheckedChange={(checked) => updateRegisters({ notifyPairingsEmail: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                    <div>
                      <Label className="text-sm font-medium">SMS notifications</Label>
                      <p className="text-xs text-muted-foreground">Deliver pairing texts when players opt in.</p>
                    </div>
                    <Switch
                      checked={config.registers.notifyPairingsSms}
                      onCheckedChange={(checked) => updateRegisters({ notifyPairingsSms: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                    <div>
                      <Label className="text-sm font-medium">Disable SMS notifications</Label>
                      <p className="text-xs text-muted-foreground">Turn off tournament-wide SMS messaging.</p>
                    </div>
                    <Switch
                      checked={config.registers.disableSms}
                      onCheckedChange={(checked) => updateRegisters({ disableSms: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                    <div>
                      <Label className="text-sm font-medium">Hide Teams / School / Grade</Label>
                      <p className="text-xs text-muted-foreground">Remove optional fields from the registration form.</p>
                    </div>
                    <Switch
                      checked={config.registers.hideTeams}
                      onCheckedChange={(checked) => updateRegisters({ hideTeams: checked })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="player-limit">Player cap</Label>
                  <Input
                    id="player-limit"
                    type="number"
                    min={0}
                    value={typeof config.registers.playerLimit === "number" ? String(config.registers.playerLimit) : ""}
                    onChange={(event) => {
                      const raw = event.target.value;
                      const trimmed = raw.trim();
                      if (trimmed.length === 0) {
                        updateRegisters({ playerLimit: null });
                        return;
                      }

                      const parsed = Number(trimmed);
                      updateRegisters({ playerLimit: Number.isFinite(parsed) ? parsed : config.registers.playerLimit ?? null });
                    }}
                    placeholder="Leave blank for no limit"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bye-limit">Bye limit</Label>
                  <Input
                    id="bye-limit"
                    type="number"
                    min={0}
                    value={typeof config.registers.byeLimit === "number" ? String(config.registers.byeLimit) : ""}
                    onChange={(event) => {
                      const raw = event.target.value;
                      const trimmed = raw.trim();
                      if (trimmed.length === 0) {
                        updateRegisters({ byeLimit: null });
                        return;
                      }

                      const parsed = Number(trimmed);
                      updateRegisters({ byeLimit: Number.isFinite(parsed) ? parsed : config.registers.byeLimit ?? null });
                    }}
                    placeholder="Maximum half-point byes allowed"
                  />
                </div>

                {renderTabSaveButton()}
              </TabsContent>

              <TabsContent value="rate-tournament" className="bg-white p-6 space-y-4">
                <div className="space-y-2">
                  {config.registers.fideRated && (
                    <Button
                      variant="outline"
                      onClick={() => handleShortcutChange("fide")}
                      disabled={!tournament}
                    >
                      FIDE Registration
                    </Button>
                  )}
                  {config.registers.uscfRated && (
                    <Button
                      variant="outline"
                      onClick={() => handleShortcutChange("uscf")}
                      disabled={!tournament}
                    >
                      USCF Report
                    </Button>
                  )}
                </div>
                {!config.registers.fideRated && !config.registers.uscfRated && (
                  <p className="text-sm text-muted-foreground">
                    This tournament is not set to be rated by any federation.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="options" className="bg-white p-6 space-y-4">
                <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Scoring rules</h3>
                      <p className="text-xs text-slate-600">Customize how many points players earn for each result.</p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={resetScoring}>
                      Reset to defaults
                    </Button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <ScoreInput
                      id="score-win"
                      label="Win"
                      value={scoring.win}
                      onChange={(value) => handleScoreChange("win", value)}
                    />
                    <ScoreInput
                      id="score-draw"
                      label="Draw"
                      value={scoring.draw}
                      onChange={(value) => handleScoreChange("draw", value)}
                    />
                    <ScoreInput
                      id="score-loss"
                      label="Loss"
                      value={scoring.loss}
                      onChange={(value) => handleScoreChange("loss", value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Tiebreak System</Label>
                  <Select
                    value={config.details.tiebreakSystem}
                    onValueChange={(value) => updateDetails({ tiebreakSystem: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIEBREAK_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Tiebreak ordering</h3>
                      <p className="text-xs text-slate-600">Enable and arrange the rules used to break tied scores.</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <span>{config.details.tiebreaksEnabled ? "Enabled" : "Disabled"}</span>
                      <Switch checked={config.details.tiebreaksEnabled} onCheckedChange={toggleTiebreaks} />
                    </div>
                  </div>
                  {config.details.tiebreaksEnabled ? (
                    <>
                      <datalist id="tiebreak-option-list">
                        {TIEBREAK_OPTIONS.map((option) => (
                          <option key={option.value} value={option.label} />
                        ))}
                      </datalist>
                      {tiebreaks.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-xs text-slate-500">
                          No tiebreak rules yet. Add one to start ordering tied results.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {tiebreaks.map((method, index) => (
                            <TiebreakRow
                              key={`${method}-${index}`}
                              index={index}
                              total={tiebreaks.length}
                              value={method}
                              onChange={(value) => updateTiebreakRule(index, value)}
                              onRemove={() => removeTiebreakRule(index)}
                              onMoveUp={() => moveTiebreakRule(index, -1)}
                              onMoveDown={() => moveTiebreakRule(index, 1)}
                            />
                          ))}
                        </div>
                      )}
                      <Button type="button" variant="outline" size="sm" onClick={addTiebreakRule}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add tiebreak rule
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">Enable tiebreaks to configure their order.</p>
                  )}
                </div>
                <div className="space-y-4">

                                <div className="flex items-center justify-between rounded-lg border px-4 py-3">

                                  <div>

                                    <Label className="text-sm font-medium">Enable Pairing Predictor</Label>

                                    <p className="text-xs text-muted-foreground">Allow players to simulate upcoming pairings.</p>

                                  </div>

                                  <Switch

                                    checked={config.registers.enablePairingPredictor}

                                    onCheckedChange={(checked) => updateRegisters({ enablePairingPredictor: checked })}

                                  />

                                </div>

                                <div className="flex items-center justify-between rounded-lg border px-4 py-3">

                                  <div>

                                    <Label className="text-sm font-medium">Show on Calendar</Label>

                                    <p className="text-xs text-muted-foreground">Publish this event on the public calendar.</p>

                                  </div>

                                  <Switch

                                    checked={config.registers.showOnCalendar}

                                    onCheckedChange={(checked) => updateRegisters({ showOnCalendar: checked })}

                                  />

                                </div>

                                                <div className="space-y-2">

                                                  <Label>Spectator Link</Label>

                                                  <div className="flex items-center gap-2">

                                                    <Input

                                                      readOnly

                                                      value={`${window.location.origin}/tournaments/${tournamentId}`}

                                                    />

                                                                                            <Button

                                                                                              variant="outline"

                                                                                              size="sm"

                                                                                              onClick={() => setQrCodeModalOpen(true)}

                                                                                            >

                                                                                              Show QR Code

                                                                                            </Button>

                                                                                                                <Button

                                                                                                                  variant="outline"

                                                                                                                  size="sm"

                                                                                                                  onClick={handleSpectatorLinkPrint}

                                                                                                                >

                                                                                                                  Print

                                                                                                                </Button>

                                                                                            

                                                  </div>

                                                  <p className="text-xs text-muted-foreground">

                                                    Share this link to allow others to spectate the event.

                                                  </p>

                                                  <div className="flex flex-col gap-3 pt-2">
                                                    <div className="flex items-center space-x-2">
                                                      <Switch
                                                        id="allow-player-to-join"
                                                        checked={config.registers.allowPlayerToJoin}
                                                        onCheckedChange={(checked) =>
                                                          updateRegisters({ allowPlayerToJoin: checked })
                                                        }
                                                      />
                                                      <Label htmlFor="allow-player-to-join">
                                                        Allow Players to Join
                                                      </Label>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">
                                                      If enabled, players can complete the registration form; otherwise, they can just spectate.
                                                    </p>

                                                    <div className="flex items-center space-x-2">
                                                      <Switch
                                                        id="allow-multi-player-signup"
                                                        checked={config.registers.allowMultiPlayerSignup}
                                                        onCheckedChange={(checked) =>
                                                          updateRegisters({ allowMultiPlayerSignup: checked })
                                                        }
                                                      />
                                                      <Label htmlFor="allow-multi-player-signup">
                                                        Allow Multi-Player Sign Up
                                                      </Label>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">
                                                      When enabled, a single account can register multiple players for this event.
                                                    </p>
                                                  </div>

                                                </div>

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

                              </div>

                              {renderTabSaveButton()}

                            </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        
      </div>

      {onCancel && (
        <div className="flex justify-start">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>

      <Dialog open={paymentsDialogOpen} onOpenChange={handlePaymentSettingsDialogChange}>
    <DialogContent className="w-full max-w-3xl sm:max-w-4xl [&>button.absolute]:hidden">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full border border-slate-200">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
          <div className="flex-1">
            <DialogHeader className="items-start text-left">
              <DialogTitle className="text-xl">Payment settings</DialogTitle>
              <DialogDescription>
                Manage currencies, online checkout requirements, and offline payment instructions.
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/80 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Online payments</p>
                <p className="text-xs text-slate-600">
                  Enable Stripe-powered checkout inside the player registration flow.
                </p>
              </div>
              <Switch
                checked={paymentSettingsDraft.onlineEnabled}
                onCheckedChange={(checked) => updatePaymentDraft("onlineEnabled", checked)}
              />
            </div>
            {!paymentSettingsDraft.onlineEnabled && (
              <p className="mt-3 text-xs text-indigo-700">
                Players will acknowledge offline payment instructions during registration. Toggle this on once your Stripe API keys are active.
              </p>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dialog-payment-currency">Default currency</Label>
              <Select
                value={paymentSettingsDraft.defaultCurrency ?? "USD"}
                onValueChange={(value) => updatePaymentDraft("defaultCurrency", value)}
              >
                <SelectTrigger id="dialog-payment-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTRY_FEE_CURRENCY_OPTIONS.map((currency) => (
                    <SelectItem key={currency} value={currency}>
                      {currency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dialog-payment-descriptor">Statement descriptor (optional)</Label>
              <Input
                id="dialog-payment-descriptor"
                value={paymentSettingsDraft.payoutStatementDescriptor ?? ""}
                onChange={(event) => updatePaymentDraft("payoutStatementDescriptor", event.target.value)}
                placeholder="e.g., SD CHESS CLUB"
              />
            </div>

            {paymentSettingsDraft.onlineEnabled && (
              <>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    Require payment on registration
                    <Badge variant="outline" className="text-xs">
                      Recommended
                    </Badge>
                  </Label>
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs text-slate-600 pr-6">
                      Players must complete Stripe checkout before their registration is submitted.
                    </p>
                    <Switch
                      checked={paymentSettingsDraft.requirePaymentOnRegistration}
                      onCheckedChange={(checked) => updatePaymentDraft("requirePaymentOnRegistration", checked)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Processing contribution</Label>
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs text-slate-600 pr-6">
                      Allow players to add an optional amount to help cover Stripe fees.
                    </p>
                    <Switch
                      checked={paymentSettingsDraft.allowProcessingContribution}
                      onCheckedChange={(checked) => updatePaymentDraft("allowProcessingContribution", checked)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dialog-processing-fee">Processing fee (%)</Label>
                  <Input
                    id="dialog-processing-fee"
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    value={
                      typeof paymentSettingsDraft.processingFeePercent === "number"
                        ? String(paymentSettingsDraft.processingFeePercent)
                        : ""
                    }
                    onChange={(event) => handleProcessingFeeChange(event.target.value)}
                    placeholder="0"
                  />
                  <p className="text-xs text-muted-foreground">
                    Applied on top of the entry fee total when the checkout session is created.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dialog-stripe-account">Stripe Connect account (optional)</Label>
                  <Input
                    id="dialog-stripe-account"
                    value={paymentSettingsDraft.stripeAccountId ?? ""}
                    onChange={(event) => updatePaymentDraft("stripeAccountId", event.target.value)}
                    placeholder="acct_1234"
                  />
                  <p className="text-xs text-muted-foreground">
                    Provide a connected account ID if payouts route to a tournament sub-account.
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label>Accepted offline payment methods</Label>
            <div className="flex flex-wrap gap-2">
              {OFFLINE_METHOD_OPTIONS.map((option) => {
                const active = paymentSettingsDraft.acceptedOfflineMethods?.includes(option.id) ?? false;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => toggleOfflineMethod(option.id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition",
                      active
                        ? "border-indigo-500 bg-indigo-500 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              These options display on the review step so players know how to pay if they skip online checkout.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dialog-offline-instructions">Offline payment instructions</Label>
            <Textarea
              id="dialog-offline-instructions"
              rows={4}
              value={paymentSettingsDraft.offlineInstructions ?? ""}
              onChange={(event) => updatePaymentDraft("offlineInstructions", event.target.value)}
              placeholder="Include on-site payment windows, who to Venmo, or mailing addresses for checks."
            />
          </div>
        </div>

        <DialogFooter className="border-t border-slate-200 pt-4">
          <Button className="ml-auto" onClick={handlePaymentSettingsSave}>
            Save & Close
          </Button>
        </DialogFooter>
      </div>
    </DialogContent>
      </Dialog>
      <Dialog open={qrCodeModalOpen} onOpenChange={setQrCodeModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Spectator QR Code</DialogTitle>
            <DialogDescription>
              Scan this QR code to spectate the tournament.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center p-4">

          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TournamentBuilder({ mode, format: initialFormat, tournament, onCancel, onComplete }: TournamentBuilderProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [format, setFormat] = useState<Tournament["format"]>(tournament?.format ?? initialFormat);
  const [config, setConfig] = useState<TournamentConfig>(() =>
    tournament ? parseTournamentConfig(tournament) : createDefaultConfig(initialFormat)
  );
  const [step, setStep] = useState(tournament ? 2 : 1);

  const handleFormatChange = (nextFormat: Tournament["format"]) => {
    setFormat(nextFormat);
    setConfig((prev) => {
      const defaultConfig = createDefaultConfig(nextFormat, prev.mode ?? "rated");
      return {
        ...prev,
        format: nextFormat,
        details: {
          ...prev.details,
          rounds: defaultConfig.details.rounds,
          pairingSystem: defaultConfig.details.pairingSystem,
        },
        schedule: createDefaultSchedule(defaultConfig.details.rounds),
      };
    });
  };

  const handleModeChange = (nextMode: TournamentMode) => {
    setConfig((prev) => {
      const registers = { ...prev.registers };

      if (nextMode === "online") {
        registers.allowSignup = true;
        registers.fideRated = false;
        registers.uscfRated = false;
      } else if (nextMode === "unrated") {
        registers.fideRated = false;
        registers.uscfRated = false;
      } else if (nextMode === "rated") {
        registers.fideRated = true;
        registers.uscfRated = true;
      }

      return {
        ...prev,
        mode: nextMode,
        registers,
      };
    });
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = buildTournamentPayload(config, { format });
      payload.roundTimings = serializeTournamentConfig({ ...config, format });
      if (mode === "create") {
        (payload as any).status = "draft";
        return apiRequest("/api/tournaments", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      if (!tournament) throw new Error("Tournament missing");
      (payload as any).status = tournament.status;
      return apiRequest(`/api/tournaments/${tournament.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (createdTournament) => {
      const targetId = (createdTournament as Tournament | undefined)?.id ?? tournament?.id;
      if (targetId) {
        queryClient.invalidateQueries({ queryKey: ["tournament-payments-config", targetId] });
        queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${targetId}`] });
      }
      if (createdTournament && typeof createdTournament === "object") {
        try {
          const nextConfig = parseTournamentConfig(createdTournament as Tournament);
          setConfig(nextConfig);
        } catch (error) {
          console.warn("Failed to parse updated tournament config", error);
        }
      }
      toast({ title: mode === "create" ? "Tournament created" : "Tournament updated" });
      onComplete?.(createdTournament);
    },
    onError: (error: any) => {
      toast({
        title: "Unable to save tournament",
        description: error?.message ?? "Please verify form fields and try again.",
        variant: "destructive",
      });
    },
  });

  return step === 1 ? (
    <StepOne
      format={format}
      mode={config.mode}
      builderMode={mode}
      config={config}
      onFormatChange={handleFormatChange}
      onModeChange={handleModeChange}
      onConfigChange={(nextConfig) => setConfig(nextConfig)}
      onContinue={() => {
        if (mode === "create") {
          if (!mutation.isPending) {
            mutation.mutate();
          }
        } else {
          setStep(2);
        }
      }}
      onCancel={onCancel}
      isProcessing={mutation.isPending}
      continueLabel={mode === "create" ? "Create tournament" : "Continue"}
      processingLabel={mode === "create" ? "Creating..." : "Processing..."}
    />
  ) : (
    <StepTwo
      format={format}
      mode={config.mode}
      config={config}
      onConfigChange={(nextConfig) => setConfig(nextConfig)}
      onBack={() => setStep(1)}
      onCancel={onCancel}
      onSave={() => mutation.mutate()}
      saving={mutation.isPending}
      tournament={tournament}
    />
  );
}

interface ScoreInputProps {
  id: string;
  label: string;
  value: number;
  onChange: (value: string) => void;
}

function ScoreInput({ id, label, value, onChange }: ScoreInputProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={-1}
        max={10}
        step="0.25"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

interface TiebreakRowProps {
  index: number;
  total: number;
  value: string;
  onChange: (value: string) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function TiebreakRow({ index, total, value, onChange, onRemove, onMoveUp, onMoveDown }: TiebreakRowProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <span className="w-6 text-center text-xs font-semibold text-slate-500">{index + 1}</span>
      <Input
        className="flex-1"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="e.g., Buchholz"
        list="tiebreak-option-list"
      />
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Move up"
          disabled={index === 0}
          onClick={onMoveUp}
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Move down"
          disabled={index === total - 1}
          onClick={onMoveDown}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Remove"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function formatRatingRange(min: number | null, max: number | null): string {
  if (min !== null && max !== null) {
    return `Rating ${min}–${max}`;
  }
  if (min !== null) {
    return `Rating ${min}+`;
  }
  if (max !== null) {
    return `Rating ≤${max}`;
  }
  return "Open to all ratings";
}

function createSectionDefinition(): SectionDefinition {
  return {
    id: generateSectionId(),
    name: "",
    ratingMin: null,
    ratingMax: null,
    description: undefined,
  };
}

function createEntryFeeRow(section?: SectionDefinition, defaultCurrency = "USD"): EntryFeeRule {
  return {
    id: generateEntryFeeId(),
    sectionId: section?.id,
    section: section?.name ?? "",
    ratingMin: null,
    ratingMax: null,
    amount: 0,
    currency: defaultCurrency,
    effectiveAfter: null,
  };
}

function createPrizeRow(section?: SectionDefinition, defaultCurrency = "USD"): PrizeRule {
  return {
    id: generatePrizeId(),
    sectionId: section?.id,
    section: section?.name ?? "",
    ratingCap: section?.ratingMax ?? null,
    place: "",
    amount: 0,
    currency: defaultCurrency,
  };
}

function generateEntryFeeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `fee-${Math.random().toString(36).slice(2, 10)}`;
}

function generatePrizeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `prize-${Math.random().toString(36).slice(2, 10)}`;
}

function generateSectionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `section-${Math.random().toString(36).slice(2, 10)}`;
}

export default TournamentBuilder;