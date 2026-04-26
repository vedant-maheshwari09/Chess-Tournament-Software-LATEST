import { useEffect, useState } from "react";

export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 bg-[#fafafa] dark:bg-slate-950 overflow-hidden pointer-events-none">
      <style>{`
        @keyframes float {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(15px, -15px); }
        }
        .animate-float {
          animation: float 60s ease-in-out infinite;
          will-change: transform;
        }
      `}</style>

      {/* Container larger than viewport to hide edges during float */}
      <div className="absolute inset-[-100px]">
        <div
          className="absolute inset-0 animate-float"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(148, 163, 184, 0.53) 1.30px, transparent 1.30px)",
            backgroundSize: "32px 32px",
          }}
        />
      </div>
    </div>
  );
}
