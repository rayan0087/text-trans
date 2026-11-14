import React, { useRef } from 'react';
import { Mic, Pause, Play, Square, Loader2, Upload } from 'lucide-react';
import { type SpeechState } from '../services/speechRecognition';
import { AudioVisualizer } from './AudioVisualizer';
import { formatDuration } from '../services/exportService';

export type TranscriptionEngine = 'browser' | 'whisper';

interface RecordingControlsProps {
  speechState: SpeechState;
  durationSeconds: number;
  language: string;
  onLanguageChange: (lang: string) => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  isSupported?: boolean;
  engine?: TranscriptionEngine;
  onEngineChange?: (engine: TranscriptionEngine) => void;
  isTranscribingWhisper: boolean;
  onUploadAudio?: (file: File) => void;
  isUploadingAudio?: boolean;
  audioLevel?: number;
}

export const RecordingControls: React.FC<RecordingControlsProps> = ({
  speechState,
  durationSeconds,
  language,
  onLanguageChange,
  onStart,
  onPause,
  onResume,
  onStop,
  isTranscribingWhisper,
  onUploadAudio,
  isUploadingAudio = false,
  audioLevel = 0,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadAudio) {
      onUploadAudio(file);
    }
    if (e.target) e.target.value = '';
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-4 flex flex-wrap items-center justify-between gap-4 transition-colors">
      {/* Left side: Status badge, Engine badge & Timer */}
      <div className="flex items-center flex-wrap gap-3 sm:gap-4">
        <div className="flex items-center gap-2">
          {speechState === 'recording' && (
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
            </span>
          )}
          {speechState === 'paused' && (
            <span className="inline-flex rounded-full h-3 w-3 bg-amber-400"></span>
          )}
          {speechState === 'idle' && (
            <span className="inline-flex rounded-full h-3 w-3 bg-slate-300 dark:bg-slate-700"></span>
          )}

          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {speechState === 'recording' ? 'Merekam...' : speechState === 'paused' ? 'Dijeda' : 'Siap'}
          </span>
        </div>

        {/* Audio Visualizer with live volume sensitivity */}
        <AudioVisualizer isRecording={speechState === 'recording'} isPaused={speechState === 'paused'} audioLevel={audioLevel} />

        {/* Timer display */}
        <div className="font-mono text-base font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-lg">
          {formatDuration(durationSeconds)}
        </div>

        {/* Dynamic Mic Level Badge with Live Percentage & Liquid Fill */}
        <div 
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all duration-150 ${
            speechState === 'recording'
              ? 'bg-rose-50/90 dark:bg-rose-950/50 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-400 shadow-xs ring-2 ring-rose-500/20'
              : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500'
          }`}
          title={speechState === 'recording' ? `Level Suara: ${audioLevel}%` : 'Mikrofon Siap'}
        >
          {/* Mic icon with dynamic vertical red liquid fill based on audioLevel */}
          <div className="relative w-4 h-4 flex items-center justify-center shrink-0">
            {/* Background base icon */}
            <Mic className={`w-4 h-4 ${speechState === 'recording' ? 'text-rose-200 dark:text-rose-900' : 'text-slate-400 dark:text-slate-600'}`} />
            
            {/* Overlay filled icon (red) clipped from bottom according to audioLevel */}
            {speechState === 'recording' && (
              <div 
                className="absolute inset-0 overflow-hidden transition-all duration-75 ease-out"
                style={{
                  clipPath: `inset(${Math.max(0, 100 - Math.min(100, Math.round(15 + (audioLevel / 100) * 85)))}% 0 0 0)`
                }}
              >
                <Mic className="w-4 h-4 text-rose-600 fill-rose-600 drop-shadow-[0_0_4px_rgba(225,29,72,0.5)]" />
              </div>
            )}
          </div>

          {/* Real-time Percentage Indicator */}
          {speechState === 'recording' ? (
            <span className="font-mono text-[11px] font-bold text-rose-600 dark:text-rose-400 tabular-nums min-w-[28px]">
              {audioLevel}%
            </span>
          ) : (
            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">Mic</span>
          )}
        </div>

        {isTranscribingWhisper && (
          <div className="flex items-center gap-2 px-3 py-1 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-semibold rounded-lg animate-pulse">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Mentranskrip dengan Whisper AI...</span>
          </div>
        )}
      </div>

      {/* Right side: Action Buttons */}
      <div className="flex items-center gap-2.5">
        {speechState === 'idle' && (
          <>
            <button
              onClick={onStart}
              disabled={isTranscribingWhisper || isUploadingAudio}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-sm font-semibold shadow-md shadow-rose-200 dark:shadow-none hover:shadow-rose-300 transition-all active:scale-95 disabled:opacity-50"
            >
              <Mic className="w-4 h-4" />
              <span>Mulai Rekam</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isTranscribingWhisper || isUploadingAudio}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800 rounded-xl text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 shadow-xs"
              title="Unggah file rekaman audio (.mp3, .wav, .m4a, .webm, .mp4, dll) untuk ditranskripsi"
            >
              {isUploadingAudio ? (
                <Loader2 className="w-4 h-4 animate-spin text-indigo-600 dark:text-indigo-400" />
              ) : (
                <Upload className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              )}
              <span>{isUploadingAudio ? 'Memproses...' : 'Unggah Audio'}</span>
            </button>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="audio/*,video/mp4,video/webm,.mp3,.wav,.m4a,.ogg,.webm,.mp4"
              className="hidden"
            />
          </>
        )}

        {speechState === 'recording' && (
          <>
            <button
              onClick={onPause}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold shadow-md shadow-amber-200 dark:shadow-none transition-all active:scale-95"
            >
              <Pause className="w-4 h-4" />
              <span>Jeda</span>
            </button>
            <button
              onClick={onStop}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white rounded-xl text-sm font-semibold shadow-md shadow-slate-300 dark:shadow-none transition-all active:scale-95"
            >
              <Square className="w-4 h-4" />
              <span>Selesai Rekam</span>
            </button>
          </>
        )}

        {speechState === 'paused' && (
          <>
            <button
              onClick={onResume}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold shadow-md shadow-emerald-200 dark:shadow-none transition-all active:scale-95"
            >
              <Play className="w-4 h-4" />
              <span>Lanjut</span>
            </button>
            <button
              onClick={onStop}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white rounded-xl text-sm font-semibold shadow-md shadow-slate-300 dark:shadow-none transition-all active:scale-95"
            >
              <Square className="w-4 h-4" />
              <span>Selesai Rekam</span>
            </button>
          </>
        )}

        {/* Language Selector is made invisible as requested (defaults fixed to Indonesian id-ID) */}
        <select
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
          className="hidden"
          aria-hidden="true"
        >
          <option value="id-ID">Indonesia</option>
        </select>
      </div>
    </div>
  );
};
