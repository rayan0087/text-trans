import React from 'react';

interface AudioVisualizerProps {
  isRecording: boolean;
  isPaused: boolean;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isRecording, isPaused }) => {
  if (!isRecording && !isPaused) {
    return (
      <div className="flex items-center gap-1 h-6">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="w-1 bg-slate-300 rounded-full h-1.5" />
        ))}
      </div>
    );
  }

  if (isPaused) {
    return (
      <div className="flex items-center gap-1 h-6">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="w-1 bg-amber-400 rounded-full h-3" />
        ))}
      </div>
    );
  }

  // Active recording animation
  return (
    <div className="flex items-center gap-1 h-6">
      <div className="w-1 bg-rose-500 rounded-full h-3 animate-pulse" style={{ animationDuration: '0.6s' }} />
      <div className="w-1 bg-rose-500 rounded-full h-6 animate-pulse" style={{ animationDuration: '0.4s' }} />
      <div className="w-1 bg-rose-500 rounded-full h-4 animate-pulse" style={{ animationDuration: '0.7s' }} />
      <div className="w-1 bg-rose-500 rounded-full h-5 animate-pulse" style={{ animationDuration: '0.5s' }} />
      <div className="w-1 bg-rose-500 rounded-full h-2 animate-pulse" style={{ animationDuration: '0.65s' }} />
    </div>
  );
};
