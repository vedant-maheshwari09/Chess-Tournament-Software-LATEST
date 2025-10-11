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
import type { Tournament } from "@shared/schema";
import {
  TournamentConfig,
  TournamentMode,
  type EntryFeeRule,
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
  const updateDetails = (updates: Partial<TournamentConfig["details"]>) =>
    onConfigChange({ ...config, details: { ...config.details, ...updates } });

  const updateRegisters = (updates: Partial<TournamentConfig["registers"]>) =>
    onConfigChange({ ...config, registers: { ...config.registers, ...updates } });

  const addEntryFee = () =>
    onConfigChange({ ...config, entryFees: [...config.entryFees, createEntryFeeRow()] });

  const updateEntryFee = (id: string, updates: Partial<EntryFeeRule>) =>
    onConfigChange({
      ...config,
      entryFees: config.entryFees.map((fee) => (fee.id === id ? { ...fee, ...updates } : fee)),
    });

  const removeEntryFee = (id: string) =>
    onConfigChange({
      ...config,
      entryFees: config.entryFees.filter((fee) => fee.id !== id),
    });

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
              <TabsTrigger value="entryFees">Entry fees</TabsTrigger>
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

              <TabsContent value="entryFees" className="bg-white p-6 space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">Entry fees</h3>
                    <p className="text-sm text-muted-foreground">
                      Define pricing by section and rating range. These options appear in the player registration form.
                    </p>
                  </div>
                  <Button variant="outline" onClick={addEntryFee}>
                    Add entry fee
                  </Button>
                </div>

                {(config.entryFees ?? []).length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600">
                    No entry fees configured yet. Add rows to match each tournament section.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(config.entryFees ?? []).map((fee) => {
                      const handleAmountChange = (raw: string) => {
                        if (raw === "") {
                          updateEntryFee(fee.id, { amount: 0 });
                          return;
                        }
                        const parsed = Number(raw);
                        updateEntryFee(fee.id, { amount: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 });
                      };

                      const handleRatingMinChange = (raw: string) => {
                        if (raw === "") {
                          updateEntryFee(fee.id, { ratingMin: null });
                          return;
                        }
                        const parsed = Number(raw);
                        updateEntryFee(fee.id, { ratingMin: Number.isFinite(parsed) ? parsed : null });
                      };

                      const handleRatingMaxChange = (raw: string) => {
                        if (raw === "") {
                          updateEntryFee(fee.id, { ratingMax: null });
                          return;
                        }
                        const parsed = Number(raw);
                        updateEntryFee(fee.id, { ratingMax: Number.isFinite(parsed) ? parsed : null });
                      };

                      return (
                        <div key={fee.id} className="rounded-xl border border-slate-200 p-4">
                          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                            <div>
                              <Label className="text-xs font-semibold uppercase text-slate-500">Section</Label>
                              <Input
                                value={fee.section}
                                onChange={(event) => updateEntryFee(fee.id, { section: event.target.value })}
                                placeholder="e.g., Championship"
                              />
                            </div>
                            <div>
                              <Label className="text-xs font-semibold uppercase text-slate-500">Rating floor</Label>
                              <Input
                                type="number"
                                value={fee.ratingMin ?? ""}
                                onChange={(event) => handleRatingMinChange(event.target.value)}
                                placeholder="e.g., 1800"
                              />
                            </div>
                            <div>
                              <Label className="text-xs font-semibold uppercase text-slate-500">Rating ceiling</Label>
                              <Input
                                type="number"
                                value={fee.ratingMax ?? ""}
                                onChange={(event) => handleRatingMaxChange(event.target.value)}
                                placeholder="Leave blank for open"
                              />
                            </div>
                            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                              <div>
                                <Label className="text-xs font-semibold uppercase text-slate-500">Amount</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={fee.amount ?? 0}
                                  onChange={(event) => handleAmountChange(event.target.value)}
                                  placeholder="e.g., 120"
                                />
                              </div>
                              <div>
                                <Label className="text-xs font-semibold uppercase text-slate-500">Currency</Label>
                                <Select
                                  value={fee.currency}
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
                          <div className="mt-3">
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

                <div className="rounded-lg bg-slate-50 p-4 text-xs text-slate-500">
                  Rating ranges are optional. Leave the fields blank to apply the fee to all players in the selected section.
                </div>
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

function createEntryFeeRow(): EntryFeeRule {
  return {
    id: generateEntryFeeId(),
    section: "",
    ratingMin: null,
    ratingMax: null,
    amount: 0,
    currency: "USD",
    notes: "",
  };
}

function generateEntryFeeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `fee-${Math.random().toString(36).slice(2, 10)}`;
}

export default TournamentBuilder;
