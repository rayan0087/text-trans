import React from 'react';
import { Mic, Pause, Play, Square, Globe2, AlertTriangle, Sparkles, Zap, Loader2 } from 'lucide-react';
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
  isSupported: boolean;
  engine: TranscriptionEngine;
  onEngineChange: (engine: TranscriptionEngine) => void;
  isTranscribingWhisper: boolean;
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
  isSupported,
  engine,
  onEngineChange,
  isTranscribingWhisper,
}) => {
  if (!isSupported && engine === 'browser') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3 text-amber-800 text-xs">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
        <div>
          <p className="font-semibold text-amber-900">Browser Tidak Mendukung Web Speech API</p>
          <p className="mt-0.5">
            Gunakan mode <strong>Whisper AI</strong> atau buka di <strong>Google Chrome / Edge</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-4 flex flex-wrap items-center justify-between gap-4">
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
            <span className="inline-flex rounded-full h-3 w-3 bg-slate-300"></span>
          )}

          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {speechState === 'recording' ? 'Merekam...' : speechState === 'paused' ? 'Dijeda' : 'Siap'}
          </span>
        </div>

        {/* Audio Visualizer */}
        <AudioVisualizer isRecording={speechState === 'recording'} isPaused={speechState === 'paused'} />

        {/* Timer display */}
        <div className="font-mono text-base font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-lg">
          {formatDuration(durationSeconds)}
        </div>

        {/* Engine Switcher */}
        <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200/70 text-xs font-semibold">
          <button
            type="button"
            disabled={speechState !== 'idle'}
            onClick={() => onEngineChange('browser')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all ${
              engine === 'browser'
                ? 'bg-white text-slate-800 shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
            title="Browser Web Speech API: Instan & 100% Gratis"
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>Browser</span>
          </button>
          <button
            type="button"
            disabled={speechState !== 'idle'}
            onClick={() => onEngineChange('whisper')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all ${
              engine === 'whisper'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-500 hover:text-indigo-600'
            }`}
            title="Whisper AI: Akurasi Tinggi (Groq/OpenAI/Gemini)"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
            <span>Whisper AI</span>
          </button>
        </div>

        {isTranscribingWhisper && (
          <div className="flex items-center gap-2 px-3 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold rounded-lg animate-pulse">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Mentranskrip dengan Whisper AI...</span>
          </div>
        )}
      </div>

      {/* Right side: Action Buttons & Language */}
      <div className="flex items-center gap-2.5">
        {speechState === 'idle' && (
          <button
            onClick={onStart}
            disabled={isTranscribingWhisper}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-sm font-semibold shadow-md shadow-rose-200 hover:shadow-rose-300 transition-all active:scale-95 disabled:opacity-50"
          >
            <Mic className="w-4 h-4" />
            <span>Mulai Rekam</span>
          </button>
        )}

        {speechState === 'recording' && (
          <>
            <button
              onClick={onPause}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold shadow-md shadow-amber-200 transition-all active:scale-95"
            >
              <Pause className="w-4 h-4" />
              <span>Jeda</span>
            </button>
            <button
              onClick={onStop}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-semibold shadow-md shadow-slate-300 transition-all active:scale-95"
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
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold shadow-md shadow-emerald-200 transition-all active:scale-95"
            >
              <Play className="w-4 h-4" />
              <span>Lanjut</span>
            </button>
            <button
              onClick={onStop}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-semibold shadow-md shadow-slate-300 transition-all active:scale-95"
            >
              <Square className="w-4 h-4" />
              <span>Selesai Rekam</span>
            </button>
          </>
        )}

        {/* Language Selector */}
        <div className="flex items-center gap-1.5 ml-2 pl-3 border-l border-slate-200">
          <Globe2 className="w-4 h-4 text-slate-400" />
          <select
            value={language}
            onChange={(e) => onLanguageChange(e.target.value)}
            disabled={speechState !== 'idle'}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 cursor-pointer"
          >
            <option value="id-ID">🇮🇩 Indonesia</option>
            <option value="en-US">🇺🇸 English</option>
          </select>
        </div>
      </div>
    </div>
  );
};
