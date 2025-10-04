import type { Tournament } from "@shared/schema";

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
  passwordPin?: string;
  notifyPairingsEmail: boolean;
  notifyPairingsSms: boolean;
  playerLimit?: number | null;
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

export interface ChessResultsConfig {
  syncMode: "disabled" | "manual" | "automatic";
  exportMode: "page" | "participants" | "participants_standings" | "participants_standings_rounds";
}

export interface ContactEntry {
  id: string;
  name: string;
  role: string;
  phone?: string;
  email?: string;
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
    addonType: "increment" as TimeAddonType,
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
    registers: {
      showOnCalendar: false,
      allowSignup: false,
      fideRated: mode === "rated",
      uscfRated: mode === "rated",
      disableSms: false,
      hideTeams: false,
      passwordPin: "",
      notifyPairingsEmail: true,
      notifyPairingsSms: false,
      playerLimit: null,
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

    // Ensure defaults for missing fields (for backward compatibility)
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
      },
      mode: normalizedMode,
    };
  }

  // Legacy handling: roundTimings stored as array
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
  };
}

export function serializeTournamentConfig(config: TournamentConfig): TournamentConfig {
  // Ensure rounds align with schedule length when possible
  const rounds = config.details.rounds;
  const adjustedSchedule = config.schedule.map((event, index) => ({
    ...event,
    round: event.round ?? index + 1,
    id: event.id || `${index + 1}`,
  }));

  return {
    ...config,
    details: {
      ...config.details,
      rounds,
    },
    schedule: adjustedSchedule,
  };
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
