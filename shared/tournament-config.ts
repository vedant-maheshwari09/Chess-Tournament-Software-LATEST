import type { Tournament } from "./schema";

export type TournamentMode = "online" | "unrated" | "rated";
export type TimeControlType = "standard" | "rapid" | "blitz";

export type TimeAddonType = "none" | "increment" | "delay";

export interface TimeControlDefinition {
  minutes: number;
  addonType: TimeAddonType;
  addonValue: number;
}

export interface ScheduleEvent {
  id: string;
  date: string | null;
  time: string | null;
  label: string;
  round?: number | null;
}

export interface RegistersConfig {
  showOnCalendar: boolean;
  allowSignup: boolean;
  allowPlayerToJoin: boolean;
  allowMultiPlayerSignup: boolean;
  fideRated: boolean;
  uscfRated: boolean;
  disableSms: boolean;
  hideTeams: boolean;
  notifyPairingsEmail: boolean;
  notifyPairingsSms: boolean;
  isTeamEvent: boolean;
  playerLimit?: number | null;
  byeLimit?: number | null;
  earlyBirdDetails?: string;
  paymentDetails?: string;
  allowEditRegistration: boolean;
  enablePairingPredictor: boolean;
  isDoubleElimination: boolean;
  registrationDeadlineDate?: string | null;
  registrationDeadlineTime?: string | null;
}

export interface FideRegistrationData {
  prizeFund?: string;
  nationalChampionship?: boolean;
  titleNormsAvailable?: boolean;
  femaleOnly?: boolean;
  allDigitalClocks?: boolean;
  officialCalendar?: boolean;
  gmNormsAvailable?: boolean;
  willProvidePgn?: boolean;
  internetTransmission?: boolean;
  expectedPlayers?: string;
  maxRating?: string;
  ageLimit?: string;
  arbiterSurname?: string;
  arbiterRole?: string;
  arbiterFederation?: string;
  eventCodes?: string;
  tournamentVenue?: string;
  normLastName?: string;
  normFirstName?: string;
  normFideId?: string;
  normFederation?: string;
  signedName?: string;
  signedRole?: string;
  signedFederation?: string;
  signedDate?: string;
  remarks?: string;
}

export interface UscfReportData {
  state?: string;
  affiliateId?: string;

  tournamentDirector?: string;
  assistantDirector?: string;
  sendCrossTableTo?: "affiliate" | "tournament_director" | "none";
  scholastic?: boolean;
  grandPrixPoints?: string;
}

export type ChessResultsSyncMode = "disabled" | "manual" | "automatic";
export type ChessResultsExportMode =
  | "page"
  | "participants"
  | "participants_standings"
  | "participants_standings_rounds";

export interface ChessResultsConfig {
  syncMode: ChessResultsSyncMode;
  exportMode: ChessResultsExportMode;
  endpoint?: string;
  personalNumber?: string;
  password?: string;
  tournamentId?: string;
  organizerName?: string;
  organizerEmail?: string;
  eventCode?: string;
  autoSyncIntervalMinutes?: number;
  lastSyncAt?: string | null;
  lastSyncStatus?: "success" | "error" | "pending" | null;
  lastSyncMessage?: string | null;
}

export interface ContactEntry {
  id: string;
  name: string;
  role: string;
  phone?: string;
  email?: string;
}

export interface EntryFeeRule {
  id: string;
  sectionId?: string;
  section: string;
  ratingMin: number | null;
  ratingMax: number | null;
  amount: number;
  currency: string;
  notes?: string;
  effectiveAfter: string | null;
}

export interface PrizeRule {
  id: string;
  sectionId?: string;
  section: string;
  ratingCap: number | null;
  place: string;
  amount: number;
  currency: string;
}

export interface SectionDefinition {
  id: string;
  name: string;
  ratingMin: number | null;
  ratingMax: number | null;
  description?: string;
}

export type PaymentProvider = "stripe" | "paypal";
export type OfflinePaymentMethod = "cash" | "check" | "venmo" | "zelle" | "paypal" | "other";

export interface ScoringRules {
  win: number;
  draw: number;
  loss: number;
}

export type MatchWinConditionValue = number | "armageddon";

export interface MatchFormat {
  thresholds: MatchWinConditionValue[];
}

export interface ArenaScoringConfig {
  winPoints: number;
  drawPoints: number;
  lossPoints: number;
  streakThreshold: number;
  onFireWinPoints: number;
  onFireDrawPoints: number;
}

export interface AccountPaymentSettings {
  preferredProvider: PaymentProvider | null;
  stripeAccountId?: string;
  stripePublishableKey?: string;
  payoutStatementDescriptor?: string;
  paypalMerchantId?: string;
  paypalClientId?: string;
  paypalEmail?: string;
  updatedAt?: string;
}

export interface PaymentSettings {
  defaultCurrency: string;
  provider: PaymentProvider;
  onlineEnabled: boolean;
  requirePaymentOnRegistration: boolean;
  allowProcessingContribution: boolean;
  processingFeePercent: number | null;
  stripeAccountId?: string;
  stripePublishableKey?: string;
  payoutStatementDescriptor?: string;
  paypalMerchantId?: string;
  paypalClientId?: string;
  paypalEmail?: string;
  connectionScope: "tournament" | "account";
  acceptedOfflineMethods: OfflinePaymentMethod[];
  offlineInstructions: string;
}

export interface TournamentConfig {
  version: "v2";
  mode: TournamentMode;
  format: Tournament["format"];
  prizesEnabled: boolean;
  basic: {
    name: string;
    city: string;
    state: string;
    federation: string;
    startDate: string | null;
    endDate: string | null;
    description: string;
  };
  details: {
    chiefArbiter: string;
    organizer: string;
    assistantTDs: string[];
    affiliate: string;
    timeControl: TimeControlType;
    timeControls: TimeControlDefinition[];
    pairingSystem: string;
    rounds: number;
    tiebreakSystem: string;
    ratingType: string;
    primaryRatingSystem?: "uscf" | "fide";
    scoring: ScoringRules;
    tiebreaksEnabled: boolean;
    tiebreaks: string[];
    matchWinConditions?: Record<number, number>; // Legacy mapping
    knockoutMatchFormat?: {
      default: MatchFormat;
      overrides?: Record<string, MatchFormat>;
    };
  };
  schedule: ScheduleEvent[];
  sections: SectionDefinition[];
  entryFees: EntryFeeRule[];
  prizes: PrizeRule[];
  payments: PaymentSettings;
  registers: RegistersConfig;
  fide: FideRegistrationData;
  uscf: UscfReportData;
  chessResults: ChessResultsConfig;
  contacts: ContactEntry[];
  tournamentPageContent: string;
  boardNumbering: BoardNumberingSettings;
  seedingMethod?: "random" | "slaughter" | "manual" | "fide_world_cup";
  seedingSource?: "rating" | "uscf" | "fide";
  arena?: {
    durationMinutes: number;
    arenaEndStrategy?: 'wait_for_ongoing' | 'force_end';
    arenaPairingMode?: 'automatic' | 'manual';
    arenaCutoffMinutes?: number;
    arenaCountdownSeconds?: number;
    arenaPrePairBeforeStart?: boolean;
    scoring: ArenaScoringConfig;
  };
}

export interface BoardNumberingSettings {
  start?: number;
  increment?: number;
  gaps?: string;
  customSequence?: string;
}

export function normalizeCityState(value: string): string {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const [cityPartRaw, ...stateParts] = normalized.split(",");
  const cityPart = cityPartRaw.trim().replace(/\s+/g, " ");
  const stateSource = stateParts.join(",").trim();
  if (!stateSource) {
    return cityPart;
  }
  const stateAbbreviation = stateSource.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase();
  return stateAbbreviation ? `${cityPart}, ${stateAbbreviation}` : cityPart;
}

const DEFAULT_SCHEDULE_ROUNDS = 9;

export const SCHEDULE_EVENT_OPTIONS = [
  "Round 1",
  "Round 2",
  "Round 3",
  "Round 4",
  "Round 5",
  "Round 6",
  "Round 7",
  "Round 8",
  "Round 9",
  "Opening Ceremony",
  "Technical Meeting",
  "Closing Ceremony",
  "Arrivals",
  "Departures",
  "Press Conference",
  "Banquet",
  "Rest Day",
  "Other Event",
];

export function createDefaultSchedule(rounds: number): ScheduleEvent[] {
  const count = Math.max(1, rounds);
  return Array.from({ length: count }, (_, index) => ({
    id: `${index + 1}`,
    date: null,
    time: null,
    label: SCHEDULE_EVENT_OPTIONS[index] ?? `Round ${index + 1}`,
    round: index + 1,
  }));
}

export function createDefaultConfig(format: Tournament["format"], mode: TournamentMode = "rated"): TournamentConfig {
  const defaultRounds = format === "roundrobin" ? 9 : (format === "knockout" ? 0 : DEFAULT_SCHEDULE_ROUNDS);
  const defaultTimeControl: TimeControlDefinition = {
    minutes: format === "knockout" ? 25 : 90,
    addonType: "increment" satisfies TimeAddonType,
    addonValue: format === "knockout" ? 10 : 30,
  };
  return {
    version: "v2",
    mode,
    format,
    prizesEnabled: true,
    basic: {
      name: "",
      city: "",
      state: "",
      federation: "United States",
      startDate: null,
      endDate: null,
      description: "",
    },
    details: {
      chiefArbiter: "",
      organizer: "",
      assistantTDs: [],
      affiliate: "",
      timeControl: "standard",
      timeControls: [defaultTimeControl],
      pairingSystem: format === "roundrobin" ? "Round Robin" : "Swiss System",
      rounds: defaultRounds,
      tiebreakSystem: "rating",
      ratingType: "standard",
      primaryRatingSystem: "uscf",
      scoring: {
        win: 1,
        draw: 0.5,
        loss: 0,
      },
      tiebreaksEnabled: true,
      tiebreaks: [],
      matchWinConditions: {},
    },
    schedule: createDefaultSchedule(defaultRounds),
    sections: [],
    entryFees: [],
    prizes: [],
    payments: {
      defaultCurrency: "USD",
      provider: "stripe",
      onlineEnabled: false,
      requirePaymentOnRegistration: false,
      allowProcessingContribution: true,
      processingFeePercent: 0,
      stripeAccountId: "",
      stripePublishableKey: "",
      payoutStatementDescriptor: "",
      paypalMerchantId: "",
      paypalClientId: "",
      paypalEmail: "",
      connectionScope: "tournament",
      acceptedOfflineMethods: ["cash", "check"],
      offlineInstructions: "Pay at the venue before round 1.",
    },
    registers: {
      showOnCalendar: false,
      allowSignup: false,
      allowPlayerToJoin: false,
      allowMultiPlayerSignup: false,
      fideRated: mode === "rated",
      uscfRated: mode === "rated",
      disableSms: false,
      hideTeams: false,
      notifyPairingsEmail: true,
      notifyPairingsSms: false,
      isTeamEvent: false,
      playerLimit: null,
      byeLimit: null,
      earlyBirdDetails: "",
      paymentDetails: "",
      allowEditRegistration: false,
      enablePairingPredictor: false,
      isDoubleElimination: false,
    },
    fide: {
      prizeFund: "",
      nationalChampionship: false,
      titleNormsAvailable: false,
      femaleOnly: false,
      allDigitalClocks: false,
      officialCalendar: false,
      gmNormsAvailable: false,
      willProvidePgn: false,
      internetTransmission: false,
      expectedPlayers: "",
      maxRating: "",
      ageLimit: "None",
      arbiterSurname: "",
      arbiterRole: "",
      arbiterFederation: "",
      tournamentVenue: "",
      eventCodes: "",
      normLastName: "",
      normFirstName: "",
      normFideId: "",
      normFederation: "United States",
      signedName: "",
      signedRole: "Chief Arbiter",
      signedFederation: "United States",
      signedDate: "",
      remarks: "",
    },
    uscf: {
      state: "",
      sendCrossTableTo: "none",

      scholastic: false,
      grandPrixPoints: "",
    },
    chessResults: {
      syncMode: "disabled",
      exportMode: "participants_standings_rounds",
      endpoint: "https://chess-results.com/tnr_api/",
      personalNumber: "",
      password: "",
      tournamentId: "",
      organizerName: "",
      organizerEmail: "",
      eventCode: "",
      autoSyncIntervalMinutes: 15,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastSyncMessage: null,
    },
    contacts: [],
    tournamentPageContent: "",
    boardNumbering: {
      start: 1,
      increment: 1,
      gaps: '',
      customSequence: '',
    },
    seedingMethod: "fide_world_cup",
    seedingSource: "rating",
    arena: {
      durationMinutes: 60,
      scoring: {
        winPoints: 2,
        drawPoints: 1,
        lossPoints: 0,
        streakThreshold: 2,
        onFireWinPoints: 4,
        onFireDrawPoints: 2,
      },
      arenaEndStrategy: 'wait_for_ongoing',
      arenaPairingMode: 'automatic',
      arenaCutoffMinutes: 2,
      arenaCountdownSeconds: 10,
      arenaPrePairBeforeStart: false,
    },
  };
}

export function parseTournamentConfig(tournament: Tournament | undefined | null): TournamentConfig {
  if (!tournament || !tournament.roundTimings) {
    return createDefaultConfig(tournament?.format || "swiss", "rated");
  }

  const raw = tournament.roundTimings as any;
  
  // Normalize properties for predictable access across versions
  if (raw.details) {
    if (raw.details.knockout_match_format && !raw.details.knockoutMatchFormat) {
      raw.details.knockoutMatchFormat = raw.details.knockout_match_format;
    }
  }
  if (raw.schedule && !raw.roundTimings) {
    raw.roundTimings = raw.schedule;
  }

  if (raw.version === "v2") {
    const rawMode = (raw as any)?.mode;
    const normalizedMode: TournamentMode =
      rawMode === "online" || rawMode === "unrated" || rawMode === "rated"
        ? rawMode
        : rawMode === "casual"
        ? "unrated"
        : "rated";

    return {
      ...raw,
      mode: normalizedMode,
    } as TournamentConfig;
  }

  // Legacy/v1 Parsing
  const parsed = raw;
  const rawMode = (parsed as any)?.mode;
  const normalizedMode: TournamentMode =
    rawMode === "online" || rawMode === "unrated" || rawMode === "rated"
      ? rawMode
      : rawMode === "casual"
      ? "unrated"
      : "rated";
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const normalizedTimeControls = Array.isArray(parsed.details?.timeControls)
      ? parsed.details.timeControls.map((control: any) => ({
          minutes: Number(control?.minutes) || 0,
          addonType: (control?.addonType as TimeAddonType) ?? ("none" as TimeAddonType),
          addonValue: Number(control?.addonValue) || 0,
        }))
      : [
          {
            minutes: Number((parsed.details as any)?.timeMinutes) || 0,
            addonType:
              ((parsed.details as any)?.timeIncrement ?? 0) > 0
                ? ("increment" as TimeAddonType)
                : ("none" as TimeAddonType),
            addonValue: Number((parsed.details as any)?.timeIncrement) || 0,
          },
        ];

    const defaults = createDefaultConfig(tournament.format, normalizedMode ?? "rated");

    const sanitizedEntryFees = sanitizeEntryFees((parsed as any)?.entryFees);
    const sanitizedPrizes = sanitizePrizes((parsed as any)?.prizes);
    const sanitizedSections = sanitizeSections((parsed as any)?.sections, sanitizedEntryFees, sanitizedPrizes);
    const normalizedEntryFees = sanitizedEntryFees.map((fee) => {
      const sectionName = (fee.section ?? "").trim();
      const linkedSection =
        (fee.sectionId && sanitizedSections.find((section) => section.id === fee.sectionId)) ??
        sanitizedSections.find((section) => section.name.trim().toLowerCase() === sectionName.toLowerCase());
      if (!linkedSection) {
        return fee;
      }
      return {
        ...fee,
        sectionId: linkedSection.id,
        section: linkedSection.name,
        ratingMin: fee.ratingMin ?? linkedSection.ratingMin ?? null,
        ratingMax: fee.ratingMax ?? linkedSection.ratingMax ?? null,
      };
    });
    const normalizedPrizes = sanitizedPrizes.map((prize) => {
      const sectionName = (prize.section ?? "").trim();
      const linkedSection =
        (prize.sectionId && sanitizedSections.find((section) => section.id === prize.sectionId)) ??
        sanitizedSections.find((section) => section.name.trim().toLowerCase() === sectionName.toLowerCase());
      if (!linkedSection) {
        return prize;
      }
      return {
        ...prize,
        sectionId: linkedSection.id,
        section: linkedSection.name,
        ratingCap: prize.ratingCap ?? linkedSection.ratingMax ?? null,
      };
    });
    const sanitizedPayments = sanitizePaymentSettings((parsed as any)?.payments);
    const scoring = sanitizeScoring((parsed as any)?.details?.scoring);
    const tiebreaks = sanitizeTiebreaks((parsed as any)?.details?.tiebreaks);
    const tiebreaksEnabled =
      typeof (parsed as any)?.details?.tiebreaksEnabled === "boolean"
        ? Boolean((parsed as any).details.tiebreaksEnabled)
        : tiebreaks.length > 0 || defaults.details.tiebreaksEnabled;
    const prizesEnabled = typeof (parsed as any)?.prizesEnabled === "boolean"
      ? (parsed as any).prizesEnabled
      : true;

    return {
      ...defaults,
      ...parsed,
      prizesEnabled,
      basic: {
        ...defaults.basic,
        ...parsed.basic,
        state: normalizeCityState(typeof parsed.basic?.state === "string" ? parsed.basic.state : ""),
      },
      details: {
        ...defaults.details,
        ...parsed.details,
        affiliate: parsed.details?.affiliate ?? "",
        timeControls: normalizedTimeControls,
        scoring,
        tiebreaksEnabled,
        tiebreaks,
        primaryRatingSystem: parsed.details?.primaryRatingSystem ?? defaults.details.primaryRatingSystem ?? "uscf",
        matchWinConditions: parsed.details?.matchWinConditions ?? defaults.details.matchWinConditions ?? {},
      },
      boardNumbering: {
        ...defaults.boardNumbering,
        ...parsed.boardNumbering,
      },
      registers: {
        ...defaults.registers,
        ...parsed.registers,
        notifyPairingsEmail: parsed.registers?.notifyPairingsEmail ?? true,
        notifyPairingsSms: parsed.registers?.notifyPairingsSms ?? false,
        playerLimit:
          typeof parsed.registers?.playerLimit === "number"
            ? parsed.registers?.playerLimit
            : parsed.registers?.playerLimit === null
            ? null
            : parsed.registers?.playerLimit
            ? Number(parsed.registers?.playerLimit) || null
            : null,
        byeLimit:
          typeof parsed.registers?.byeLimit === "number"
            ? parsed.registers?.byeLimit
            : parsed.registers?.byeLimit === null
            ? null
            : parsed.registers?.byeLimit
            ? Number(parsed.registers?.byeLimit) || null
            : null,
        earlyBirdDetails: parsed.registers?.earlyBirdDetails ?? "",
        paymentDetails: parsed.registers?.paymentDetails ?? "",
        allowEditRegistration: parsed.registers?.allowEditRegistration ?? false,
        isDoubleElimination: parsed.registers?.isDoubleElimination ?? tournament.isDoubleElimination ?? false,
      },
      fide: {
        ...defaults.fide,
        ...parsed.fide,
      },
      uscf: {
        ...defaults.uscf,
        ...parsed.uscf,
      },
      chessResults: {
        ...defaults.chessResults,
        ...parsed.chessResults,
        autoSyncIntervalMinutes:
          parsed.chessResults?.autoSyncIntervalMinutes && Number.isFinite(parsed.chessResults.autoSyncIntervalMinutes)
            ? parsed.chessResults.autoSyncIntervalMinutes
            : defaults.chessResults.autoSyncIntervalMinutes,
      },
      sections: sanitizedSections,
      entryFees: normalizedEntryFees,
      prizes: normalizedPrizes,
      payments: sanitizedPayments,
      mode: normalizedMode,
      seedingMethod: (parsed as any)?.seedingMethod ?? tournament.seedingMethod ?? "fide_world_cup",
      seedingSource: (parsed as any)?.seedingSource ?? "rating",
      arena: {
        durationMinutes: tournament.arenaDuration ?? parsed.arena?.durationMinutes ?? defaults.arena!.durationMinutes,
        arenaEndStrategy: (tournament.arenaEndStrategy as any) ?? parsed.arena?.arenaEndStrategy ?? defaults.arena!.arenaEndStrategy,
        arenaPairingMode: (tournament.arenaPairingMode as any) ?? parsed.arena?.arenaPairingMode ?? defaults.arena!.arenaPairingMode,
        arenaCutoffMinutes: tournament.arenaCutoffMinutes ?? parsed.arena?.arenaCutoffMinutes ?? defaults.arena!.arenaCutoffMinutes,
        arenaCountdownSeconds: tournament.arenaCountdownSeconds ?? parsed.arena?.arenaCountdownSeconds ?? defaults.arena!.arenaCountdownSeconds,
        arenaPrePairBeforeStart: tournament.arenaPrePairBeforeStart ?? parsed.arena?.arenaPrePairBeforeStart ?? defaults.arena!.arenaPrePairBeforeStart ?? false,
        scoring: (tournament.arenaScoringConfig as any) ?? parsed.arena?.scoring ?? defaults.arena!.scoring,
      },
    };
  }

  const legacySchedule: ScheduleEvent[] = Array.isArray(raw)
    ? raw.map((item: any, index: number) => ({
        id: `${index + 1}`,
        date: item?.date ?? null,
        time: item?.time ?? null,
        label: `Round ${item?.round ?? index + 1}`,
        round: item?.round ?? index + 1,
      }))
    : createDefaultSchedule(DEFAULT_SCHEDULE_ROUNDS);

  const config = createDefaultConfig(tournament.format, "rated");
  return {
    ...config,
    basic: {
      ...config.basic,
      name: tournament.name,
      description: tournament.location ?? "",
      state: normalizeCityState(config.basic.state),
    },
    details: {
      ...config.details,
      rounds: tournament.rounds ?? config.details.rounds,
      pairingSystem: tournament.format === "roundrobin" ? "Round Robin" : "Swiss System",
      timeControls: [
        {
          minutes: 90,
          addonType: "increment",
          addonValue: 30,
        },
      ],
    },
    schedule: legacySchedule,
    sections: [],
    entryFees: [],
    prizes: [],
  };
}

export function serializeTournamentConfig(config: TournamentConfig): TournamentConfig {
  const rounds = config.details.rounds;
  const adjustedSchedule = config.schedule.map((event, index) => ({
    ...event,
    round: event.round ?? index + 1,
    id: event.id || `${index + 1}`,
  }));
  const sanitizedEntryFees = sanitizeEntryFees(config.entryFees);
  const sanitizedPrizes = sanitizePrizes(config.prizes);
  const sanitizedSections = sanitizeSections(config.sections, sanitizedEntryFees, sanitizedPrizes);
  const normalizedEntryFees = sanitizedEntryFees.map((fee) => {
    const sectionName = (fee.section ?? "").trim();
    const linkedSection =
      (fee.sectionId && sanitizedSections.find((section) => section.id === fee.sectionId)) ??
      sanitizedSections.find((section) => section.name.trim().toLowerCase() === sectionName.toLowerCase());
    if (!linkedSection) {
      return fee;
    }
    return {
      ...fee,
      sectionId: linkedSection.id,
      section: linkedSection.name,
      ratingMin: fee.ratingMin ?? linkedSection.ratingMin ?? null,
      ratingMax: fee.ratingMax ?? linkedSection.ratingMax ?? null,
    };
  });
  const normalizedPrizes = sanitizedPrizes.map((prize) => {
    const sectionName = (prize.section ?? "").trim();
    const linkedSection =
      (prize.sectionId && sanitizedSections.find((section) => section.id === prize.sectionId)) ??
      sanitizedSections.find((section) => section.name.trim().toLowerCase() === sectionName.toLowerCase());
    if (!linkedSection) {
      return prize;
    }
    return {
      ...prize,
      sectionId: linkedSection.id,
      section: linkedSection.name,
      ratingCap: prize.ratingCap ?? linkedSection.ratingMax ?? null,
    };
  });
  const sanitizedPayments = sanitizePaymentSettings(config.payments);

  return {
    ...config,
    basic: {
      ...config.basic,
      state: normalizeCityState(config.basic.state),
    },
    details: {
      ...config.details,
      rounds,
    },
    schedule: adjustedSchedule,
    sections: sanitizedSections,
    entryFees: normalizedEntryFees,
    prizes: normalizedPrizes,
    payments: sanitizedPayments,
    arena: config.arena,
  };
}

function sanitizeEntryFees(value: unknown): EntryFeeRule[] {
  if (!Array.isArray(value)) return [];
  const result: EntryFeeRule[] = [];
  for (const raw of value) {
    const sanitized = sanitizeEntryFeeRule(raw);
    if (!sanitized.section.trim()) continue;
    if (result.some((existing) => existing.id === sanitized.id)) {
      sanitized.id = generateEntryFeeId();
    }
    result.push(sanitized);
  }
  return result;
}

function sanitizeEntryFeeRule(raw: any): EntryFeeRule {
  const id = typeof raw?.id === "string" && raw.id.trim() ? raw.id.trim() : generateEntryFeeId();
  const sectionId = typeof raw?.sectionId === "string" && raw.sectionId.trim() ? raw.sectionId.trim() : undefined;
  const section = typeof raw?.section === "string" ? raw.section.trim() : "";
  const ratingMin = coerceNullableNumber(raw?.ratingMin);
  const ratingMax = coerceNullableNumber(raw?.ratingMax);
  const amount = coerceAmount(raw?.amount);
  const currency = typeof raw?.currency === "string" && raw.currency.trim() ? raw.currency.trim().toUpperCase() : "USD";
  const notes = typeof raw?.notes === "string" && raw.notes.trim() ? raw.notes.trim() : undefined;
  const effectiveAfter = coerceDateString(raw?.effectiveAfter);
  return {
    id,
    sectionId,
    section,
    ratingMin,
    ratingMax,
    amount,
    currency,
    notes,
    effectiveAfter,
  };
}

function sanitizePrizes(value: unknown): PrizeRule[] {
  if (!Array.isArray(value)) return [];
  const result: PrizeRule[] = [];
  for (const raw of value) {
    const sanitized = sanitizePrizeRule(raw);
    if (!sanitized.section.trim()) continue;
    if (result.some((existing) => existing.id === sanitized.id)) {
      sanitized.id = generatePrizeId();
    }
    result.push(sanitized);
  }
  return result;
}

function sanitizePrizeRule(raw: any): PrizeRule {
  const id = typeof raw?.id === "string" && raw.id.trim() ? raw.id.trim() : generatePrizeId();
  const sectionId = typeof raw?.sectionId === "string" && raw.sectionId.trim() ? raw.sectionId.trim() : undefined;
  const section = typeof raw?.section === "string" ? raw.section.trim() : "";
  const ratingCap = coerceNullableNumber(raw?.ratingCap);
  const placeSource = typeof raw?.place === "string" && raw.place.trim() ? raw.place.trim() : undefined;
  const legacyNotes = typeof raw?.notes === "string" && raw.notes.trim() ? raw.notes.trim() : undefined;
  const place = placeSource ?? legacyNotes ?? "";
  const amount = coerceAmount(raw?.amount);
  const currency = typeof raw?.currency === "string" && raw.currency.trim() ? raw.currency.trim().toUpperCase() : "USD";
  return {
    id,
    sectionId,
    section,
    ratingCap,
    place,
    amount,
    currency,
  };
}

function coerceNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function coerceAmount(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Number(numeric.toFixed(2)));
}

function coerceDateString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
  if (isoPattern.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  const month = `${parsed.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function generateEntryFeeId(): string {
  const globalCrypto = typeof globalThis !== "undefined" ? (globalThis as any).crypto : undefined;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return globalCrypto.randomUUID();
  }
  return `fee-${Math.random().toString(36).slice(2, 10)}`;
}

function generatePrizeId(): string {
  const globalCrypto = typeof globalThis !== "undefined" ? (globalThis as any).crypto : undefined;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return globalCrypto.randomUUID();
  }
  return `prize-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeSections(
  value: unknown,
  fallbackEntryFees: EntryFeeRule[] = [],
  fallbackPrizes: PrizeRule[] = [],
): SectionDefinition[] {
  const fromArray = Array.isArray(value) ? value : [];
  const result: SectionDefinition[] = [];

  for (const raw of fromArray) {
    const section = sanitizeSectionDefinition(raw);
    if (!section.name.trim()) continue;
    if (result.some((existing) => existing.id === section.id)) {
      section.id = generateSectionId();
    }
    result.push(section);
  }

  if (result.length === 0 && (fallbackEntryFees.length > 0 || fallbackPrizes.length > 0)) {
    const derived = deriveSectionsFromFallback(fallbackEntryFees, fallbackPrizes);
    if (derived.length > 0) return derived;
  }

  if (result.length === 0) {
    return [{
      id: 'open',
      name: 'Open',
      ratingMin: null,
      ratingMax: null,
      description: 'Standard tournament section'
    }];
  }

  return result;
}

function sanitizeSectionDefinition(raw: any): SectionDefinition {
  const id = typeof raw?.id === "string" && raw.id.trim() ? raw.id.trim() : generateSectionId();
  const name = typeof raw?.name === "string" ? raw.name.trim() : "";
  const ratingMin = coerceNullableNumber(raw?.ratingMin);
  const ratingMax = coerceNullableNumber(raw?.ratingMax);
  const description = typeof raw?.description === "string" && raw.description.trim() ? raw.description.trim() : undefined;
  return {
    id,
    name,
    ratingMin,
    ratingMax,
    description,
  };
}

function deriveSectionsFromFallback(entryFees: EntryFeeRule[], prizes: PrizeRule[]): SectionDefinition[] {
  const map = new Map<string, SectionDefinition>();
  for (const fee of entryFees) {
    const key = fee.section?.trim().toLowerCase();
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        id: generateSectionId(),
        name: fee.section.trim(),
        ratingMin: fee.ratingMin ?? null,
        ratingMax: fee.ratingMax ?? null,
        description: undefined,
      });
    }
  }
  for (const prize of prizes) {
    const key = prize.section?.trim().toLowerCase();
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        id: generateSectionId(),
        name: prize.section.trim(),
        ratingMin: null,
        ratingMax: prize.ratingCap ?? null,
        description: undefined,
      });
    }
  }
  return Array.from(map.values());
}

function generateSectionId(): string {
  const globalCrypto = typeof globalThis !== "undefined" ? (globalThis as any).crypto : undefined;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return globalCrypto.randomUUID();
  }
  return `section-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizePaymentSettings(raw: any): PaymentSettings {
  const defaults = createDefaultConfig("swiss").payments;
  const defaultCurrency =
    typeof raw?.defaultCurrency === "string" && raw.defaultCurrency.trim()
      ? raw.defaultCurrency.trim().toUpperCase()
      : defaults.defaultCurrency;
  const providerRaw =
    typeof raw?.provider === "string" && raw.provider.trim()
      ? raw.provider.trim().toLowerCase()
      : defaults.provider;
  const provider: PaymentProvider = providerRaw === "paypal" ? "paypal" : "stripe";
  const onlineEnabled = raw?.onlineEnabled === true;
  const requirePaymentOnRegistration = raw?.requirePaymentOnRegistration === true;
  const allowProcessingContribution = raw?.allowProcessingContribution !== false;
  const processingFeePercent = coerceNullableNumber(raw?.processingFeePercent);
  const stripeAccountId =
    typeof raw?.stripeAccountId === "string" && raw.stripeAccountId.trim() ? raw.stripeAccountId.trim() : undefined;
  const stripePublishableKey =
    typeof raw?.stripePublishableKey === "string" && raw.stripePublishableKey.trim()
      ? raw.stripePublishableKey.trim()
      : undefined;
  const payoutStatementDescriptor =
    typeof raw?.payoutStatementDescriptor === "string" && raw.payoutStatementDescriptor.trim()
      ? raw.payoutStatementDescriptor.trim()
      : undefined;
  const paypalMerchantId =
    typeof raw?.paypalMerchantId === "string" && raw.paypalMerchantId.trim() ? raw.paypalMerchantId.trim() : undefined;
  const paypalClientId =
    typeof raw?.paypalClientId === "string" && raw.paypalClientId.trim() ? raw.paypalClientId.trim() : undefined;
  const paypalEmail =
    typeof raw?.paypalEmail === "string" && raw.paypalEmail.trim() ? raw.paypalEmail.trim() : undefined;
  const connectionScope: "tournament" | "account" = raw?.connectionScope === "account" ? "account" : "tournament";

  const offlineMethodWhitelist: OfflinePaymentMethod[] = ["cash", "check", "venmo", "zelle", "paypal", "other"];
  const acceptedOfflineMethods: OfflinePaymentMethod[] = Array.isArray(raw?.acceptedOfflineMethods)
    ? Array.from(
        new Set(
          (raw.acceptedOfflineMethods as unknown[])
            .map((method): OfflinePaymentMethod | null => {
              if (typeof method !== "string" || !method.trim()) return null;
              const normalized = method.trim().toLowerCase() as OfflinePaymentMethod;
              return offlineMethodWhitelist.includes(normalized) ? normalized : null;
            })
            .filter((method): method is OfflinePaymentMethod => method !== null),
        ),
      )
    : defaults.acceptedOfflineMethods;

  const offlineInstructions =
    typeof raw?.offlineInstructions === "string" && raw.offlineInstructions.trim()
      ? raw.offlineInstructions.trim()
      : defaults.offlineInstructions;

  const result: PaymentSettings = {
    defaultCurrency,
    provider,
    onlineEnabled,
    requirePaymentOnRegistration,
    allowProcessingContribution,
    processingFeePercent: processingFeePercent ?? defaults.processingFeePercent,
    connectionScope,
    acceptedOfflineMethods,
    offlineInstructions,
  };

  if (stripeAccountId) result.stripeAccountId = stripeAccountId;
  if (stripePublishableKey) result.stripePublishableKey = stripePublishableKey;
  if (payoutStatementDescriptor) result.payoutStatementDescriptor = payoutStatementDescriptor;
  if (paypalMerchantId) result.paypalMerchantId = paypalMerchantId;
  if (paypalClientId) result.paypalClientId = paypalClientId;
  if (paypalEmail) result.paypalEmail = paypalEmail;

  return result;
}

function sanitizeScoring(raw: any): ScoringRules {
  const defaults = createDefaultConfig("swiss").details.scoring;
  const win = coerceScore(raw?.win, defaults.win);
  const draw = coerceScore(raw?.draw, defaults.draw);
  const loss = coerceScore(raw?.loss, defaults.loss);
  return {
    win,
    draw,
    loss,
  };
}

function coerceScore(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const numeric = typeof value === "string" ? Number(value) : (value as number);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Number(numeric.toFixed(2));
}

function sanitizeTiebreaks(raw: any): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function parseGaps(gapsStr: string | undefined): { afterBoard: number; skip: number }[] | undefined {
  if (!gapsStr) return undefined;
  const gaps = [];
  const entries = gapsStr.split(',').map(e => e.trim()).filter(e => e);
  for (const entry of entries) {
    const parts = entry.split(':').map(p => p.trim());
    if (parts.length === 2) {
      const afterBoard = parseInt(parts[0], 10);
      const skip = parseInt(parts[1], 10);
      if (!isNaN(afterBoard) && !isNaN(skip)) {
        gaps.push({ afterBoard, skip });
      }
    }
  }
  return gaps.length > 0 ? gaps : undefined;
}

function parseCustomSequence(seqStr: string | undefined): number[] | undefined {
  if (!seqStr) return undefined;
  const sequence = seqStr.split(',').map(e => parseInt(e.trim(), 10)).filter(n => !isNaN(n));
  return sequence.length > 0 ? sequence : undefined;
}

export function buildTournamentPayload(
  config: TournamentConfig,
  opts: { format: Tournament["format"] }
) {
  const serialized = serializeTournamentConfig(config);
  return {
    name: serialized.basic.name,
    format: opts.format,
    rounds: serialized.details.rounds,
    timeControl: serialized.details.timeControl,
    tiebreakOrder: serialized.details.tiebreakSystem,
    roundTimings: serialized,
    boardNumberingSettings: {
      start: serialized.boardNumbering.start,
      increment: serialized.boardNumbering.increment,
      gaps: parseGaps(serialized.boardNumbering.gaps),
      customSequence: parseCustomSequence(serialized.boardNumbering.customSequence),
    },
    location: serialized.basic.city,
    isDoubleElimination: serialized.registers.isDoubleElimination,
    useQuickSetup: false,
    arenaDuration: serialized.arena?.durationMinutes,
    arenaScoringConfig: serialized.arena?.scoring,
    arenaCountdownSeconds: serialized.arena?.arenaCountdownSeconds,
    arenaPrePairBeforeStart: serialized.arena?.arenaPrePairBeforeStart,
    arenaPairingMode: serialized.arena?.arenaPairingMode,
    arenaEndStrategy: serialized.arena?.arenaEndStrategy,
    arenaCutoffMinutes: serialized.arena?.arenaCutoffMinutes,
  };
}

export function resolveEntryFeeBounds(
  fee: EntryFeeRule,
  section?: SectionDefinition | null,
): { ratingMin: number | null; ratingMax: number | null } {
  const ratingMin = fee.ratingMin !== null ? fee.ratingMin : section?.ratingMin ?? null;
  const ratingMax = fee.ratingMax !== null ? fee.ratingMax : section?.ratingMax ?? null;
  return { ratingMin, ratingMax };
}

/**
 * Calculates the cumulative score for a series of matches (a matchup).
 * Correctly handles color swaps between games in a series.
 * @param matches All games in the matchup series
 * @param manualP1Id Optional: Force which player is considered P1 (Top player in bracket)
 * @param manualP2Id Optional: Force which player is considered P2 (Bottom player in bracket)
 */
export function calculateMatchupScore(matches: any[], manualP1Id?: number | null, manualP2Id?: number | null) {
  if (matches.length === 0) return { p1Score: 0, p2Score: 0, p1Id: manualP1Id || 0, p2Id: manualP2Id || 0 };
  
  // Define P1 and P2 based on the very first game of the series if not provided
  const sortedMatches = [...matches].sort((a, b) => (a.gameNumber || 1) - (b.gameNumber || 1));
  const first = sortedMatches[0];
  const p1Id = manualP1Id !== undefined ? manualP1Id : first.whitePlayerId;
  const p2Id = manualP2Id !== undefined ? manualP2Id : first.blackPlayerId;
  
  let p1Score = 0;
  let p2Score = 0;
  
  for (const m of sortedMatches) {
    if (!m.result || m.result === '*' || m.result === 'P') continue;
    
    let w = 0, b = 0;
    if (m.result === '1-0' || m.result === '1-0F') w = 1;
    else if (m.result === '0-1' || m.result === '0-1F') b = 1;
    else if (m.result === '1/2-1/2') { w = 0.5; b = 0.5; }
    
    // Attribute points to the correct player regardless of which color they played in THIS game
    if (m.whitePlayerId === p1Id) {
      p1Score += w;
      p2Score += b;
    } else if (m.whitePlayerId === p2Id) {
      p2Score += w;
      p1Score += b;
    } else if (m.blackPlayerId === p1Id) {
      // In case whitePlayerId was p2Id or something else
      p1Score += b;
      p2Score += w;
    } else if (m.blackPlayerId === p2Id) {
      p2Score += b;
      p1Score += w;
    }
  }
  
  return { p1Score, p2Score, p1Id, p2Id };
}

/**
 * Retrieves the match format (thresholds, games) for a specific round/bracket.
 */
export function getMatchFormat(config: TournamentConfig, round: number, bracketType?: string): MatchFormat & { games?: number } {
  const knockoutFormat = config.details.knockoutMatchFormat;
  const defaultFormat: MatchFormat & { games?: number } = { 
    thresholds: [1.5],
    games: 2
  };
  
  let matchedFormat: MatchFormat | undefined;

  if (knockoutFormat) {
    const overrides = knockoutFormat.overrides || {};
    const bracket = bracketType || 'winners';
    
    // Priority keys for matching overrides
    const possibleKeys = [
      `${bracket}_round_${round}`,
      `round_${round}`,
      String(round),
      `Round ${round}`,
      round === config.details.rounds ? "Finals" : "",
      round === (config.details.rounds || 0) - 1 ? "Semifinals" : "",
      round === (config.details.rounds || 0) - 2 ? "Quarterfinals" : ""
    ].filter(Boolean);

    for (const key of possibleKeys) {
      if (overrides[key]) {
        matchedFormat = overrides[key];
        break;
      }
    }
    
    if (!matchedFormat && knockoutFormat.default) {
      matchedFormat = knockoutFormat.default;
    }
  }

  // Legacy fallback to simple mapping
  if (!matchedFormat && config.details.matchWinConditions) {
    const legacyValue = config.details.matchWinConditions[round] || config.details.matchWinConditions[String(round)];
    if (legacyValue) {
      matchedFormat = {
        thresholds: [Number(legacyValue)]
      };
    }
  }

  const finalFormat = (matchedFormat ? { ...defaultFormat, ...matchedFormat } : defaultFormat) as MatchFormat & { games?: number };
  
  // Normalize thresholds to be an array
  if (finalFormat.thresholds && !Array.isArray(finalFormat.thresholds)) {
    finalFormat.thresholds = [finalFormat.thresholds as any];
  }
  
  // If games is not explicitly provided, calculate a sensible default based on thresholds.
  // For a threshold of T, you need at least T*2 games to allow for a T-T tie.
  // e.g., T=1.5 -> 3 games (allows 1.5-1.5 tie), T=2.5 -> 5 games (allows 2.5-2.5 tie)
  if (finalFormat.games === undefined) {
    const numericThresholds = finalFormat.thresholds.filter(t => typeof t === 'number') as number[];
    if (numericThresholds.length > 0) {
      const maxThreshold = Math.max(...numericThresholds);
      finalFormat.games = Math.floor(maxThreshold * 2);
    } else {
      finalFormat.games = 2;
    }
  }

  return finalFormat;
}

/**
 * Determines if a match series is decided based on the current score and format.
 */
export function isMatchDecided(
  score: { p1Score: number; p2Score: number; p1Id: number | null; p2Id: number | null },
  format: MatchFormat,
  lastMatch: any
): { decided: boolean; winnerId: number | null } {
  const thresholds = format.thresholds || [1.5];
  
  for (const threshold of thresholds) {
    if (threshold === "armageddon") {
      // Armageddon always decides the match if it has a result
      if (!lastMatch || !lastMatch.result || lastMatch.result === '*' || lastMatch.result === 'P') {
        return { decided: false, winnerId: null };
      }

      if (lastMatch.result === '1-0' || lastMatch.result === '1-0F') return { decided: true, winnerId: lastMatch.whitePlayerId };
      if (lastMatch.result === '0-1' || lastMatch.result === '0-1F') return { decided: true, winnerId: lastMatch.blackPlayerId };
      if (lastMatch.result === '1/2-1/2') {
        // In Armageddon, draw = black wins
        return { decided: true, winnerId: lastMatch.blackPlayerId };
      }
      return { decided: false, winnerId: null };
    }
    
    const t = Number(threshold);
    
    // Standard threshold check
    if (score.p1Score >= t && score.p2Score < t) {
      return { decided: true, winnerId: score.p1Id };
    }
    if (score.p2Score >= t && score.p1Score < t) {
      return { decided: true, winnerId: score.p2Id };
    }
    
    if (score.p1Score >= t && score.p2Score >= t) {
      // Tie at this threshold, continue to next stage if available
      continue;
    }
    
    // Threshold not yet reached by either player, and no tie yet
    return { decided: false, winnerId: null };
  }
  
  return { decided: false, winnerId: null };
}
