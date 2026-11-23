import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Check,
  FileText,
  CheckSquare,
  Trash,
  MessageSquare,
  Edit3,
  UserCheck,
  Play,
  Pause,
  Volume2,
  Download,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import { type TranscriptLineTiming } from '../db';
import { formatDuration } from '../services/exportService';

interface TranscriptEditorProps {
  title: string;
  onTitleChange: (newTitle: string) => void;
  content: string;
  interimContent: string;
  onContentChange: (newContent: string) => void;
  isRecording: boolean;
  durationSeconds?: number;
  audioBlob?: Blob | null;
  lineTimings?: TranscriptLineTiming[];
  aiSummary?: string;
  aiActionItems?: string;
  onClearAiSummary?: () => void;
  onClearAiActions?: () => void;
}

export const TranscriptEditor: React.FC<TranscriptEditorProps> = ({
  title,
  onTitleChange,
  content,
  interimContent,
  onContentChange,
  isRecording,
  durationSeconds = 0,
  audioBlob,
  lineTimings = [],
  aiSummary,
  aiActionItems,
  onClearAiSummary,
  onClearAiActions,
}) => {
  const [viewMode, setViewMode] = useState<'dialog' | 'raw'>('dialog');
  const [editingSpeakerOld, setEditingSpeakerOld] = useState<string | null>(null);
  const [editingSpeakerNew, setEditingSpeakerNew] = useState('');

  // Audio Playback & Sync States
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lineElementRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  // Split lines for dialog view
  const lines = useMemo(
    () => content.split('\n').filter((l) => l.trim().length > 0),
    [content]
  );

  // Manage audio Object URL lifecycle
  useEffect(() => {
    if (!audioBlob || audioBlob.size === 0) {
      setAudioUrl(null);
      setIsPlayingAudio(false);
      setCurrentTime(0);
      setAudioDuration(0);
      return;
    }

    const url = URL.createObjectURL(audioBlob);
    setAudioUrl(url);
    setIsPlayingAudio(false);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [audioBlob]);

  // Stop audio playback if user starts/resumes live recording
  useEffect(() => {
    if (isRecording && audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setIsPlayingAudio(false);
    }
  }, [isRecording]);

  // Effective total duration (handles WebM blobs that report Infinity in HTMLAudioElement)
  const effectiveDuration = useMemo(() => {
    if (Number.isFinite(audioDuration) && audioDuration > 0) {
      return audioDuration;
    }
    const maxTimingEnd =
      lineTimings.length > 0
        ? Math.max(...lineTimings.map((t) => t.endTime || 0))
        : 0;
    return Math.max(durationSeconds, maxTimingEnd, 1);
  }, [audioDuration, durationSeconds, lineTimings]);

  /**
   * Maps every dialog line (0..lines.length-1) to an accurate { startTime, endTime } window
   * so clicking any line jumps to that exact audio position and playing highlights lines in sequence.
   */
  const resolvedTimings = useMemo(() => {
    if (lines.length === 0) return [];

    // 1. If lineTimings matches lines count closely, align directly or by text match
    const totalDur = Math.max(effectiveDuration, lines.length * 2);
    const result: Array<{ startTime: number; endTime: number }> = [];

    if (lineTimings.length > 0) {
      let searchIdx = 0;
      const matched: Array<{ startTime: number; endTime: number } | null> = lines.map(
        (line) => {
          const cleanLine = line
            .replace(/^(\*\*\[.*?\]\*\*|\[.*?\]).*?:\s*/i, '')
            .trim()
            .toLowerCase();

          // Look ahead from searchIdx for best matching timing entry
          for (let j = searchIdx; j < Math.min(lineTimings.length, searchIdx + 5); j++) {
            const candidate = lineTimings[j].text.trim().toLowerCase();
            if (
              candidate === cleanLine ||
              candidate.includes(cleanLine.slice(0, 18)) ||
              cleanLine.includes(candidate.slice(0, 18))
            ) {
              searchIdx = j + 1;
              return {
                startTime: lineTimings[j].startTime,
                endTime: Math.max(
                  lineTimings[j].startTime + 0.5,
                  lineTimings[j].endTime
                ),
              };
            }
          }
          return null;
        }
      );

      // If direct index mapping is 1:1, fill any unmatched slots by index
      if (lineTimings.length === lines.length) {
        for (let i = 0; i < lines.length; i++) {
          if (!matched[i]) {
            matched[i] = {
              startTime: lineTimings[i].startTime,
              endTime: Math.max(
                lineTimings[i].startTime + 0.5,
                lineTimings[i].endTime
              ),
            };
          }
        }
      }

      // Fill any remaining gaps proportionally
      let lastEnd = 0;
      for (let i = 0; i < lines.length; i++) {
        if (matched[i]) {
          result.push(matched[i]!);
          lastEnd = matched[i]!.endTime;
        } else {
          // Find next matched anchor
          let nextAnchorTime = totalDur;
          let stepsToAnchor = lines.length - i;
          for (let k = i + 1; k < lines.length; k++) {
            if (matched[k]) {
              nextAnchorTime = matched[k]!.startTime;
              stepsToAnchor = k - i;
              break;
            }
          }
          const span = Math.max(0.8, (nextAnchorTime - lastEnd) / stepsToAnchor);
          const start = Number(lastEnd.toFixed(1));
          const end = Number((lastEnd + span).toFixed(1));
          result.push({ startTime: start, endTime: end });
          lastEnd = end;
        }
      }
      return result;
    }

    // 2. Fallback: Distribute duration proportionally by character length of each line
    const charLengths = lines.map((l) => Math.max(8, l.length));
    const totalChars = charLengths.reduce((acc, c) => acc + c, 0);
    let cursor = 0;

    for (let i = 0; i < lines.length; i++) {
      const share = (charLengths[i] / totalChars) * totalDur;
      const start = Number(cursor.toFixed(1));
      const end = Number((cursor + share).toFixed(1));
      result.push({ startTime: start, endTime: Math.max(start + 0.5, end) });
      cursor += share;
    }

    return result;
  }, [lines, lineTimings, effectiveDuration]);

  // Determine which line index is currently active based on audio playback time
  const activePlayingLineIndex = useMemo(() => {
    if (!audioUrl || resolvedTimings.length === 0) return -1;
    if (!isPlayingAudio && currentTime <= 0.05) return -1;

    for (let i = 0; i < resolvedTimings.length; i++) {
      const t = resolvedTimings[i];
      const nextStart =
        i + 1 < resolvedTimings.length ? resolvedTimings[i + 1].startTime : Infinity;
      if (currentTime >= t.startTime - 0.15 && currentTime < Math.max(t.endTime, nextStart)) {
        return i;
      }
    }
    return resolvedTimings.length - 1;
  }, [audioUrl, resolvedTimings, currentTime, isPlayingAudio]);

  // Auto-scroll when new text arrives while recording
  useEffect(() => {
    if (isRecording && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [content, interimContent, isRecording]);

  // Auto-scroll to follow the active highlighted line during audio playback
  useEffect(() => {
    if (isPlayingAudio && activePlayingLineIndex !== -1) {
      const el = lineElementRefs.current[activePlayingLineIndex];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [activePlayingLineIndex, isPlayingAudio]);

  // Audio player controls
  const togglePlayAudio = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch((err) => console.warn('Audio play error:', err));
    } else {
      audio.pause();
    }
  };

  const handlePlayLine = (index: number) => {
    const audio = audioRef.current;
    if (!audio || !resolvedTimings[index]) return;

    const targetStart = resolvedTimings[index].startTime;
    // If clicking the already-playing line, toggle pause
    if (isPlayingAudio && activePlayingLineIndex === index) {
      audio.pause();
      return;
    }

    audio.currentTime = Math.max(0, targetStart);
    setCurrentTime(Math.max(0, targetStart));
    audio.play().catch((err) => console.warn('Line audio play error:', err));
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  const handleSkip = (deltaSec: number) => {
    if (!audioRef.current) return;
    const next = Math.max(0, Math.min(effectiveDuration, audioRef.current.currentTime + deltaSec));
    audioRef.current.currentTime = next;
    setCurrentTime(next);
  };

  const cyclePlaybackRate = () => {
    const rates = [1, 1.25, 1.5, 2];
    const nextRate = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const handleDownloadAudio = () => {
    if (!audioUrl || !audioBlob) return;
    const ext = audioBlob.type.includes('wav')
      ? 'wav'
      : audioBlob.type.includes('mp3')
        ? 'mp3'
        : audioBlob.type.includes('mp4') || audioBlob.type.includes('m4a')
          ? 'm4a'
          : 'webm';
    const sanitized = (title || 'rekaman_percakapan')
      .replace(/[^a-z0-9_-]/gi, '_')
      .toLowerCase();
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `${sanitized}.${ext}`;
    a.click();
  };

  const handleRenameSpeaker = (oldName: string) => {
    if (!editingSpeakerNew.trim() || editingSpeakerNew.trim() === oldName) {
      setEditingSpeakerOld(null);
      return;
    }
    const newName = editingSpeakerNew.trim();
    const escapedOld = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\[${escapedOld}\\]`, 'g');
    const updated = content.replace(regex, `[${newName}]`);
    onContentChange(updated);
    setEditingSpeakerOld(null);
    setEditingSpeakerNew('');
  };

  // Helper to format line with speaker highlight & interactive audio timestamp
  const renderDialogLine = (line: string, index: number) => {
    const speakerRegex =
      /^(\*\*\[.*?\]\*\*|\*\[.*?\]\*|\[.*?\]|Pembicara\s+[A-Za-z0-9]+:?|Mas\s+\w+:?|Pak\s+\w+:?|Bu\s+\w+:?):?\s*(.*)$/i;
    const match = line.match(speakerRegex);
    const timing = resolvedTimings[index];
    const isThisLineActive = activePlayingLineIndex === index;
    const isThisLinePlaying = isThisLineActive && isPlayingAudio;
    const canPlayLine = !!audioUrl && !isRecording;

    const timestampBadge = canPlayLine && timing && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handlePlayLine(index);
        }}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold transition-all cursor-pointer shrink-0 ${
          isThisLinePlaying
            ? 'bg-rose-600 text-white shadow-xs animate-pulse'
            : isThisLineActive
              ? 'bg-rose-100 dark:bg-rose-900/70 text-rose-700 dark:text-rose-300'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-950/80 dark:hover:text-rose-300'
        }`}
        title={
          isThisLinePlaying
            ? 'Jeda pemutaran kalimat ini'
            : `Putar rekaman suara kalimat ini (${formatDuration(Math.floor(timing.startTime))})`
        }
      >
        {isThisLinePlaying ? (
          <Pause className="w-2.5 h-2.5 fill-current" />
        ) : (
          <Play className="w-2.5 h-2.5 fill-current" />
        )}
        <span>{formatDuration(Math.floor(timing.startTime))}</span>
      </button>
    );

    if (match) {
      const speakerName = match[1].replace(/[*\[\]:]/g, '').trim();
      const speechText = match[2];
      const isEditingThis = editingSpeakerOld === speakerName;

      return (
        <div
          key={index}
          ref={(el) => {
            lineElementRefs.current[index] = el;
          }}
          onClick={() => {
            if (canPlayLine && !isEditingThis) handlePlayLine(index);
          }}
          className={`border-l-[3px] pl-3.5 pr-2.5 py-1.5 leading-relaxed transition-all rounded-r-xl group ${
            canPlayLine ? 'cursor-pointer' : ''
          } ${
            isThisLineActive
              ? 'border-rose-500 bg-rose-50/80 dark:bg-rose-950/35 ring-1 ring-rose-500/20 shadow-xs'
              : 'border-sky-400 hover:bg-sky-50/40 dark:hover:bg-sky-950/20'
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              {timestampBadge}
              {isEditingThis ? (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-sky-300 dark:border-sky-600 p-1 rounded-lg shadow-xs"
                >
                  <input
                    type="text"
                    value={editingSpeakerNew}
                    onChange={(e) => setEditingSpeakerNew(e.target.value)}
                    placeholder="Nama Pembicara..."
                    className="text-xs font-semibold px-2 py-0.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded outline-none focus:ring-1 focus:ring-sky-500 w-32"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameSpeaker(speakerName);
                      if (e.key === 'Escape') setEditingSpeakerOld(null);
                    }}
                  />
                  <button
                    onClick={() => handleRenameSpeaker(speakerName)}
                    className="p-1 bg-sky-600 text-white rounded text-[10px] font-bold"
                    title="Simpan nama"
                  >
                    <UserCheck className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingSpeakerOld(speakerName);
                    setEditingSpeakerNew(speakerName);
                  }}
                  className="text-xs font-bold text-sky-700 dark:text-sky-300 bg-sky-100/70 dark:bg-sky-950/70 hover:bg-sky-200/80 dark:hover:bg-sky-900/80 px-2 py-0.5 rounded-md cursor-pointer transition-colors"
                  title="Klik untuk mengubah nama pembicara ini di seluruh transkrip"
                >
                  {speakerName}
                </span>
              )}
            </div>

            {isThisLinePlaying && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                <Volume2 className="w-3 h-3 animate-bounce" />
                <span>Sedang Diputar</span>
              </span>
            )}
          </div>
          <p
            className={`text-[15px] ${
              isThisLineActive
                ? 'text-slate-900 dark:text-white font-medium'
                : 'text-slate-800 dark:text-slate-200'
            }`}
          >
            {speechText}
          </p>
        </div>
      );
    }

    return (
      <div
        key={index}
        ref={(el) => {
          lineElementRefs.current[index] = el;
        }}
        onClick={() => {
          if (canPlayLine) handlePlayLine(index);
        }}
        className={`border-l-[3px] pl-3.5 pr-2.5 py-1.5 leading-relaxed text-[15px] transition-all rounded-r-xl flex items-start gap-2.5 group ${
          canPlayLine ? 'cursor-pointer' : ''
        } ${
          isThisLineActive
            ? 'border-rose-500 bg-rose-50/80 dark:bg-rose-950/35 ring-1 ring-rose-500/20 shadow-xs text-slate-900 dark:text-white font-medium'
            : 'border-sky-400 text-slate-800 dark:text-slate-200 hover:bg-sky-50/40 dark:hover:bg-sky-950/20'
        }`}
      >
        {timestampBadge && <div className="mt-0.5">{timestampBadge}</div>}
        <p className="flex-1">{line}</p>
        {isThisLinePlaying && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider shrink-0 mt-1">
            <Volume2 className="w-3 h-3 animate-bounce" />
            <span className="hidden sm:inline">Diputar</span>
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden transition-colors">
      {/* Hidden Native Audio Element */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onPlay={() => setIsPlayingAudio(true)}
          onPause={() => setIsPlayingAudio(false)}
          onEnded={() => {
            setIsPlayingAudio(false);
          }}
          onTimeUpdate={(e) => {
            setCurrentTime(e.currentTarget.currentTime);
          }}
          onLoadedMetadata={(e) => {
            const dur = e.currentTarget.duration;
            if (Number.isFinite(dur) && dur > 0) {
              setAudioDuration(dur);
            }
          }}
          onDurationChange={(e) => {
            const dur = e.currentTarget.duration;
            if (Number.isFinite(dur) && dur > 0) {
              setAudioDuration(dur);
            }
          }}
        />
      )}

      {/* Editor Header / Title bar */}
      <div className="px-6 py-3.5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-900/50">
        <input
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Judul Rekaman..."
          className="text-lg font-bold text-slate-800 dark:text-slate-100 bg-transparent border-b border-transparent hover:border-slate-300 dark:hover:border-slate-600 focus:border-indigo-600 dark:focus:border-indigo-400 focus:outline-none transition-colors w-full sm:w-auto flex-1 min-w-[200px]"
        />

        {/* Word count, status, view toggle */}
        <div className="flex items-center flex-wrap gap-2.5">
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
              <Check className="w-3.5 h-3.5" />
              <span>Tersimpan</span>
            </span>
            <span className="text-slate-300 dark:text-slate-700">•</span>
            <span>{wordCount} kata</span>
            <span className="text-slate-300 dark:text-slate-700">•</span>
            <span>{charCount} karakter</span>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center bg-slate-200/70 dark:bg-slate-800 p-0.5 rounded-xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => setViewMode('dialog')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all ${
                viewMode === 'dialog'
                  ? 'bg-white dark:bg-slate-700 text-sky-700 dark:text-sky-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
              title="Tampilan dialog bergaris kiri & sinkronisasi audio per kalimat"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Dialog</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('raw')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all ${
                viewMode === 'raw'
                  ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
              title="Mode ketik / edit teks bebas"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit Teks</span>
            </button>
          </div>
        </div>
      </div>

      {/* Synced Audio Playback Bar (Visible when paused or stopped & audio exists) */}
      {audioUrl && !isRecording && (
        <div className="px-4 sm:px-6 py-2.5 bg-gradient-to-r from-rose-50/80 via-indigo-50/50 to-slate-50 dark:from-rose-950/30 dark:via-indigo-950/25 dark:to-slate-900 border-b border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center gap-3">
          {/* Play / Pause Button */}
          <button
            type="button"
            onClick={togglePlayAudio}
            className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-rose-600 hover:bg-rose-700 text-white shadow-xs transition-all active:scale-95 shrink-0 cursor-pointer"
            title={isPlayingAudio ? 'Jeda Pemutaran Audio' : 'Putar & Runtut Rekaman Audio'}
          >
            {isPlayingAudio ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          {/* Skip -5s / +5s */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleSkip(-5)}
              className="p-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="Mundur 5 detik"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleSkip(5)}
              className="p-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="Maju 5 detik"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Current Time */}
          <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 tabular-nums">
            {formatDuration(Math.floor(currentTime))}
          </span>

          {/* Timeline Seek Bar */}
          <div className="flex-1 min-w-[120px] flex items-center">
            <input
              type="range"
              min={0}
              max={effectiveDuration}
              step={0.1}
              value={Math.min(currentTime, effectiveDuration)}
              onChange={handleSeek}
              className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-600"
            />
          </div>

          {/* Total Duration */}
          <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            {formatDuration(Math.floor(effectiveDuration))}
          </span>

          {/* Speed Control */}
          <button
            type="button"
            onClick={cyclePlaybackRate}
            className="px-2 py-1 text-[11px] font-mono font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            title="Kecepatan putar audio"
          >
            {playbackRate}x
          </button>

          {/* Download Recorded Audio */}
          <button
            type="button"
            onClick={handleDownloadAudio}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            title="Unduh file rekaman suara percakapan ini"
          >
            <Download className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
            <span className="hidden sm:inline">Unduh Audio</span>
          </button>
        </div>
      )}

      {/* Editor Body */}
      <div ref={containerRef} className="flex-1 p-6 flex flex-col overflow-y-auto space-y-4">
        {/* Main Content Area */}
        {viewMode === 'dialog' ? (
          <div className="flex-1 min-h-[220px] space-y-2.5">
            {lines.length === 0 && !interimContent ? (
              <div
                onClick={() => setViewMode('raw')}
                className="py-12 text-center text-slate-300 dark:text-slate-600 text-sm cursor-pointer hover:text-slate-400 dark:hover:text-slate-500"
              >
                {isRecording
                  ? 'Sedang merekam suara Anda... Begitu Anda jeda bicara, kalimat akurat Whisper akan otomatis muncul di sini.'
                  : 'Mulai bicara, teks Anda akan otomatis tertulis rapi per baris dengan garis di samping. Klik di sini untuk mengetik manual...'}
              </div>
            ) : (
              <>
                {audioUrl && !isRecording && lines.length > 0 && (
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 pb-1">
                    <Volume2 className="w-3.5 h-3.5 text-rose-500" />
                    <span>
                      Klik pada baris kalimat atau tombol waktu <strong>▶ 00:00</strong> untuk memutar dan meruntut rekaman suara pada kalimat tersebut.
                    </span>
                  </div>
                )}
                {lines.map((line, idx) => renderDialogLine(line, idx))}
                {interimContent && (
                  <div className="border-l-[3px] border-amber-400 bg-amber-50/50 dark:bg-amber-950/30 pl-3.5 py-1.5 rounded-r-lg text-slate-700 dark:text-slate-300 animate-pulse transition-all">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-100/90 dark:bg-amber-900/60 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping inline-block" />
                        Bicara Aktif
                      </span>
                    </div>
                    <p className="text-[15px] italic text-slate-600 dark:text-slate-400 leading-relaxed">
                      &ldquo;{interimContent}&rdquo;
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="relative flex-1 min-h-[220px]">
            <textarea
              value={content}
              onChange={(e) => onContentChange(e.target.value)}
              placeholder="Ketik atau edit transkrip di sini..."
              className="w-full h-full min-h-[220px] resize-none text-base text-slate-800 dark:text-slate-100 leading-relaxed font-sans placeholder:text-slate-300 dark:placeholder:text-slate-600 focus:outline-none bg-transparent"
            />
          </div>
        )}

        {/* AI Attachments Section (If any) */}
        {(aiSummary || aiActionItems) && (
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
            {aiSummary && (
              <div className="p-4 bg-purple-50/60 dark:bg-purple-950/30 border border-purple-100 dark:border-purple-900/60 rounded-2xl relative">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-purple-900 dark:text-purple-300 uppercase tracking-wider">
                    <FileText className="w-4 h-4 text-purple-600" />
                    <span>Ringkasan AI</span>
                  </div>
                  {onClearAiSummary && (
                    <button
                      onClick={onClearAiSummary}
                      className="text-purple-400 hover:text-rose-600 p-1 rounded transition-colors"
                      title="Hapus ringkasan"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {aiSummary}
                </div>
              </div>
            )}

            {aiActionItems && (
              <div className="p-4 bg-teal-50/60 dark:bg-teal-950/30 border border-teal-100 dark:border-teal-900/60 rounded-2xl relative">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-teal-900 dark:text-teal-300 uppercase tracking-wider">
                    <CheckSquare className="w-4 h-4 text-teal-600" />
                    <span>Action Items & Keputusan</span>
                  </div>
                  {onClearAiActions && (
                    <button
                      onClick={onClearAiActions}
                      className="text-teal-400 hover:text-rose-600 p-1 rounded transition-colors"
                      title="Hapus action items"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {aiActionItems}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
