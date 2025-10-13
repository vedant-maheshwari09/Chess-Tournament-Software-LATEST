import React, { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Upload, Check, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import type { Tournament } from "@shared/schema";
import {
  TournamentConfig,
  TournamentMode,
  type EntryFeeRule,
  type SectionDefinition,
  type OfflinePaymentMethod,
  TimeControlDefinition,
  TimeAddonType,
  TimeControlType,
  buildTournamentPayload,
  createDefaultConfig,
  parseTournamentConfig,
  serializeTournamentConfig,
  createDefaultSchedule,
  ScheduleEvent,
  SCHEDULE_EVENT_OPTIONS,
} from "@/lib/tournament-config";

type BuilderMode = "create" | "edit";
type SettingsShortcutTab = "registers" | "fide" | "uscf" | "chess-results";

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
];

const MODE_OPTIONS: Array<{ id: TournamentMode; label: string; description: string }> = [
  {
    id: "online",
    label: "Online Event",
    description: "Optimized for virtual tournaments with quick registration links and remote play workflows.",
  },
  {
    id: "unrated",
    label: "Unrated Event",
    description: "Local or casual events without federation reporting requirements.",
  },
  {
    id: "rated",
    label: "Rated Event",
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


interface BasicInformationFieldsProps {
  config: TournamentConfig;
  onConfigChange: (config: TournamentConfig) => void;
}

function BasicInformationFields({ config, onConfigChange }: BasicInformationFieldsProps) {
  const updateBasic = (updates: Partial<TournamentConfig["basic"]>) => {
    onConfigChange({
      ...config,
      basic: { ...config.basic, ...updates },
    });
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
          <Label htmlFor="basic-location">Location / Venue</Label>
          <Input
            id="basic-location"
            value={config.basic.city}
            onChange={(event) => updateBasic({ city: event.target.value })}
            placeholder="e.g., San Diego Convention Center"
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
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Start Date</Label>
          <Input
            type="date"
            value={config.basic.startDate ?? ""}
            onChange={(event) => updateBasic({ startDate: event.target.value || null })}
          />
        </div>
        <div className="space-y-2">
          <Label>End Date</Label>
          <Input
            type="date"
            value={config.basic.endDate ?? ""}
            onChange={(event) => updateBasic({ endDate: event.target.value || null })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea
          rows={4}
          value={config.basic.description}
          onChange={(event) => updateBasic({ description: event.target.value })}
          placeholder="Add venue notes, parking details, or livestream information"
        />
      </div>
    </div>
  );
}

interface StepOneProps {
  format: Tournament["format"];
  mode: TournamentMode;
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

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await fileToText(file);
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid file format");
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
    }
  };

  const handleContinue = () => {
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
          <div className="grid gap-4 md:grid-cols-3">
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
          <BasicInformationFields config={config} onConfigChange={onConfigChange} />
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
          <Button onClick={handleContinue} disabled={isProcessing}>
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

function StepTwo({ format, mode, config, onConfigChange, onBack: _onBack, onCancel, onSave, saving, tournament }: StepTwoProps) {
  const scheduleTemplateOptions = SCHEDULE_EVENT_OPTIONS;
  const { toast } = useToast();
  const sections = config.sections ?? [];
  const updateDetails = (updates: Partial<TournamentConfig["details"]>) =>
    onConfigChange({ ...config, details: { ...config.details, ...updates } });

  const updateRegisters = (updates: Partial<TournamentConfig["registers"]>) =>
    onConfigChange({ ...config, registers: { ...config.registers, ...updates } });

  const updatePayments = (updates: Partial<TournamentConfig["payments"]>) =>
    onConfigChange({ ...config, payments: { ...config.payments, ...updates } });

  const addSection = () => {
    const nextSection = createSectionDefinition();
    onConfigChange({
      ...config,
      sections: [...sections, nextSection],
    });
  };

  const updateSection = (id: string, updates: Partial<SectionDefinition>) => {
    const nextSections = sections.map((section) => (section.id === id ? { ...section, ...updates } : section));
    let nextEntryFees = config.entryFees;
    if (updates.name !== undefined || updates.ratingMin !== undefined || updates.ratingMax !== undefined) {
      const target = nextSections.find((section) => section.id === id);
      if (target) {
        nextEntryFees = nextEntryFees.map((fee) =>
          fee.sectionId === id
            ? {
                ...fee,
                section: target.name,
                ratingMin: target.ratingMin,
                ratingMax: target.ratingMax,
              }
            : fee,
        );
      }
    }
    onConfigChange({
      ...config,
      sections: nextSections,
      entryFees: nextEntryFees,
    });
  };

  const removeSection = (id: string) => {
    const nextSections = sections.filter((section) => section.id !== id);
    const nextEntryFees = config.entryFees.filter((fee) => fee.sectionId !== id);
    onConfigChange({
      ...config,
      sections: nextSections,
      entryFees: nextEntryFees,
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
    const usedSectionIds = new Set(
      config.entryFees
        .map((fee) => fee.sectionId)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    );
    const availableSections = sections.filter((section) => !usedSectionIds.has(section.id));
    if (availableSections.length === 0) {
      toast({
        title: "All sections priced",
        description: "Edit an existing price or add another section to create more entry fees.",
      });
      return;
    }
    const targetSection = availableSections[0];
    onConfigChange({
      ...config,
      entryFees: [
        ...config.entryFees,
        createEntryFeeRow(targetSection, config.payments.defaultCurrency ?? "USD"),
      ],
    });
  };

  const updateEntryFee = (id: string, updates: Partial<EntryFeeRule>) => {
    const nextEntryFees = config.entryFees.map((fee) => {
      if (fee.id !== id) return fee;
      let nextFee: EntryFeeRule = { ...fee, ...updates };
      if (updates.sectionId) {
        const linked = sections.find((section) => section.id === updates.sectionId);
        if (linked) {
          nextFee = {
            ...nextFee,
            sectionId: linked.id,
            section: linked.name,
            ratingMin: linked.ratingMin,
            ratingMax: linked.ratingMax,
          };
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

  const entryFees = config.entryFees ?? [];
  const unpricedSections = sections.filter(
    (section) => !entryFees.some((fee) => fee.sectionId === section.id),
  );
  const canAddEntryFee = sections.length > 0 && unpricedSections.length > 0;

  const [, setLocation] = useLocation();
  const [settingsShortcut, setSettingsShortcut] = useState<SettingsShortcutTab>("registers");

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
    onConfigChange({
      ...config,
      details: { ...config.details, rounds: nextRounds },
      schedule: ensureRoundSchedule(config.schedule, nextRounds),
    });
  };

  const fideEnabled = config.registers.fideRated;
  const uscfEnabled = config.registers.uscfRated;
  const shortcutOptions: Array<{ id: SettingsShortcutTab; label: string; visible: boolean; disabled: boolean }> = [
    { id: "registers", label: "Registers", visible: true, disabled: false },
    { id: "fide", label: "FIDE", visible: true, disabled: !fideEnabled || !tournament },
    { id: "uscf", label: "USCF", visible: true, disabled: !uscfEnabled || !tournament },
    { id: "chess-results", label: "Chess-Results", visible: true, disabled: !tournament },
  ];

  const registerControls: Array<{
    key: keyof TournamentConfig["registers"];
    label: string;
    description?: string;
  }> = [
    {
      key: "showOnCalendar",
      label: "Show on Calendar",
      description: "Publish this event on the public calendar.",
    },
    {
      key: "allowSignup",
      label: "Allow Online Registration",
      description: "Players can sign up directly from the portal.",
    },
    {
      key: "fideRated",
      label: "FIDE Rated Tournament",
      description: "Toggle to unlock the Data for FIDE page.",
    },
    {
      key: "uscfRated",
      label: "USCF Rated Tournament",
      description: "Toggle to unlock the Data for USCF page.",
    },
  ];

  const handleShortcutChange = (next: SettingsShortcutTab) => {
    if (next === "registers") {
      setSettingsShortcut("registers");
      return;
    }
    if (!tournament) {
      setSettingsShortcut("registers");
      return;
    }

    const target = `/tournaments/${tournament.id}/settings/${next}`;
    setSettingsShortcut("registers");
    setLocation(target);
  };

  const renderTabSaveButton = () => (
    <div className="flex justify-end pt-4">
      <Button onClick={onSave} disabled={saving}>
        {saving ? "Saving..." : "Save"}
      </Button>
    </div>
  );

  return (
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

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="basic">Basic information</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="schedule">Schedule</TabsTrigger>
              <TabsTrigger value="payments">Payments</TabsTrigger>
                <TabsTrigger value="playerSignup">Player sign up</TabsTrigger>
              </TabsList>
              <TabsContent value="basic" className="bg-white p-6 space-y-4">
                <BasicInformationFields config={config} onConfigChange={onConfigChange} />
                {renderTabSaveButton()}
              </TabsContent>

              <TabsContent value="details" className="bg-white p-6 space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Chief Arbiter</Label>
                    <Input
                      value={config.details.chiefArbiter}
                      onChange={(event) => updateDetails({ chiefArbiter: event.target.value })}
                    />
                  </div>
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
                  <Button variant="outline" onClick={addScheduleRow}>
                    Add Event
                  </Button>
                </div>

                <div className="space-y-3">
                  {config.schedule.map((event) => (
                    <div
                      key={event.id}
                      className="grid gap-3 md:grid-cols-[150px,150px,200px,1fr,auto] items-center border rounded-lg p-3"
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
                        value={scheduleTemplateOptions.includes(event.label) ? event.label : "custom"}
                        onValueChange={(value) => {
                          if (value === "custom") return;
                          updateScheduleRow(event.id, { label: value });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select template" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="custom">Custom label</SelectItem>
                          {scheduleTemplateOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={event.label}
                        onChange={(e) => updateScheduleRow(event.id, { label: e.target.value })}
                        placeholder="Event label"
                      />
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
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/80 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Online payments</p>
                      <p className="text-xs text-slate-600">
                        Enable Stripe-powered checkout inside the player registration flow.
                      </p>
                    </div>
                    <Switch
                      checked={config.payments.onlineEnabled}
                      onCheckedChange={(checked) => updatePayments({ onlineEnabled: checked })}
                    />
                  </div>
                  {!config.payments.onlineEnabled && (
                    <p className="mt-3 text-xs text-indigo-700">
                      Players will acknowledge offline payment instructions during registration. Toggle this on once your Stripe API keys are active.
                    </p>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="payment-currency">Default currency</Label>
                    <Select
                      value={config.payments.defaultCurrency ?? "USD"}
                      onValueChange={(value) => updatePayments({ defaultCurrency: value })}
                    >
                      <SelectTrigger id="payment-currency">
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
                    <Label htmlFor="payment-descriptor">Statement descriptor (optional)</Label>
                    <Input
                      id="payment-descriptor"
                      value={config.payments.payoutStatementDescriptor ?? ""}
                      onChange={(event) => updatePayments({ payoutStatementDescriptor: event.target.value })}
                      placeholder="e.g., SD CHESS CLUB"
                    />
                  </div>

                  {config.payments.onlineEnabled && (
                    <>
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                          Require payment on registration
                          <Badge variant="outline" className="text-xs">Recommended</Badge>
                        </Label>
                        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
                          <p className="text-xs text-slate-600 pr-6">
                            Players must complete Stripe checkout before their registration is submitted.
                          </p>
                          <Switch
                            checked={config.payments.requirePaymentOnRegistration}
                            onCheckedChange={(checked) => updatePayments({ requirePaymentOnRegistration: checked })}
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
                            checked={config.payments.allowProcessingContribution}
                            onCheckedChange={(checked) => updatePayments({ allowProcessingContribution: checked })}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="processing-fee">Processing fee (%)</Label>
                        <Input
                          id="processing-fee"
                          type="number"
                          min={0}
                          max={10}
                          step={0.1}
                          value={
                            typeof config.payments.processingFeePercent === "number"
                              ? String(config.payments.processingFeePercent)
                              : ""
                          }
                          onChange={(event) => {
                            const raw = event.target.value;
                            const trimmed = raw.trim();
                            if (!trimmed) {
                              updatePayments({ processingFeePercent: null });
                              return;
                            }
                            const numeric = Number(trimmed);
                            if (Number.isFinite(numeric)) {
                              const clamped = Math.max(0, Math.min(10, Number(numeric.toFixed(2))));
                              updatePayments({ processingFeePercent: clamped });
                            }
                          }}
                          placeholder="0"
                        />
                        <p className="text-xs text-muted-foreground">
                          Applied on top of the entry fee total when the checkout session is created.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="stripe-account">Stripe Connect account (optional)</Label>
                        <Input
                          id="stripe-account"
                          value={config.payments.stripeAccountId ?? ""}
                          onChange={(event) => updatePayments({ stripeAccountId: event.target.value })}
                          placeholder="acct_1234"
                        />
                        <p className="text-xs text-muted-foreground">
                          Provide a connected account ID if payouts route to a tournament sub-account.
                        </p>
                      </div>
                    </>
                  )}
                </div>

                <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Section pricing</h3>
                      <p className="text-xs text-slate-600">
                        Assign a required entry fee to each section. Players will see these prices during registration.
                      </p>
                    </div>
                    <Button variant="outline" onClick={addEntryFee} disabled={!canAddEntryFee}>
                      Add pricing
                    </Button>
                  </div>

                  {sections.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-600">
                      Create sections under the Details tab before configuring pricing.
                    </div>
                  ) : entryFees.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-600">
                      No pricing configured yet. Add a pricing row for each section to open registration.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {entryFees.map((fee) => {
                        const activeSection =
                          sections.find((section) => section.id === fee.sectionId) ??
                          sections.find(
                            (section) =>
                              section.name.trim().toLowerCase() === (fee.section ?? "").trim().toLowerCase(),
                          );
                        const otherUsedSectionIds = new Set(
                          entryFees
                            .filter((other) => other.id !== fee.id)
                            .map((other) => other.sectionId)
                            .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
                        );
                        const ratingLabel = activeSection
                          ? `Rating ${activeSection.ratingMin ?? "Unrated"} – ${activeSection.ratingMax ?? "Open"}`
                          : "Select a section to inherit its rating range.";

                        return (
                          <div key={fee.id} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
                            <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                              <div>
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
                                      <SelectItem
                                        key={section.id}
                                        value={section.id}
                                        disabled={otherUsedSectionIds.has(section.id)}
                                      >
                                        {section.name || "Unnamed section"}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <p className="mt-1 text-[11px] text-slate-500">{ratingLabel}</p>
                              </div>
                              <div>
                                <Label className="text-xs font-semibold uppercase text-slate-500">Amount</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={typeof fee.amount === "number" ? String(fee.amount) : ""}
                                  onChange={(event) => handleEntryFeeAmountChange(fee.id, event.target.value)}
                                  placeholder="e.g., 120"
                                />
                              </div>
                              <div>
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
                            <div>
                              <Label className="text-xs font-semibold uppercase text-slate-500">Notes (optional)</Label>
                              <Input
                                value={fee.notes ?? ""}
                                onChange={(event) => updateEntryFee(fee.id, { notes: event.target.value })}
                                placeholder="e.g., Early bird until Oct 1"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {sections.length > 0 && unpricedSections.length > 0 && (
                    <div className="rounded-lg border border-dashed border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                      {unpricedSections.length === 1
                        ? `${unpricedSections[0].name || "Unnamed section"} still needs a price.`
                        : `The following sections still need pricing: ${unpricedSections
                            .map((section) => section.name || "Unnamed section")
                            .join(", ")}.`}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Accepted offline payment methods</Label>
                  <div className="flex flex-wrap gap-2">
                    {OFFLINE_METHOD_OPTIONS.map((option) => {
                      const active = config.payments.acceptedOfflineMethods?.includes(option.id) ?? false;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            const current = config.payments.acceptedOfflineMethods ?? [];
                            const next = active
                              ? current.filter((method) => method !== option.id)
                              : [...current, option.id];
                            updatePayments({ acceptedOfflineMethods: next });
                          }}
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
                  <Label htmlFor="offline-instructions">Offline payment instructions</Label>
                  <Textarea
                    id="offline-instructions"
                    rows={4}
                    value={config.payments.offlineInstructions ?? ""}
                    onChange={(event) => updatePayments({ offlineInstructions: event.target.value })}
                    placeholder="Include on-site payment windows, who to Venmo, or mailing addresses for checks."
                  />
                </div>

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

                <div className="space-y-2">
                  <Label htmlFor="early-bird">Early bird entry details</Label>
                  <Textarea
                    id="early-bird"
                    rows={3}
                    value={config.registers.earlyBirdDetails ?? ""}
                    onChange={(event) => updateRegisters({ earlyBirdDetails: event.target.value })}
                    placeholder="Outline pricing deadlines or incentives for early registration."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="payment-info">Payment information</Label>
                  <Textarea
                    id="payment-info"
                    rows={4}
                    value={config.registers.paymentDetails ?? ""}
                    onChange={(event) => updateRegisters({ paymentDetails: event.target.value })}
                    placeholder="Provide payment methods, account references, or onsite instructions."
                  />
                </div>

                {renderTabSaveButton()}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card className="h-fit border border-slate-200 bg-slate-50 shadow-sm">
          <Tabs
            value={settingsShortcut}
            onValueChange={(value) => handleShortcutChange(value as SettingsShortcutTab)}
            className="w-full"
          >
            <CardHeader className="pb-3">
              <TabsList className="flex w-full gap-1.5 rounded-lg bg-slate-100 p-2.5 shadow-sm">
                {shortcutOptions
                  .filter((option) => option.visible)
                  .map((option) => (
                    <TabsTrigger
                      key={option.id}
                      value={option.id}
                      disabled={option.disabled}
                      className="flex min-w-0 basis-1/4 items-center justify-center rounded-md px-3 py-2 text-center text-sm font-semibold text-slate-600 whitespace-nowrap transition hover:bg-indigo-100 data-[state=active]:bg-indigo-500 data-[state=active]:text-white disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      {option.label}
                    </TabsTrigger>
                  ))}
              </TabsList>
            </CardHeader>
            <CardContent className="pt-4">
              <TabsContent value="registers" className="space-y-4">
                {registerControls.map(({ key, label, description }) => {
                  const switchId = `registers-${String(key)}`;
                  return (
                    <div
                      key={switchId}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3"
                    >
                      <div className="min-w-[180px]">
                        <Label htmlFor={switchId} className="text-sm font-medium text-slate-700">
                          {label}
                        </Label>
                        {description ? (
                          <p className="text-xs text-muted-foreground">{description}</p>
                        ) : null}
                      </div>
                      <Switch
                        id={switchId}
                        checked={Boolean(config.registers[key])}
                        onCheckedChange={(checked) =>
                          updateRegisters({ [key]: checked } as Partial<TournamentConfig["registers"]>)
                        }
                      />
                    </div>
                  );
                })}

                <div className="rounded-lg border border-dashed border-indigo-200 bg-indigo-50/80 px-4 py-3 text-xs text-indigo-700">
                  Enable federation switches, save the tournament, and the Data for FIDE / USCF pages open in their own
                  view. Chess-Results is always available once the tournament is saved.
                </div>

                {!tournament && (
                  <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-xs text-yellow-800">
                    Save this tournament first to access federation reporting pages.
                  </div>
                )}
              </TabsContent>
              <TabsContent value="chess-results" className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Chess-Results settings open in a dedicated page. Click the tab to jump there once your tournament is
                  saved.
                </p>
              </TabsContent>
            </CardContent>
          </Tabs>

          <div className="flex gap-2 border-t border-slate-200 bg-white/70 p-4">
            <Button variant="outline" className="flex-1" disabled>
              Export
            </Button>
            <Button variant="outline" className="flex-1" disabled>
              Download
            </Button>
          </div>
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
  );
}

export function TournamentBuilder({ mode, format: initialFormat, tournament, onCancel, onComplete }: TournamentBuilderProps) {
  const { toast } = useToast();
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
    ratingMin: section?.ratingMin ?? null,
    ratingMax: section?.ratingMax ?? null,
    amount: 0,
    currency: defaultCurrency,
    notes: "",
  };
}

function generateEntryFeeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `fee-${Math.random().toString(36).slice(2, 10)}`;
}

function generateSectionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `section-${Math.random().toString(36).slice(2, 10)}`;
}

export default TournamentBuilder;
