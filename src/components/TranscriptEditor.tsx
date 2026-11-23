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
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { type TranscriptLineTiming } from '../db';

interface TranscriptEditorProps {
  title: string;
  onTitleChange: (newTitle: string) => void;
  content: string;
  interimContent: string;
  onContentChange: (newContent: string) => void;
  isRecording: boolean;
  isPaused?: boolean;
  createdAt?: Date;
  durationSeconds?: number;
  audioBlob?: Blob | null;
  lineTimings?: TranscriptLineTiming[];
  aiSummary?: string;
  aiActionItems?: string;
  onClearAiSummary?: () => void;
  onClearAiActions?: () => void;
}

/**
 * Formats seconds into M:SS (e.g. 0:01, 0:12, 1:05) matching the segment timestamp style.
 */
function formatShortTime(seconds: number): string {
  const safeSec = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(safeSec / 60);
  const secs = safeSec % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Formats Date into "Nov 23, 2026, 01:55 PM" style.
 */
function formatSessionDate(date?: Date): string {
  const d = date ? new Date(date) : new Date();
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export const TranscriptEditor: React.FC<TranscriptEditorProps> = ({
  title,
  onTitleChange,
  content,
  interimContent,
  onContentChange,
  isRecording,
  isPaused = false,
  createdAt,
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

  // Audio Playback & Segment Selection States
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [selectedLineIndex, setSelectedLineIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lineElementRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Player only appears when recording is completely finished (idle), NOT while recording or paused
  const isFinishedState = !isRecording && !isPaused;
  const showAudioPlayer = isFinishedState && !!audioUrl;

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
      setSelectedLineIndex(null);
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
    if ((isRecording || isPaused) && audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setIsPlayingAudio(false);
    }
  }, [isRecording, isPaused]);

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
   */
  const resolvedTimings = useMemo(() => {
    if (lines.length === 0) return [];

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

      let lastEnd = 0;
      for (let i = 0; i < lines.length; i++) {
        if (matched[i]) {
          result.push(matched[i]!);
          lastEnd = matched[i]!.endTime;
        } else {
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

  // Active segment index determined either by live audio playback or user click selection
  const activeLineIndex = useMemo(() => {
    if (isPlayingAudio && resolvedTimings.length > 0) {
      for (let i = 0; i < resolvedTimings.length; i++) {
        const t = resolvedTimings[i];
        const nextStart =
          i + 1 < resolvedTimings.length ? resolvedTimings[i + 1].startTime : Infinity;
        if (currentTime >= t.startTime - 0.15 && currentTime < Math.max(t.endTime, nextStart)) {
          return i;
        }
      }
      return resolvedTimings.length - 1;
    }
    return selectedLineIndex ?? -1;
  }, [isPlayingAudio, resolvedTimings, currentTime, selectedLineIndex]);

  // Sync selectedLineIndex with playback progression so it stays highlighted when paused
  useEffect(() => {
    if (isPlayingAudio && activeLineIndex !== -1) {
      setSelectedLineIndex(activeLineIndex);
      const el = lineElementRefs.current[activeLineIndex];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [activeLineIndex, isPlayingAudio]);

  // Auto-scroll when new text arrives while recording
  useEffect(() => {
    if (isRecording && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [content, interimContent, isRecording]);

  // Audio player controls
  const togglePlayAudio = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      // If a segment was selected while paused, make sure we play from its timestamp
      if (selectedLineIndex !== null && resolvedTimings[selectedLineIndex]) {
        const seg = resolvedTimings[selectedLineIndex];
        if (Math.abs(audio.currentTime - seg.startTime) > 0.5 && currentTime === seg.startTime) {
          audio.currentTime = seg.startTime;
        }
      }
      audio.play().catch((err) => console.warn('Audio play error:', err));
    } else {
      audio.pause();
    }
  };

  const handleSelectAndPlayLine = (index: number) => {
    if (!isFinishedState) return;
    setSelectedLineIndex(index);

    const timing = resolvedTimings[index];
    if (!timing) return;

    const targetStart = Math.max(0, timing.startTime);
    setCurrentTime(targetStart);

    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = targetStart;
      audio.play().catch((err) => console.warn('Line audio play error:', err));
    }
  };

  const handlePrevSegment = () => {
    if (lines.length === 0) return;
    const currentIdx = activeLineIndex >= 0 ? activeLineIndex : 0;
    const prevIdx = Math.max(0, currentIdx - 1);
    handleSelectAndPlayLine(prevIdx);
  };

  const handleNextSegment = () => {
    if (lines.length === 0) return;
    const currentIdx = activeLineIndex >= 0 ? activeLineIndex : -1;
    const nextIdx = Math.min(lines.length - 1, currentIdx + 1);
    handleSelectAndPlayLine(nextIdx);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
    // Also update selectedLineIndex to match seek position
    for (let i = 0; i < resolvedTimings.length; i++) {
      const t = resolvedTimings[i];
      const nextStart =
        i + 1 < resolvedTimings.length ? resolvedTimings[i + 1].startTime : Infinity;
      if (val >= t.startTime && val < Math.max(t.endTime, nextStart)) {
        setSelectedLineIndex(i);
        break;
      }
    }
  };

  const cyclePlaybackRate = () => {
    const rates = [1, 1.25, 1.5, 2];
    const nextRate = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
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

  // Render each sentence segment matching the clean vertical-bar + timestamp header style
  const renderDialogLine = (line: string, index: number) => {
    const speakerRegex =
      /^(\*\*\[.*?\]\*\*|\*\[.*?\]\*|\[.*?\]|Pembicara\s+[A-Za-z0-9]+:?|Speaker\s+[A-Za-z0-9]+:?|Mas\s+\w+:?|Pak\s+\w+:?|Bu\s+\w+:?):?\s*(.*)$/i;
    const match = line.match(speakerRegex);
    const timing = resolvedTimings[index];
    const isSelected = isFinishedState && activeLineIndex === index;
    const canSelectLine = isFinishedState && !!audioUrl;

    const speakerName = match ? match[1].replace(/[*\[\]:]/g, '').trim() : null;
    const speechText = match ? match[2] : line;
    const isEditingThis = speakerName !== null && editingSpeakerOld === speakerName;

    return (
      <div
        key={index}
        ref={(el) => {
          lineElementRefs.current[index] = el;
        }}
        onClick={() => {
          if (canSelectLine && !isEditingThis) {
            handleSelectAndPlayLine(index);
          }
        }}
        className={`py-1.5 transition-all select-text ${
          canSelectLine ? 'cursor-pointer group' : ''
        }`}
      >
        {/* Timestamp & Optional Speaker Row above the vertical bar */}
        {(timing || speakerName) && (
          <div className="flex items-center gap-1.5 text-xs mb-1">
            {timing && (
              <span
                className={`font-mono transition-colors ${
                  isSelected
                    ? 'text-sky-600 dark:text-sky-400 font-semibold'
                    : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'
                }`}
              >
                {formatShortTime(timing.startTime)}
              </span>
            )}

            {speakerName && (
              <>
                {timing && <span className="text-slate-300 dark:text-slate-600">•</span>}
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
                    className="text-xs font-semibold text-sky-500 hover:text-sky-600 dark:text-sky-400 cursor-pointer transition-colors"
                    title="Klik untuk mengubah nama pembicara"
                  >
                    {speakerName}
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {/* Vertical Blue Bar + Sentence Text (turns blue when selected/playing) */}
        <div
          className={`border-l-[3px] pl-3.5 py-0.5 transition-colors ${
            isSelected
              ? 'border-sky-500'
              : 'border-sky-400 group-hover:border-sky-500'
          }`}
        >
          <p
            className={`text-[15px] leading-relaxed transition-colors ${
              isSelected
                ? 'text-sky-500 dark:text-sky-400 font-semibold'
                : 'text-slate-800 dark:text-slate-200 group-hover:text-sky-600/80 dark:group-hover:text-sky-300/80'
            }`}
          >
            {speechText}
          </p>
        </div>
      </div>
    );
  };

  const progressPercent = Math.min(
    100,
    Math.max(0, (currentTime / Math.max(effectiveDuration, 0.1)) * 100)
  );

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

      {/* Editor Body */}
      <div ref={containerRef} className="flex-1 p-6 flex flex-col overflow-y-auto space-y-4">
        {/* Main Content Area */}
        {viewMode === 'dialog' ? (
          <div className="flex-1 min-h-[220px] space-y-3">
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
                {/* Top Session Metadata Header (Date • Duration • Segments) */}
                {lines.length > 0 && (
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 pb-2">
                    <span>{formatSessionDate(createdAt)}</span>
                    <span>•</span>
                    <span>{formatShortTime(effectiveDuration)}</span>
                    <span>•</span>
                    <span>{lines.length} segments</span>
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

      {/* Bottom Audio Player Dock (Appears ONLY when recording is finished / idle) */}
      {showAudioPlayer && (
        <div className="bg-white dark:bg-slate-900 select-none">
          {/* Top Full-Width Blue Progress Line (Clickable / Draggable Scrubber) */}
          <div className="relative w-full h-1 bg-slate-200 dark:bg-slate-800 group cursor-pointer">
            <div
              className="absolute top-0 left-0 bottom-0 bg-sky-500 transition-all duration-75"
              style={{ width: `${progressPercent}%` }}
            />
            <input
              type="range"
              min={0}
              max={effectiveDuration}
              step={0.1}
              value={Math.min(currentTime, effectiveDuration)}
              onChange={handleSeek}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              title="Geser waktu pemutaran audio"
            />
          </div>

          {/* Centered Player Controls */}
          <div className="py-3.5 px-6 flex items-center justify-center gap-4 sm:gap-5">
            {/* Time Display: 0:12 / 0:15 */}
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400 tabular-nums mr-1">
              {formatShortTime(currentTime)} / {formatShortTime(effectiveDuration)}
            </span>

            {/* Previous Segment Button (|<) */}
            <button
              type="button"
              onClick={handlePrevSegment}
              className="w-10 h-10 rounded-full bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/60 dark:hover:bg-sky-900/80 text-sky-600 dark:text-sky-400 flex items-center justify-center transition-all active:scale-95 cursor-pointer"
              title="Kalimat sebelumnya"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            {/* Large Blue Play / Pause Button */}
            <button
              type="button"
              onClick={togglePlayAudio}
              className="w-14 h-14 rounded-full bg-sky-500 hover:bg-sky-600 text-white shadow-md shadow-sky-200 dark:shadow-none flex items-center justify-center transition-all active:scale-95 cursor-pointer"
              title={isPlayingAudio ? 'Jeda Audio' : 'Putar Audio'}
            >
              {isPlayingAudio ? (
                <Pause className="w-6 h-6" />
              ) : (
                <Play className="w-6 h-6 ml-0.5" />
              )}
            </button>

            {/* Next Segment Button (>|) */}
            <button
              type="button"
              onClick={handleNextSegment}
              className="w-10 h-10 rounded-full bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/60 dark:hover:bg-sky-900/80 text-sky-600 dark:text-sky-400 flex items-center justify-center transition-all active:scale-95 cursor-pointer"
              title="Kalimat berikutnya"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            {/* Playback Speed Pill (1x) */}
            <button
              type="button"
              onClick={cyclePlaybackRate}
              className="w-10 h-10 rounded-full bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/60 dark:hover:bg-sky-900/80 text-sky-600 dark:text-sky-400 text-xs font-semibold flex items-center justify-center transition-all active:scale-95 cursor-pointer"
              title="Kecepatan putar audio"
            >
              {playbackRate}x
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
