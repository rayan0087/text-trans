import React from 'react';

interface AudioVisualizerProps {
  isRecording: boolean;
  isPaused: boolean;
  audioLevel?: number; // 0 - 100
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isRecording, isPaused, audioLevel = 0 }) => {
  if (!isRecording && !isPaused) {
    return (
      <div className="flex items-center gap-1 h-6">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="w-1 bg-slate-300 dark:bg-slate-700 rounded-full h-1.5" />
        ))}
      </div>
    );
  }

  if (isPaused) {
    return (
      <div className="flex items-center gap-1 h-6">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="w-1 bg-amber-400 dark:bg-amber-500 rounded-full h-3" />
        ))}
      </div>
    );
  }

  // Active recording: height scales with real detected mic volume / audioLevel
  // Calculate dynamic bar heights based on level
  const baseBoost = Math.max(0, audioLevel / 100);
  const barHeights = [
    Math.max(4, Math.round(12 + baseBoost * 12)),
    Math.max(6, Math.round(20 + baseBoost * 16)),
    Math.max(4, Math.round(16 + baseBoost * 14)),
    Math.max(5, Math.round(22 + baseBoost * 18)),
    Math.max(4, Math.round(10 + baseBoost * 10)),
  ];

  return (
    <div className="flex items-center gap-1 h-7 px-1.5 py-0.5 bg-rose-50/70 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/50 rounded-lg" title={`Sensitivitas Mic: ${audioLevel}%`}>
      {barHeights.map((h, i) => (
        <div
          key={i}
          className="w-1 bg-rose-500 rounded-full transition-all duration-75 ease-out"
          style={{ height: `${Math.min(24, h)}px` }}
        />
      ))}
    </div>
  );
};
