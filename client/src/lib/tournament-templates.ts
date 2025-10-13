import type { Tournament } from "@shared/schema";
import type { TournamentConfig, TournamentMode } from "@/lib/tournament-config";

export const TOURNAMENT_TEMPLATE_OPTIONS = [
  {
    id: "basic" as const,
    label: "Basic info",
    description: "Name, city, federation, and date range",
  },
  {
    id: "details" as const,
    label: "Event details",
    description: "Arbiter, rating type, time controls, and rounds",
  },
  {
    id: "schedule" as const,
    label: "Schedule",
    description: "Round timetable and additional events",
  },
  {
    id: "sections" as const,
    label: "Sections",
    description: "Section names and rating ranges",
  },
  {
    id: "entryFees" as const,
    label: "Entry fees",
    description: "Pricing tiers configured per section",
  },
  {
    id: "prizes" as const,
    label: "Prizes",
    description: "Section prize payouts and U-rating caps",
  },
  {
    id: "payments" as const,
    label: "Payment settings",
    description: "Online checkout requirements and offline instructions",
  },
  {
    id: "registers" as const,
    label: "Registration options",
    description: "Signup toggles, limits, and notifications",
  },
  {
    id: "contacts" as const,
    label: "Contacts",
    description: "Chief arbiter and staff contact list",
  },
  {
    id: "pageContent" as const,
    label: "Public page copy",
    description: "Custom content for the tournament landing page",
  },
] as const;

export type TemplateSectionKey = (typeof TOURNAMENT_TEMPLATE_OPTIONS)[number]["id"];

export interface TournamentTemplateSnapshot {
  type: "tournament-template";
  version: 1;
  format: Tournament["format"];
  mode: TournamentMode;
  createdAt: string;
  selected: TemplateSectionKey[];
  data: {
    basic?: TournamentConfig["basic"];
    details?: TournamentConfig["details"];
    schedule?: TournamentConfig["schedule"];
    sections?: TournamentConfig["sections"];
    entryFees?: TournamentConfig["entryFees"];
    prizes?: TournamentConfig["prizes"];
    payments?: TournamentConfig["payments"];
    registers?: TournamentConfig["registers"];
    contacts?: TournamentConfig["contacts"];
    tournamentPageContent?: TournamentConfig["tournamentPageContent"];
  };
}

const cloneConfig = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function buildTournamentTemplateSnapshot(
  config: TournamentConfig,
  format: Tournament["format"],
  mode: TournamentMode,
  sections: TemplateSectionKey[],
): TournamentTemplateSnapshot {
  const data: TournamentTemplateSnapshot["data"] = {};

  sections.forEach((section) => {
    switch (section) {
      case "basic":
        data.basic = cloneConfig(config.basic);
        break;
      case "details":
        data.details = cloneConfig(config.details);
        break;
      case "schedule":
        data.schedule = cloneConfig(config.schedule);
        break;
      case "sections":
        data.sections = cloneConfig(config.sections);
        break;
      case "entryFees":
        data.entryFees = cloneConfig(config.entryFees);
        break;
      case "prizes":
        data.prizes = cloneConfig(config.prizes ?? []);
        break;
      case "payments":
        data.payments = cloneConfig(config.payments);
        break;
      case "registers":
        data.registers = cloneConfig(config.registers);
        break;
      case "contacts":
        data.contacts = cloneConfig(config.contacts ?? []);
        break;
      case "pageContent":
        data.tournamentPageContent = config.tournamentPageContent;
        break;
      default:
        break;
    }
  });

  return {
    type: "tournament-template",
    version: 1,
    format,
    mode,
    createdAt: new Date().toISOString(),
    selected: sections,
    data,
  };
}

export function applyTournamentTemplateSnapshot(
  baseConfig: TournamentConfig,
  snapshot: TournamentTemplateSnapshot,
): TournamentConfig {
  const next: TournamentConfig = {
    ...baseConfig,
    format: snapshot.format ?? baseConfig.format,
    mode: snapshot.mode ?? baseConfig.mode,
  };
  const { data, selected } = snapshot;

  if (selected.includes("basic") && data.basic) {
    next.basic = { ...next.basic, ...cloneConfig(data.basic) };
  }
  if (selected.includes("details") && data.details) {
    next.details = { ...next.details, ...cloneConfig(data.details) };
  }
  if (selected.includes("schedule") && data.schedule) {
    next.schedule = cloneConfig(data.schedule);
  }
  if (selected.includes("sections") && data.sections) {
    next.sections = cloneConfig(data.sections);
  }
  if (selected.includes("entryFees") && data.entryFees) {
    next.entryFees = cloneConfig(data.entryFees);
  }
  if (selected.includes("prizes") && data.prizes) {
    next.prizes = cloneConfig(data.prizes);
  }
  if (selected.includes("payments") && data.payments) {
    next.payments = cloneConfig(data.payments);
  }
  if (selected.includes("registers") && data.registers) {
    next.registers = { ...next.registers, ...cloneConfig(data.registers) };
  }
  if (selected.includes("contacts") && data.contacts) {
    next.contacts = cloneConfig(data.contacts);
  }
  if (selected.includes("pageContent") && typeof data.tournamentPageContent === "string") {
    next.tournamentPageContent = data.tournamentPageContent;
  }

  return next;
}

export function isTournamentTemplateSnapshot(value: unknown): value is TournamentTemplateSnapshot {
  return (
    !!value &&
    typeof value === "object" &&
    (value as TournamentTemplateSnapshot).type === "tournament-template" &&
    (value as TournamentTemplateSnapshot).version === 1 &&
    Array.isArray((value as TournamentTemplateSnapshot).selected)
  );
}
