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
  fideRated: boolean;
  uscfRated: boolean;
  disableSms: boolean;
  hideTeams: boolean;
  notifyPairingsEmail: boolean;
  notifyPairingsSms: boolean;
  playerLimit?: number | null;
  byeLimit?: number | null;
  earlyBirdDetails?: string;
  paymentDetails?: string;
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
  zipCode?: string;
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
  section: string;
  ratingMin: number | null;
  ratingMax: number | null;
  amount: number;
  currency: string;
  notes?: string;
}

export interface TournamentConfig {
  version: "v2";
  mode: TournamentMode;
  format: Tournament["format"];
  basic: {
    name: string;
    city: string;
    federation: string;
    startDate: string | null;
    endDate: string | null;
    description: string;
  };
  details: {
    chiefArbiter: string;
    timeControl: TimeControlType;
    timeControls: TimeControlDefinition[];
    pairingSystem: string;
    rounds: number;
    tiebreakSystem: string;
    ratingType: string;
  };
  schedule: ScheduleEvent[];
  entryFees: EntryFeeRule[];
  registers: RegistersConfig;
  fide: FideRegistrationData;
  uscf: UscfReportData;
  chessResults: ChessResultsConfig;
  contacts: ContactEntry[];
  tournamentPageContent: string;
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
  const defaultRounds = format === "roundrobin" ? 9 : DEFAULT_SCHEDULE_ROUNDS;
  const defaultTimeControl: TimeControlDefinition = {
    minutes: format === "knockout" ? 25 : 90,
    addonType: "increment" satisfies TimeAddonType,
    addonValue: format === "knockout" ? 10 : 30,
  };
  return {
    version: "v2",
    mode,
    format,
    basic: {
      name: "",
      city: "",
      federation: "United States",
      startDate: null,
      endDate: null,
      description: "",
    },
    details: {
      chiefArbiter: "",
      timeControl: "standard",
      timeControls: [defaultTimeControl],
      pairingSystem: format === "roundrobin" ? "Round Robin" : "Swiss System",
      rounds: defaultRounds,
      tiebreakSystem: "rating",
      ratingType: "standard",
    },
    schedule: createDefaultSchedule(defaultRounds),
    entryFees: [],
    registers: {
      showOnCalendar: false,
      allowSignup: false,
      fideRated: mode === "rated",
      uscfRated: mode === "rated",
      disableSms: false,
      hideTeams: false,
      notifyPairingsEmail: true,
      notifyPairingsSms: false,
      playerLimit: null,
      byeLimit: null,
      earlyBirdDetails: "",
      paymentDetails: "",
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
      zipCode: "",
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
  };
}

export function parseTournamentConfig(tournament: Tournament): TournamentConfig {
  const raw = tournament.roundTimings as any;
  if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.version === "v2") {
    const parsed = raw as TournamentConfig;
    const rawMode = (parsed as any)?.mode;
    const normalizedMode: TournamentMode =
      rawMode === "online" || rawMode === "unrated" || rawMode === "rated"
        ? rawMode
        : rawMode === "casual"
        ? "unrated"
        : "rated";
    const normalizedTimeControls = Array.isArray(parsed.details?.timeControls)
      ? parsed.details.timeControls.map((control) => ({
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

    const sanitizedEntryFees = sanitizeEntryFees((parsed as any)?.entryFees);

    return {
      ...createDefaultConfig(tournament.format, normalizedMode ?? "rated"),
      ...parsed,
      details: {
        ...createDefaultConfig(tournament.format, normalizedMode ?? "rated").details,
        ...parsed.details,
        timeControls: normalizedTimeControls,
      },
      registers: {
        ...createDefaultConfig(tournament.format, normalizedMode ?? "rated").registers,
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
      },
      fide: {
        ...createDefaultConfig(tournament.format, normalizedMode ?? "rated").fide,
        ...parsed.fide,
      },
      uscf: {
        ...createDefaultConfig(tournament.format, normalizedMode ?? "rated").uscf,
        ...parsed.uscf,
      },
      chessResults: {
        ...createDefaultConfig(tournament.format, normalizedMode ?? "rated").chessResults,
        ...parsed.chessResults,
        autoSyncIntervalMinutes:
          parsed.chessResults?.autoSyncIntervalMinutes && Number.isFinite(parsed.chessResults.autoSyncIntervalMinutes)
            ? parsed.chessResults.autoSyncIntervalMinutes
            : createDefaultConfig(tournament.format, normalizedMode ?? "rated").chessResults.autoSyncIntervalMinutes,
      },
      entryFees: sanitizedEntryFees,
      mode: normalizedMode,
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
    entryFees: [],
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

  return {
    ...config,
    details: {
      ...config.details,
      rounds,
    },
    schedule: adjustedSchedule,
    entryFees: sanitizedEntryFees,
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
  const section = typeof raw?.section === "string" ? raw.section.trim() : "";
  const ratingMin = coerceNullableNumber(raw?.ratingMin);
  const ratingMax = coerceNullableNumber(raw?.ratingMax);
  const amount = coerceAmount(raw?.amount);
  const currency = typeof raw?.currency === "string" && raw.currency.trim() ? raw.currency.trim().toUpperCase() : "USD";
  const notes = typeof raw?.notes === "string" && raw.notes.trim() ? raw.notes.trim() : undefined;
  return {
    id,
    section,
    ratingMin,
    ratingMax,
    amount,
    currency,
    notes,
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

function generateEntryFeeId(): string {
  const globalCrypto = typeof globalThis !== "undefined" ? (globalThis as any).crypto : undefined;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return globalCrypto.randomUUID();
  }
  return `fee-${Math.random().toString(36).slice(2, 10)}`;
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
    location: serialized.basic.city,
    useQuickSetup: false,
  };
}
