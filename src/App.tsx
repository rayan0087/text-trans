import { useState, useEffect, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, type TranscriptRecord, type TranscriptLineTiming } from './db';
import { SpeechService, type SpeechState } from './services/speechRecognition';
import { AudioRecorderService } from './services/audioRecorder';
import { splitAudioFileForWhisper } from './services/audioChunker';
import { transcribeAudio, type AISettings } from './services/aiService';
import { Sidebar } from './components/Sidebar';
import { RecordingControls, type TranscriptionEngine } from './components/RecordingControls';
import { TranscriptEditor } from './components/TranscriptEditor';
import { ExportToolbar } from './components/ExportToolbar';
import { SettingsModal } from './components/SettingsModal';
import { PanelLeft, Loader2 } from 'lucide-react';

// Fast phonetic & homophone normalization for Indonesian enterprise/technical terms
function cleanSpeechTerms(text: string): string {
  if (!text) return text;
  return text
    .replace(/\b(indra|intra|ink)\s+project\b/gi, 'Internal Project')
    .replace(/\bgta-nya\b/gi, 'ETA-nya')
    .replace(/\bgta\b/gi, 'ETA')
    .replace(/\b(rrq|rfc|afg)\b/gi, 'RFQ')
    .replace(/\bbali susi pak ani\b/gi, 'dari sisi Pak Ami')
    .replace(/\bpak amik\b/gi, 'Pak Ami')
    .replace(/\bpak ani\b/gi, 'Pak Ami')
    .replace(/\bkepalaku teknis\b/gi, 'evaluasi teknis')
    .replace(/\b(tbc|ibc)\s+rkm\b/gi, 'EPC RKM')
    .replace(/\bibc\b/gi, 'EPC')
    .replace(/\brtm\b/gi, 'RKM')
    .replace(/\bre-?wok\b/gi, 'rework')
    .replace(/\bbek\s*en\b/gi, 'backend')
    .replace(/\bfron\s*en\b/gi, 'frontend')
    .replace(/\bdata\s*bes\b/gi, 'database')
    .replace(/\bdi\s*ploy\b/gi, 'deploy');
}

/**
 * Computes word-level overlap similarity (0..1) between two lines
 * to detect when an utterance is an updated revision of the previous line.
 */
function computeWordOverlap(a: string, b: string): number {
  const normA = a
    .toLowerCase()
    .replace(/[.,?!;:()"'-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const normB = b
    .toLowerCase()
    .replace(/[.,?!;:()"'-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (normA.length === 0 || normB.length === 0) return 0;

  const minLen = Math.min(normA.length, normB.length);
  let prefixMatches = 0;
  for (let i = 0; i < minLen; i++) {
    if (normA[i] === normB[i]) {
      prefixMatches++;
    } else {
      break;
    }
  }
  if (minLen >= 3 && prefixMatches / minLen >= 0.65) {
    return 0.85;
  }

  const setA = new Set(normA);
  const setB = new Set(normB);
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  return intersection / Math.min(setA.size, setB.size);
}

export function App() {
  // Database Live Query
  const transcripts = useLiveQuery(() => db.transcripts.orderBy('updatedAt').reverse().toArray()) || [];

  // Active Session State
  const [activeId, setActiveId] = useState<number | null>(null);
  const [title, setTitle] = useState('Transkrip Baru');
  const [content, setContent] = useState('');
  const [interimContent, setInterimContent] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [language, setLanguage] = useState('id-ID');
  const [aiSummary, setAiSummary] = useState<string | undefined>(undefined);
  const [aiActionItems, setAiActionItems] = useState<string | undefined>(undefined);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [lineTimings, setLineTimings] = useState<TranscriptLineTiming[]>([]);

  // Recording Engine & States
  const [engine, setEngine] = useState<TranscriptionEngine>('whisper');
  const [speechState, setSpeechState] = useState<SpeechState>('idle');
  const [isSupported, setIsSupported] = useState(true);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [uploadStatusMessage, setUploadStatusMessage] = useState('');
  const [activeWhisperChunks, setActiveWhisperChunks] = useState(0);
  const isTranscribingWhisper = isUploadingAudio || activeWhisperChunks > 0;

  // Service References
  const speechServiceRef = useRef<SpeechService | null>(null);
  const audioRecorderRef = useRef<AudioRecorderService | null>(null);

  // Hybrid Live + Whisper & Audio Timing coordination refs
  const currentChunkProvisionalLinesRef = useRef<string[]>([]);
  const whisperQueueRef = useRef<Promise<void>>(Promise.resolve());
  const audioBlobRef = useRef<Blob | null>(null);
  audioBlobRef.current = audioBlob;
  const lineTimingsRef = useRef<TranscriptLineTiming[]>([]);
  lineTimingsRef.current = lineTimings;
  const currentUtteranceStartSecRef = useRef<number | null>(null);
  const durationSecondsRef = useRef(durationSeconds);
  durationSecondsRef.current = durationSeconds;

  // Modals & UI Layout
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('app_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  // Sync theme class to html/root
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('app_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Ref to track latest content for speech callbacks without closure traps
  const contentRef = useRef(content);
  contentRef.current = content;

  // Unfinalized speech ref
  const interimSpeechRef = useRef<string>('');

  // Auto-save debouncing
  const saveTimeoutRef = useRef<any>(null);

  // Save current record to IndexedDB
  const persistTranscript = useCallback(
    async (overrideData?: Partial<TranscriptRecord>) => {
      const recordData: Partial<TranscriptRecord> = {
        title,
        content: contentRef.current,
        durationSeconds,
        language,
        aiSummary,
        aiActionItems,
        audioBlob: audioBlobRef.current || undefined,
        lineTimings: lineTimingsRef.current,
        updatedAt: new Date(),
        ...overrideData,
      };

      if (activeId) {
        await db.transcripts.update(activeId, recordData);
      } else {
        if (
          recordData.content?.trim() ||
          recordData.title !== 'Transkrip Baru' ||
          recordData.durationSeconds! > 0 ||
          recordData.audioBlob
        ) {
          const newId = await db.transcripts.add({
            title: recordData.title || 'Transkrip Baru',
            content: recordData.content || '',
            createdAt: new Date(),
            updatedAt: new Date(),
            durationSeconds: recordData.durationSeconds || 0,
            language: recordData.language || 'id-ID',
            aiSummary: recordData.aiSummary,
            aiActionItems: recordData.aiActionItems,
            audioBlob: recordData.audioBlob,
            lineTimings: recordData.lineTimings,
          });
          setActiveId(newId);
        }
      }
    },
    [activeId, title, durationSeconds, language, aiSummary, aiActionItems]
  );

  /**
   * Commits an utterance into the transcript with multi-stage deduplication & timestamp tracking.
   */
  const commitUtterance = useCallback((text: string, replaceLastLine: boolean = false) => {
    const cleaned = cleanSpeechTerms(text);
    const trimmed = cleaned.trim();
    if (!trimmed) return;

    const nowElapsed =
      audioRecorderRef.current?.getElapsedSeconds() || durationSecondsRef.current;
    const uttStartSec =
      currentUtteranceStartSecRef.current !== null
        ? currentUtteranceStartSecRef.current
        : Math.max(0, Number((nowElapsed - 1.8).toFixed(1)));
    const uttEndSec = Math.max(uttStartSec + 0.6, Number(nowElapsed.toFixed(1)));

    if (!replaceLastLine) {
      currentUtteranceStartSecRef.current = null;
    }

    // Track provisional lines spoken during the current audio chunk so Whisper can upgrade them accurately
    const provList = currentChunkProvisionalLinesRef.current;
    if (replaceLastLine && provList.length > 0) {
      provList[provList.length - 1] = trimmed;
    } else if (provList.length > 0) {
      const lastProv = provList[provList.length - 1];
      const normLastProv = lastProv.replace(/[.,?!]+$/, '').trim().toLowerCase();
      const normNewProv = trimmed.replace(/[.,?!]+$/, '').trim().toLowerCase();
      if (
        normNewProv === normLastProv ||
        normNewProv.startsWith(normLastProv) ||
        computeWordOverlap(normLastProv, normNewProv) >= 0.75
      ) {
        provList[provList.length - 1] = trimmed;
      } else {
        provList.push(trimmed);
      }
    } else {
      provList.push(trimmed);
    }

    const updateLastTiming = (newText: string) => {
      const nextTimings = [...lineTimingsRef.current];
      if (nextTimings.length > 0) {
        nextTimings[nextTimings.length - 1] = {
          ...nextTimings[nextTimings.length - 1],
          text: newText,
          endTime: uttEndSec,
        };
      } else {
        nextTimings.push({ text: newText, startTime: uttStartSec, endTime: uttEndSec });
      }
      lineTimingsRef.current = nextTimings;
      setLineTimings(nextTimings);
    };

    const appendNewTiming = (newText: string) => {
      const nextTimings = [
        ...lineTimingsRef.current,
        { text: newText, startTime: uttStartSec, endTime: uttEndSec },
      ];
      lineTimingsRef.current = nextTimings;
      setLineTimings(nextTimings);
    };

    setContent((prev) => {
      if (!prev) {
        appendNewTiming(trimmed);
        contentRef.current = trimmed;
        return trimmed;
      }

      const lines = prev.split('\n');
      let lastNonEmptyIndex = lines.length - 1;
      while (lastNonEmptyIndex >= 0 && !lines[lastNonEmptyIndex].trim()) {
        lastNonEmptyIndex--;
      }

      if (lastNonEmptyIndex >= 0) {
        const lastLine = lines[lastNonEmptyIndex].trim();
        const normLast = lastLine.replace(/[.,?!]+$/, '').trim().toLowerCase();
        const normTrimmed = trimmed.replace(/[.,?!]+$/, '').trim().toLowerCase();

        // Case 0: Explicit replacement of the same Web Speech resultIndex
        if (replaceLastLine) {
          lines[lastNonEmptyIndex] = trimmed;
          updateLastTiming(trimmed);
          const updated = lines.join('\n');
          contentRef.current = updated;
          return updated;
        }

        // Case 1: Exact duplicate -> ignore
        if (normLast === normTrimmed) {
          return prev;
        }

        // Case 2: New text is an extended continuation of the last line -> update in-place
        if (
          normTrimmed.startsWith(normLast + ' ') ||
          (normLast.length > 3 && normTrimmed.startsWith(normLast))
        ) {
          lines[lastNonEmptyIndex] = trimmed;
          updateLastTiming(trimmed);
          const updated = lines.join('\n');
          contentRef.current = updated;
          return updated;
        }

        // Case 3: The last line already includes this new text completely -> ignore
        if (normLast.startsWith(normTrimmed + ' ') || normLast === normTrimmed) {
          return prev;
        }

        // Case 4: High word-overlap revision of the same utterance -> replace in-place if longer/more complete
        if (
          normLast.split(/\s+/).length >= 3 &&
          computeWordOverlap(normLast, normTrimmed) >= 0.78
        ) {
          if (trimmed.length >= lastLine.length - 3) {
            lines[lastNonEmptyIndex] = trimmed;
            updateLastTiming(trimmed);
            const updated = lines.join('\n');
            contentRef.current = updated;
            return updated;
          }
          return prev;
        }
      }

      // Case 5: Brand new utterance -> append on new line
      appendNewTiming(trimmed);
      const separator = prev && !prev.endsWith('\n') ? '\n' : '';
      const updated = prev + separator + trimmed;
      contentRef.current = updated;
      return updated;
    });
  }, []);

  /**
   * Processes a live audio chunk with Whisper AI in the background and upgrades
   * the provisional browser lines + their exact timestamps.
   */
  const handleLiveAudioChunk = useCallback(
    (chunkBlob: Blob, chunkStartSec: number, chunkEndSec: number) => {
      const provisionalSnapshot = [...currentChunkProvisionalLinesRef.current];
      currentChunkProvisionalLinesRef.current = [];

      whisperQueueRef.current = whisperQueueRef.current.then(async () => {
        const settings = await getSetting<AISettings>('ai_settings', {
          provider: 'groq',
          apiKey: '',
        });

        if (!settings.apiKey || !settings.apiKey.trim()) {
          return;
        }

        setActiveWhisperChunks((c) => c + 1);
        try {
          const currentText = contentRef.current || '';
          const res = await transcribeAudio(settings, chunkBlob, language, currentText.slice(-260));
          if (!res.success || !res.result || !res.result.trim()) {
            return;
          }

          const whisperCleaned = cleanSpeechTerms(res.result.trim());
          if (!whisperCleaned) return;

          const whisperLines = whisperCleaned
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);

          const chunkSpan = Math.max(0.8, chunkEndSec - chunkStartSec);
          const newChunkTimings: TranscriptLineTiming[] = whisperLines.map((wLine, idx) => {
            const seg = res.segments?.[idx];
            const sTime = seg
              ? Number((chunkStartSec + seg.startTime).toFixed(1))
              : Number((chunkStartSec + (chunkSpan * idx) / whisperLines.length).toFixed(1));
            const eTime = seg
              ? Number((chunkStartSec + seg.endTime).toFixed(1))
              : Number((chunkStartSec + (chunkSpan * (idx + 1)) / whisperLines.length).toFixed(1));
            return {
              text: wLine,
              startTime: sTime,
              endTime: Math.max(sTime + 0.5, eTime),
            };
          });

          setContent((prev) => {
            if (!prev) {
              lineTimingsRef.current = newChunkTimings;
              setLineTimings(newChunkTimings);
              contentRef.current = whisperCleaned;
              return whisperCleaned;
            }

            const lines = prev.split('\n').filter((l) => l.trim().length > 0);

            // 1. Match provisional browser lines from this chunk window and replace them + their timings in-place
            if (provisionalSnapshot.length > 0) {
              const firstProv = provisionalSnapshot[0].trim().toLowerCase();
              let matchStart = -1;
              for (let i = lines.length - 1; i >= Math.max(0, lines.length - 8); i--) {
                const normLine = lines[i].trim().toLowerCase();
                if (
                  normLine === firstProv ||
                  computeWordOverlap(normLine, firstProv) >= 0.45
                ) {
                  matchStart = i;
                  break;
                }
              }

              if (matchStart !== -1) {
                const removeCount = Math.min(
                  provisionalSnapshot.length,
                  lines.length - matchStart
                );
                lines.splice(matchStart, removeCount, ...whisperLines);

                const nextTimings = [...lineTimingsRef.current];
                if (matchStart <= nextTimings.length) {
                  nextTimings.splice(matchStart, removeCount, ...newChunkTimings);
                } else {
                  nextTimings.push(...newChunkTimings);
                }
                lineTimingsRef.current = nextTimings;
                setLineTimings(nextTimings);

                const updated = lines.join('\n');
                contentRef.current = updated;
                return updated;
              }
            }

            // 2. Fallback: Check if the last line of content matches the Whisper output
            if (lines.length > 0) {
              const lastLine = lines[lines.length - 1];
              if (computeWordOverlap(lastLine, whisperCleaned) >= 0.4) {
                lines.splice(lines.length - 1, 1, ...whisperLines);
                const nextTimings = [...lineTimingsRef.current];
                if (nextTimings.length > 0) {
                  nextTimings.splice(nextTimings.length - 1, 1, ...newChunkTimings);
                } else {
                  nextTimings.push(...newChunkTimings);
                }
                lineTimingsRef.current = nextTimings;
                setLineTimings(nextTimings);

                const updated = lines.join('\n');
                contentRef.current = updated;
                return updated;
              }
            }

            // 3. Brand new speech caught by Whisper that Web Speech API missed completely
            const nextTimings = [...lineTimingsRef.current, ...newChunkTimings];
            lineTimingsRef.current = nextTimings;
            setLineTimings(nextTimings);

            const separator = prev && !prev.endsWith('\n') ? '\n' : '';
            const updated = prev + separator + whisperCleaned;
            contentRef.current = updated;
            return updated;
          });
        } catch (err) {
          console.warn('Live Whisper chunk error (keeping provisional text):', err);
        } finally {
          setActiveWhisperChunks((c) => Math.max(0, c - 1));
        }
      });
    },
    [language]
  );

  // Initialize Speech Services & Audio Recorder
  useEffect(() => {
    setIsSupported(SpeechService.isSupported());
    audioRecorderRef.current = new AudioRecorderService({
      enableVAD: true,
      silenceThresholdMs: 950,
      minChunkDurationMs: 3200,
      maxChunkDurationMs: 9000,
      hardLimitDurationMs: 14000,
    });
    setEngine('whisper');
  }, []);

  // Bind latest live chunk handler to AudioRecorderService
  useEffect(() => {
    audioRecorderRef.current?.setOnChunkReady(handleLiveAudioChunk);
  }, [handleLiveAudioChunk]);

  // Speech Recognition for 0ms live visual feedback
  useEffect(() => {
    speechServiceRef.current = new SpeechService(
      {
        onFinalTranscript: (text, replaceLastLine) => {
          interimSpeechRef.current = '';
          setInterimContent('');
          const trimmed = cleanSpeechTerms(text).trim();
          if (trimmed) {
            commitUtterance(trimmed, replaceLastLine);
          }
        },
        onInterimTranscript: (text) => {
          if (currentUtteranceStartSecRef.current === null && text.trim()) {
            const nowElapsed =
              audioRecorderRef.current?.getElapsedSeconds() || durationSecondsRef.current;
            currentUtteranceStartSecRef.current = Math.max(
              0,
              Number((nowElapsed - 0.3).toFixed(1))
            );
          }
          const cleaned = cleanSpeechTerms(text);
          setInterimContent(cleaned);
          interimSpeechRef.current = cleaned;
        },
        onStateChange: (state) => {
          setSpeechState(state);
        },
        onError: (errMsg) => {
          console.warn('Speech error:', errMsg);
        },
      },
      language
    );

    return () => {
      speechServiceRef.current?.stop();
    };
  }, [engine, language, commitUtterance]);

  const [audioLevel, setAudioLevel] = useState(0);

  // Timer loop & Mic volume level polling when recording
  useEffect(() => {
    let interval: any = null;
    let levelInterval: any = null;

    if (speechState === 'recording') {
      interval = setInterval(() => {
        setDurationSeconds((sec) => sec + 1);
      }, 1000);

      levelInterval = setInterval(() => {
        if (audioRecorderRef.current) {
          const level = audioRecorderRef.current.getAudioLevel();
          setAudioLevel(level);
        }
      }, 60);
    } else {
      setAudioLevel(0);
      if (interval) clearInterval(interval);
      if (levelInterval) clearInterval(levelInterval);
    }
    return () => {
      if (interval) clearInterval(interval);
      if (levelInterval) clearInterval(levelInterval);
    };
  }, [speechState]);

  // Debounced auto-save on content / title changes
  useEffect(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      persistTranscript();
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [content, title, durationSeconds, persistTranscript]);

  const handleEngineChange = async (newEngine: TranscriptionEngine) => {
    if (newEngine === 'whisper') {
      const settings = await getSetting<AISettings>('ai_settings', {
        provider: 'groq',
        apiKey: '',
      });
      if (!settings.apiKey) {
        setIsSettingsOpen(true);
        alert(
          'Mode Whisper AI membutuhkan API Key (Groq / OpenAI / Gemini). Silakan simpan API Key Anda di menu Pengaturan.'
        );
        return;
      }
    }
    setEngine(newEngine);
  };

  // Controls Handlers
  const handleStart = async () => {
    currentChunkProvisionalLinesRef.current = [];
    currentUtteranceStartSecRef.current = null;
    setAudioBlob(null);
    audioBlobRef.current = null;

    // 1. Ensure live recognition always starts immediately so user can talk without lag
    speechServiceRef.current?.setLanguage(language);
    speechServiceRef.current?.start();

    // 2. Start hardware audio recorder + VAD in parallel for Whisper AI verification & master recording
    if (engine === 'whisper') {
      try {
        await audioRecorderRef.current?.start();
      } catch (err: any) {
        console.warn('AudioRecorder start warning:', err);
      }
    }
  };

  const handlePause = async () => {
    speechServiceRef.current?.pause();
    if (engine === 'whisper' && audioRecorderRef.current) {
      await audioRecorderRef.current.pause();
    }
    await persistTranscript();
  };

  const handleResume = () => {
    speechServiceRef.current?.resume();
    if (engine === 'whisper') {
      audioRecorderRef.current?.resume();
    }
  };

  const handleStop = async () => {
    if (interimSpeechRef.current.trim()) {
      const remainingSpeech = interimSpeechRef.current.trim();
      interimSpeechRef.current = '';
      commitUtterance(remainingSpeech);
    }

    speechServiceRef.current?.stop();
    setInterimContent('');

    if (engine === 'whisper' && audioRecorderRef.current) {
      try {
        const finalMasterBlob = await audioRecorderRef.current.stop();
        if (finalMasterBlob) {
          audioBlobRef.current = finalMasterBlob;
          setAudioBlob(finalMasterBlob);
        }
        // Wait for any in-flight Whisper chunk to finish before final persist
        await whisperQueueRef.current;
        await persistTranscript({
          audioBlob: finalMasterBlob || audioBlobRef.current || undefined,
        });
      } catch (err: any) {
        console.error('Audio recorder stop error:', err);
        persistTranscript();
      }
    } else {
      persistTranscript();
    }
  };

  const handleLanguageChange = (newLang: string) => {
    setLanguage(newLang);
    speechServiceRef.current?.setLanguage(newLang);
  };

  /**
   * Upload Audio File Transcription Handler with Automatic 16kHz Mono Chunking
   * Also stores the uploaded audio file and sentence timestamps for interactive synced playback.
   */
  const handleUploadAudio = async (file: File) => {
    const settings = await getSetting<AISettings>('ai_settings', {
      provider: 'groq',
      apiKey: '',
    });
    if (!settings.apiKey || !settings.apiKey.trim()) {
      setIsSettingsOpen(true);
      alert(
        'Untuk mentranskripsi file rekaman audio, dibutuhkan API Key Whisper AI (Groq / OpenAI / Gemini). Silakan masukkan API Key Anda di Pengaturan.'
      );
      return;
    }

    try {
      setIsUploadingAudio(true);
      setUploadStatusMessage(
        `Menyiapkan "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB)...`
      );

      const { segments, durationSeconds: decodedDuration } = await splitAudioFileForWhisper(
        file,
        (msg) => setUploadStatusMessage(msg)
      );

      const fileBaseName = file.name.replace(/\.[^/.]+$/, '');
      const newTitle = `Transkrip - ${fileBaseName}`;
      setTitle(newTitle);
      if (decodedDuration > 0) {
        setDurationSeconds(decodedDuration);
      }

      // Attach uploaded audio file for synced playback immediately
      audioBlobRef.current = file;
      setAudioBlob(file);
      lineTimingsRef.current = [];
      setLineTimings([]);

      let accumulatedTranscript = '';
      const accumulatedTimings: TranscriptLineTiming[] = [];

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (segments.length > 1) {
          const pct = Math.round(((i + 1) / segments.length) * 100);
          setUploadStatusMessage(
            `Mentranskripsi "${file.name}" — Bagian ${i + 1} dari ${segments.length} (${pct}%)...`
          );
        } else {
          setUploadStatusMessage(
            `Mentranskripsi "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) dengan Whisper AI...`
          );
        }

        const contextTail = accumulatedTranscript ? accumulatedTranscript.slice(-240) : undefined;
        const res = await transcribeAudio(settings, seg.blob, language, contextTail);

        if (!res.success) {
          throw new Error(
            res.error || `Gagal mentranskripsi bagian ${i + 1} dari ${segments.length}.`
          );
        }

        const cleanedChunk = cleanSpeechTerms((res.result || '').trim());
        if (cleanedChunk) {
          const chunkLines = cleanedChunk
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
          const segSpan = Math.max(1, (seg.endSec || decodedDuration || 60) - seg.startSec);

          chunkLines.forEach((lineText, idx) => {
            const whisperSeg = res.segments?.[idx];
            const sTime = whisperSeg
              ? Number((seg.startSec + whisperSeg.startTime).toFixed(1))
              : Number((seg.startSec + (segSpan * idx) / chunkLines.length).toFixed(1));
            const eTime = whisperSeg
              ? Number((seg.startSec + whisperSeg.endTime).toFixed(1))
              : Number((seg.startSec + (segSpan * (idx + 1)) / chunkLines.length).toFixed(1));

            accumulatedTimings.push({
              text: lineText,
              startTime: sTime,
              endTime: Math.max(sTime + 0.5, eTime),
            });
          });

          accumulatedTranscript = accumulatedTranscript
            ? `${accumulatedTranscript}\n${cleanedChunk}`
            : cleanedChunk;

          lineTimingsRef.current = [...accumulatedTimings];
          setLineTimings([...accumulatedTimings]);
          setContent(accumulatedTranscript);
          contentRef.current = accumulatedTranscript;
        }
      }

      if (accumulatedTranscript.trim()) {
        setEngine('whisper');
        await persistTranscript({
          title: newTitle,
          content: accumulatedTranscript.trim(),
          durationSeconds: decodedDuration || durationSeconds,
          audioBlob: file,
          lineTimings: accumulatedTimings,
        });
      } else {
        alert('Tidak ada suara percakapan yang terdeteksi di dalam file audio tersebut.');
      }
    } catch (err: any) {
      console.error('Audio file upload transcription error:', err);
      alert(`Terjadi kendala saat mentranskripsi: ${err.message}`);
    } finally {
      setIsUploadingAudio(false);
      setUploadStatusMessage('');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (speechState !== 'idle' || isUploadingAudio) return;
    const file = e.dataTransfer.files?.[0];
    if (
      file &&
      (file.type.startsWith('audio/') ||
        file.type.startsWith('video/') ||
        /\.(mp3|wav|m4a|aac|ogg|webm|mp4)$/i.test(file.name))
    ) {
      handleUploadAudio(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // Switch / Create New Session
  const handleNewTranscript = async () => {
    if (content.trim()) {
      await persistTranscript();
    }
    if (speechState !== 'idle') {
      speechServiceRef.current?.stop();
      if (engine === 'whisper') {
        audioRecorderRef.current?.stop();
      }
    }

    currentChunkProvisionalLinesRef.current = [];
    currentUtteranceStartSecRef.current = null;
    setActiveId(null);
    setTitle('Transkrip Baru');
    setContent('');
    setInterimContent('');
    setDurationSeconds(0);
    setAiSummary(undefined);
    setAiActionItems(undefined);
    setAudioBlob(null);
    audioBlobRef.current = null;
    setLineTimings([]);
    lineTimingsRef.current = [];
  };

  const handleSelectTranscript = (id: number) => {
    if (speechState !== 'idle') {
      speechServiceRef.current?.stop();
      if (engine === 'whisper') {
        audioRecorderRef.current?.stop();
      }
    }
    currentChunkProvisionalLinesRef.current = [];
    currentUtteranceStartSecRef.current = null;
    const target = transcripts.find((t) => t.id === id);
    if (target) {
      setActiveId(target.id!);
      setTitle(target.title || 'Transkrip Tanpa Judul');
      setContent(target.content || '');
      setInterimContent('');
      setDurationSeconds(target.durationSeconds || 0);
      setLanguage(target.language || 'id-ID');
      setAiSummary(target.aiSummary);
      setAiActionItems(target.aiActionItems);
      setAudioBlob(target.audioBlob || null);
      audioBlobRef.current = target.audioBlob || null;
      setLineTimings(target.lineTimings || []);
      lineTimingsRef.current = target.lineTimings || [];
    }
  };

  const handleDeleteTranscript = async (id: number) => {
    await db.transcripts.delete(id);
    if (activeId === id) {
      handleNewTranscript();
    }
  };

  const currentRecord: Partial<TranscriptRecord> = {
    id: activeId || undefined,
    title,
    content,
    durationSeconds,
    language,
    aiSummary,
    aiActionItems,
    audioBlob: audioBlob || undefined,
    lineTimings,
    createdAt: activeId
      ? transcripts.find((t) => t.id === activeId)?.createdAt || new Date()
      : new Date(),
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 dark:bg-slate-950 font-sans transition-colors">
      {/* Sidebar Navigation */}
      <Sidebar
        transcripts={transcripts}
        activeId={activeId}
        onSelectTranscript={handleSelectTranscript}
        onNewTranscript={handleNewTranscript}
        onDeleteTranscript={handleDeleteTranscript}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isOpen={isSidebarOpen}
        onToggleOpen={() => setIsSidebarOpen((v) => !v)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {/* Main Workspace Area with Drag and Drop Audio Support */}
      <main
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="flex-1 flex flex-col h-full overflow-hidden p-3 sm:p-5 lg:p-6 gap-3.5"
      >
        {/* Top Bar on Mobile for sidebar trigger */}
        <div className="flex lg:hidden items-center justify-between bg-white dark:bg-slate-900 px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <PanelLeft className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Riwayat Transkrip</span>
          </button>
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="Logo" className="w-5 h-5 rounded-md" />
            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
              Transkrip Kilat
            </span>
          </div>
        </div>

        {/* Upload Audio File Progress Notification Banner */}
        {isUploadingAudio && (
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-3 rounded-2xl flex items-center justify-between gap-3 shadow-md animate-pulse">
            <div className="flex items-center gap-3 text-xs sm:text-sm font-semibold">
              <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin text-indigo-200 shrink-0" />
              <span>
                {uploadStatusMessage ||
                  'Sedang memproses dan mentranskripsi file rekaman audio...'}
              </span>
            </div>
            <span className="text-[11px] bg-white/20 px-2.5 py-1 rounded-lg font-mono uppercase font-bold shrink-0">
              Whisper AI
            </span>
          </div>
        )}

        {/* 1. Recording Controls Bar with Engine Toggle & Audio Upload */}
        <RecordingControls
          speechState={speechState}
          durationSeconds={durationSeconds}
          language={language}
          onLanguageChange={handleLanguageChange}
          onStart={handleStart}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
          isSupported={isSupported}
          engine={engine}
          onEngineChange={handleEngineChange}
          isTranscribingWhisper={isTranscribingWhisper}
          onUploadAudio={handleUploadAudio}
          isUploadingAudio={isUploadingAudio}
          audioLevel={audioLevel}
        />

        {/* 2. Main Live Transcript Editor with Sentence Dialog View & Synced Audio Player */}
        <TranscriptEditor
          title={title}
          onTitleChange={setTitle}
          content={content}
          interimContent={interimContent}
          onContentChange={setContent}
          isRecording={speechState === 'recording'}
          isPaused={speechState === 'paused'}
          createdAt={currentRecord.createdAt}
          durationSeconds={durationSeconds}
          audioBlob={audioBlob}
          lineTimings={lineTimings}
          aiSummary={aiSummary}
          aiActionItems={aiActionItems}
          onClearAiSummary={() => setAiSummary(undefined)}
          onClearAiActions={() => setAiActionItems(undefined)}
        />

        {/* 3. Export & Action Toolbar */}
        <ExportToolbar currentRecord={currentRecord} />
      </main>

      {/* Settings Modal (BYOK AI) */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSaved={() => {
          setEngine('whisper');
        }}
      />
    </div>
  );
}

export default App;
