import { useState, useEffect } from "react";
import { Link } from "wouter";
import { 
  Trophy, 
  Users, 
  Radio, 
  Database,
  Crown,
  Timer,
  ChevronRight
} from "lucide-react";

const CAROUSEL_IMAGES = [
  "/ui_dashboard.png",
  "/ui_bracket.png",
  "/ui_mobile.png"
];

// Custom handwritten-style green checkmark
const HandwrittenCheck = () => (
  <svg 
    className="w-6 h-6 text-green-500 mt-0.5 flex-shrink-0 drop-shadow-sm" 
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
          alt={`Rook Interface ${index + 1}`}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-in-out ${
            index === currentIndex ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}
      {/* Dot indicators */}
      <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 z-10">
        {CAROUSEL_IMAGES.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentIndex(index)}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              index === currentIndex ? "bg-gray-900 w-6" : "bg-gray-400 hover:bg-gray-600 w-1.5"
            }`}
            aria-label={`View interface slide ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="bg-white font-sans text-gray-900 min-h-screen selection:bg-green-100 selection:text-green-900">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="flex justify-between items-center w-full px-6 md:px-12 py-3 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-20 h-20 flex items-center justify-center">
              <img src="/logo.png" alt="Rook Logo" className="w-full h-full object-contain" />
            </div>
            <span className="text-2xl font-bold tracking-tight text-gray-900">Rook</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login">
              <button className="text-gray-600 hover:text-gray-900 font-medium transition-colors hidden sm:block text-sm px-4 py-2 rounded-lg hover:bg-gray-50">
                Sign in
              </button>
            </Link>
            <Link href="/register">
              <button className="bg-gray-900 hover:bg-black text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors shadow-sm">
                Get Started
              </button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="pt-36 pb-20 px-6 max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-[1fr_1fr] gap-16 items-center">
          <div className="max-w-2xl">
            <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6 leading-[1.1] tracking-tight">
              The modern engine for chess tournaments.
            </h1>
            <p className="text-lg text-gray-600 mb-10 leading-relaxed">
              Rook replaces messy spreadsheets and outdated software with a clean, reliable platform. Automate pairings, chat with players, and process entries—all in one place.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/register">
                <button className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3.5 rounded-lg font-medium text-base transition-colors shadow-sm w-full sm:w-auto flex justify-center items-center gap-2">
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

      {/* Feature Checklist Section */}
      <section id="features" className="py-24 bg-gray-50 border-y border-gray-100 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 max-w-2xl mx-auto">
            <h2 className="text-3xl font-bold text-gray-900 mb-4 tracking-tight">Everything you need to run a flawless event.</h2>
            <p className="text-gray-600 text-lg">A comprehensive suite of tools built specifically for directors and competitors.</p>
          </div>
          
          <div className="grid md:grid-cols-2 gap-12">
            {/* Director Features */}
            <div className="bg-white p-10 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-8">
                <Crown className="w-6 h-6 text-blue-600" />
                <h3 className="text-2xl font-semibold text-gray-900">Tournament Directors</h3>
              </div>
              <ul className="space-y-6">
                <li className="flex items-start gap-4">
                  <HandwrittenCheck />
                  <div>
                    <strong className="text-gray-900 block mb-1">Automated Pairings</strong>
                    <p className="text-gray-600 text-sm leading-relaxed">Instantly generate FIDE-compliant Swiss, Round-Robin, or Knockout pairings. Handles color balancing, byes, and late entries automatically.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <HandwrittenCheck />
                  <div>
                    <strong className="text-gray-900 block mb-1">Pairing Predictor</strong>
                    <p className="text-gray-600 text-sm leading-relaxed">Anticipate upcoming matchups based on current standings and Swiss pairing rules before the round begins.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <HandwrittenCheck />
                  <div>
                    <strong className="text-gray-900 block mb-1">Registration Management</strong>
                    <p className="text-gray-600 text-sm leading-relaxed">Seamlessly collect player entries, handle waitlists, track payments, and organize multi-section events with an intuitive form builder.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <HandwrittenCheck />
                  <div>
                    <strong className="text-gray-900 block mb-1">Built-in Messaging</strong>
                    <p className="text-gray-600 text-sm leading-relaxed">Communicate directly with players. Broadcast announcements or message individuals about missing fees or late arrivals.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <HandwrittenCheck />
                  <div>
                    <strong className="text-gray-900 block mb-1">Live USCF & FIDE Sync</strong>
                    <p className="text-gray-600 text-sm leading-relaxed">Direct integration with USCF and FIDE databases. Fetch ratings automatically when adding players for perfect seeding.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <HandwrittenCheck />
                  <div>
                    <strong className="text-gray-900 block mb-1">Stripe & Prize Pools</strong>
                    <p className="text-gray-600 text-sm leading-relaxed">Collect registration fees via credit card. Automatically calculate and distribute prize pools based on final standings.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <HandwrittenCheck />
                  <div>
                    <strong className="text-gray-900 block mb-1">One-Click Publishing</strong>
                    <p className="text-gray-600 text-sm leading-relaxed">Publish pairings and standings to the live public portal instantly. No more printing paper and taping it to the wall.</p>
                  </div>
                </li>
              </ul>
            </div>

            {/* Player Features */}
            <div className="bg-white p-10 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-8">
                <Users className="w-6 h-6 text-blue-600" />
                <h3 className="text-2xl font-semibold text-gray-900">Competitors</h3>
              </div>
              <ul className="space-y-6">
                <li className="flex items-start gap-4">
                  <HandwrittenCheck />
                  <div>
                    <strong className="text-gray-900 block mb-1">Live Mobile Standings</strong>
                    <p className="text-gray-600 text-sm leading-relaxed">Access real-time crosstables, tie-break scores, and board results directly from your phone as soon as matches finish.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <HandwrittenCheck />
                  <div>
                    <strong className="text-gray-900 block mb-1">Instant Pairing Alerts</strong>
                    <p className="text-gray-600 text-sm leading-relaxed">Receive notifications with your table number, opponent, and assigned color the moment pairings drop.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <HandwrittenCheck />
                  <div>
                    <strong className="text-gray-900 block mb-1">Direct Director Chat</strong>
                    <p className="text-gray-600 text-sm leading-relaxed">Message the tournament arbiter directly from your dashboard to report results, request byes, or ask questions.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <HandwrittenCheck />
                  <div>
                    <strong className="text-gray-900 block mb-1">Personal Dashboard</strong>
                    <p className="text-gray-600 text-sm leading-relaxed">A unified portal to track your upcoming tournament registrations, past match history, and Elo rating progression.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <HandwrittenCheck />
                  <div>
                    <strong className="text-gray-900 block mb-1">Digital Check-in</strong>
                    <p className="text-gray-600 text-sm leading-relaxed">Confirm your attendance from your device. Let directors know you are on-site without waiting in registration lines.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <HandwrittenCheck />
                  <div>
                    <strong className="text-gray-900 block mb-1">Player Database & History</strong>
                    <p className="text-gray-600 text-sm leading-relaxed">Store lifetime match history, Elo ratings, and performance stats across every tournament you participate in.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <HandwrittenCheck />
                  <div>
                    <strong className="text-gray-900 block mb-1">Online Registration</strong>
                    <p className="text-gray-600 text-sm leading-relaxed">Browse and register for open events, pay entry fees online, and receive confirmation — all without emailing a director.</p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Formats Section */}
      <section className="py-24 bg-white px-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4 tracking-tight">Flexible formats.</h2>
            <p className="text-lg text-gray-600">The Rook pairing engine supports standard and custom tournament structures.</p>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-6 rounded-xl border border-gray-200 bg-gray-50/50 hover:bg-gray-50 transition-colors">
              <div className="w-10 h-10 bg-white border border-gray-200 text-gray-900 rounded-lg flex items-center justify-center mb-4 shadow-sm">
                <Database className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-gray-900 mb-2">Swiss System</h4>
              <p className="text-sm text-gray-600">The standard for open events. Efficiently finds a winner without eliminating players.</p>
            </div>
            <div className="p-6 rounded-xl border border-gray-200 bg-gray-50/50 hover:bg-gray-50 transition-colors">
              <div className="w-10 h-10 bg-white border border-gray-200 text-gray-900 rounded-lg flex items-center justify-center mb-4 shadow-sm">
                <Radio className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-gray-900 mb-2">Round Robin</h4>
              <p className="text-sm text-gray-600">Perfect for invitationals. Every player faces off against the rest of the field.</p>
            </div>
            <div className="p-6 rounded-xl border border-gray-200 bg-gray-50/50 hover:bg-gray-50 transition-colors">
              <div className="w-10 h-10 bg-white border border-gray-200 text-gray-900 rounded-lg flex items-center justify-center mb-4 shadow-sm">
                <Trophy className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-gray-900 mb-2">Knockout Brackets</h4>
              <p className="text-sm text-gray-600">High-stakes elimination formats that automatically advance the winners.</p>
            </div>
            <div className="p-6 rounded-xl border border-gray-200 bg-gray-50/50 hover:bg-gray-50 transition-colors">
              <div className="w-10 h-10 bg-white border border-gray-200 text-gray-900 rounded-lg flex items-center justify-center mb-4 shadow-sm">
                <Timer className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-gray-900 mb-2">Arena Mode</h4>
              <p className="text-sm text-gray-600">Continuous play. Finish a game and immediately pair with a new opponent.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 w-full py-16 text-gray-400">
        <div className="w-full flex flex-col md:flex-row justify-between items-start md:items-center gap-8 px-6 md:px-12 max-w-7xl mx-auto border-b border-gray-800 pb-16">
          <div className="flex flex-col gap-4">
            <span className="text-xl font-bold text-white flex items-center gap-3">
              <div className="w-10 h-10 bg-white rounded flex items-center justify-center p-1">
                <img src="/logo.png" alt="Rook Logo" className="w-full h-full object-contain" />
              </div>
              Rook
            </span>
            <p className="text-sm max-w-sm">The modern operating system for competitive play. Build, manage, and scale your chess events.</p>
          </div>
          <div className="flex gap-4">
             <Link href="/register">
                <button className="bg-white text-gray-900 hover:bg-gray-100 px-6 py-2.5 rounded-lg font-medium text-sm transition-colors">
                    Get Started
                </button>
             </Link>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 md:px-12 mt-8 text-sm flex flex-col sm:flex-row justify-between items-center text-gray-500">
          <p>© 2026 Rook. All rights reserved.</p>
          <div className="flex gap-6 mt-4 sm:mt-0">
            <a href="#" className="hover:text-gray-300 transition-colors">Privacy</a>
            <a href="#" className="hover:text-gray-300 transition-colors">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}


