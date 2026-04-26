import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  Trophy,
  Users,
  Crown,
  ChevronRight,
  LayoutGrid,
  RotateCw,
  Zap,
} from "lucide-react";

const CAROUSEL_IMAGES = [
  "/ui_dashboard.png",
  "/ui_bracket.png",
  "/ui_mobile.png",
];

const HandwrittenCheck = () => (
  <svg
    className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 13c1.5 1.5 3 3.5 4 5 3-6 8-10 11-12" />
  </svg>
);

const Dot = () => (
  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0 mt-2" />
);

function HeroCarousel() {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % CAROUSEL_IMAGES.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative w-full h-[500px] rounded-xl overflow-hidden border border-gray-200 bg-gray-50 shadow-2xl">
      {CAROUSEL_IMAGES.map((src, index) => (
        <img
          key={index}
          src={src}
          alt={`ChessSoftware Interface ${index + 1}`}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-in-out ${index === currentIndex ? "opacity-100" : "opacity-0"
            }`}
        />
      ))}
      <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 z-10">
        {CAROUSEL_IMAGES.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentIndex(index)}
            className={`h-1.5 rounded-full transition-all duration-300 ${index === currentIndex
              ? "bg-gray-900 w-6"
              : "bg-gray-400 hover:bg-gray-600 w-1.5"
              }`}
            aria-label={`Slide ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}

const FORMATS = [
  {
    icon: <LayoutGrid className="w-6 h-6 text-blue-600" />,
    name: "Swiss System",
    desc: "The open-event standard. Finds a winner without eliminating players.",
    features: [
      "FIDE-compliant color balancing",
      "Automatic bye assignment",
      "Buchholz & Sonneborn-Berger tie-breaks",
      "Late entry support",
    ],
  },
  {
    icon: <Users className="w-6 h-6 text-indigo-600" />,
    name: "Round Robin",
    desc: "Perfect for invitationals. Every player faces the entire field.",
    features: [
      "Full schedule auto-generation",
      "Double round-robin option",
      "Complete crosstable tracking",
      "Tied score detection",
    ],
  },
  {
    icon: <Trophy className="w-6 h-6 text-amber-600" />,
    name: "Knockout Brackets",
    desc: "Win to advance, lose and you're out.",
    features: [
      "Seeded bracket generation",
      "Automatic winner advancement",
      "Optional consolation bracket",
      "Best-of-N match series",
    ],
  },
  {
    icon: <Zap className="w-6 h-6 text-orange-600" />,
    name: "Arena Mode",
    desc: "Continuous play. Finish and immediately get re-paired.",
    features: [
      "Smart continuous re-pairing",
      "Live points leaderboard",
      "Configurable session duration",
      "Anti-repeat opponent logic",
    ],
  },
];

export default function LandingPage() {
  return (
    <div className="bg-transparent font-sans text-gray-900 min-h-screen selection:bg-green-100 selection:text-green-900 relative">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="flex justify-between items-center w-full px-6 md:px-12 py-3 max-w-7xl mx-auto">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="ChessSoftware Logo" className="w-12 h-12 object-contain" />
            <span className="text-2xl font-bold tracking-tight text-gray-900">ChessSoftware</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login">
              <button className="bg-gray-900 hover:bg-black text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors shadow-sm">
                Sign in
              </button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <main className="pt-36 pb-20 px-6 max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-[1fr_1fr] gap-16 items-center">
          <div className="max-w-2xl">
            <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6 leading-[1.1] tracking-tight">
              The modern engine for chess tournaments.
            </h1>
            <p className="text-xl text-gray-500 mb-10 leading-relaxed">
              ChessSoftware replaces messy spreadsheets and outdated software with a clean, reliable platform. Automate pairings, communicate with players, and process entries — all in one place.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/register">
                <button className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3.5 rounded-lg font-medium text-base transition-colors shadow-sm flex items-center gap-2">
                  Get Started <ChevronRight className="w-4 h-4" />
                </button>
              </Link>
            </div>
          </div>
          <div className="hidden lg:block relative">
            <HeroCarousel />
          </div>
        </div>
      </main>

      {/* Flexible Formats */}
      <section className="py-20 border-t border-gray-100 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-10">
            <h2 className="text-4xl font-bold text-gray-900 mb-4 tracking-tight">Flexible formats.</h2>
            <p className="text-xl text-gray-500">The ChessSoftware engine supports every standard tournament structure.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FORMATS.map((f) => (
              <div key={f.name} className="p-7 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors flex flex-col gap-4 shadow-sm">
                <div>
                  <div className="mb-3">{f.icon}</div>
                  <h4 className="font-bold text-gray-900 text-xl mb-1">{f.name}</h4>
                  <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
                </div>
                <ul className="space-y-2 border-t border-gray-200 pt-4">
                  {f.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2">
                      <Dot />
                      <span className="text-sm text-gray-500 leading-snug">{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Built for every role */}
      <section id="features" className="py-20 border-y border-gray-100 px-6">
        <div className="max-w-7xl mx-auto">

          <div className="text-center mb-14 max-w-xl mx-auto">
            <h2 className="text-4xl font-bold text-gray-900 mb-4 tracking-tight">Built for every role.</h2>
            <p className="text-gray-500 text-xl">Purpose-built tools for directors, players, and everyone on the platform.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">

            {/* Directors */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-7 py-5 border-b border-gray-100 bg-gray-50/70 flex items-start gap-3">
                <Crown className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-gray-900 text-sm">Tournament Directors</p>
                  <p className="text-xs text-gray-400 mt-0.5">Run, manage, and organize your events</p>
                </div>
              </div>
              <ul className="divide-y divide-gray-100">
                {[
                  "Player Registration & Waitlist Management",
                  "Stripe Entry Fee Collection",
                  "Automated Prize Pool Distribution",
                  "Player On-Site Check-in Oversight",
                  "Multi-Section Event Management",
                  "Broadcast Announcements to All Players",
                  "Direct Messaging with Individual Players",
                ].map((name) => (
                  <li key={name} className="px-7 py-3.5 flex gap-3 items-center">
                    <HandwrittenCheck />
                    <p className="text-gray-800 text-sm">{name}</p>
                  </li>
                ))}
              </ul>
            </div>

            {/* Players */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-7 py-5 border-b border-gray-100 bg-gray-50/70 flex items-start gap-3">
                <Users className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-gray-900 text-sm">Players</p>
                  <p className="text-xs text-gray-400 mt-0.5">Compete, track, and stay informed</p>
                </div>
              </div>
              <ul className="divide-y divide-gray-100">
                {[
                  "Next-Round Pairing Predictor",
                  "Opt-in Pairing Notifications",
                  "Online Registration & Entry Fee Payment",
                  "Digital On-Site Check-in",
                  "Personal Match History",
                  "Elo Rating Progression Tracking",
                  "Direct Messaging with Tournament Director",
                ].map((name) => (
                  <li key={name} className="px-7 py-3.5 flex gap-3 items-center">
                    <HandwrittenCheck />
                    <p className="text-gray-800 text-sm">{name}</p>
                  </li>
                ))}
              </ul>
            </div>

          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 w-full py-16 text-gray-400">
        <div className="w-full flex flex-col md:flex-row justify-between items-start md:items-center gap-8 px-6 md:px-12 max-w-7xl mx-auto border-b border-gray-800 pb-16">
          <div className="flex flex-col gap-3">
            <span className="text-xl font-bold text-white flex items-center gap-3">
              <img src="/logo.png" alt="ChessSoftware Logo" className="w-10 h-10 object-contain" />
              ChessSoftware
            </span>
            <p className="text-sm max-w-sm">The modern operating system for competitive chess. Build, manage, and scale your events.</p>
          </div>
          <Link href="/register">
            <button className="bg-white text-gray-900 hover:bg-gray-100 px-6 py-2.5 rounded-lg font-medium text-sm transition-colors">
              Get Started
            </button>
          </Link>
        </div>
        <div className="max-w-7xl mx-auto px-6 md:px-12 mt-8 text-sm flex flex-col sm:flex-row justify-between items-center text-gray-500">
          <p>© 2026 ChessSoftware. All rights reserved.</p>
          <div className="flex gap-6 mt-4 sm:mt-0">
            <a href="#" className="hover:text-gray-300 transition-colors">Privacy</a>
            <a href="#" className="hover:text-gray-300 transition-colors">Terms</a>
          </div>
        </div>
      </footer>

    </div>
  );
}
