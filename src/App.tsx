import { useState, useEffect, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, type TranscriptRecord } from './db';
import { SpeechService, type SpeechState } from './services/speechRecognition';
import { AudioRecorderService } from './services/audioRecorder';
import { transcribeAudio, type AISettings } from './services/aiService';
import { Sidebar } from './components/Sidebar';
import { RecordingControls, type TranscriptionEngine } from './components/RecordingControls';
import { TranscriptEditor } from './components/TranscriptEditor';
import { ExportToolbar } from './components/ExportToolbar';
import { SettingsModal } from './components/SettingsModal';
import { PanelLeft } from 'lucide-react';

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

  // Recording Engine & States - Default to whisper if key exists
  const [engine, setEngine] = useState<TranscriptionEngine>('whisper');
  const [speechState, setSpeechState] = useState<SpeechState>('idle');
  const [isSupported, setIsSupported] = useState(true);
  const [isTranscribingWhisper, setIsTranscribingWhisper] = useState(false);

  // Service References
  const speechServiceRef = useRef<SpeechService | null>(null);
  const audioRecorderRef = useRef<AudioRecorderService | null>(null);

  // Modals & UI Layout
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Ref to track latest content for speech callbacks without closure traps
  const contentRef = useRef(content);
  contentRef.current = content;

  // Unfinalized speech & silence debouncing
  const interimSpeechRef = useRef<string>('');
  const silenceDebounceTimerRef = useRef<any>(null);

  // Auto-save debouncing
  const saveTimeoutRef = useRef<any>(null);

  // Save current record to IndexedDB
  const persistTranscript = useCallback(
    async (
      overrideData?: Partial<TranscriptRecord>
    ) => {
      const recordData: Partial<TranscriptRecord> = {
        title,
        content: contentRef.current,
        durationSeconds,
        language,
        aiSummary,
        aiActionItems,
        updatedAt: new Date(),
        ...overrideData,
      };

      if (activeId) {
        await db.transcripts.update(activeId, recordData);
      } else {
        if (recordData.content?.trim() || recordData.title !== 'Transkrip Baru' || recordData.durationSeconds! > 0) {
          const newId = await db.transcripts.add({
            title: recordData.title || 'Transkrip Baru',
            content: recordData.content || '',
            createdAt: new Date(),
            updatedAt: new Date(),
            durationSeconds: recordData.durationSeconds || 0,
            language: recordData.language || 'id-ID',
            aiSummary: recordData.aiSummary,
            aiActionItems: recordData.aiActionItems,
          });
          setActiveId(newId);
        }
      }
    },
    [activeId, title, durationSeconds, language, aiSummary, aiActionItems]
  );

  // Real-time Streaming Whisper Processor with Context Memory (Maestra Live-style)
  const processStreamingWhisperChunk = useCallback(
    async (chunkBlob: Blob) => {
      const settings = await getSetting<AISettings>('ai_settings', {
        provider: 'groq',
        apiKey: '',
      });
      if (!settings.apiKey) return;

      try {
        setIsTranscribingWhisper(true);
        // Pass previous sentences as contextPrompt to maintain terms consistency
        const res = await transcribeAudio(settings, chunkBlob, language, contentRef.current);
        setIsTranscribingWhisper(false);

        if (res.success && typeof res.result === 'string') {
          const resultText = res.result;
          setContent((prev) => {
            const separator = prev && !prev.endsWith('\n') ? '\n' : '';
            const updated = prev ? `${prev}${separator}${resultText}` : resultText;
            contentRef.current = updated;
            return updated;
          });
        }
      } catch (e) {
        setIsTranscribingWhisper(false);
        console.warn('Streaming chunk transcription error:', e);
      }
    },
    [language]
  );

  // Initialize Speech Services & Audio Recorder with Silence Detection
  useEffect(() => {
    setIsSupported(SpeechService.isSupported());
    audioRecorderRef.current = new AudioRecorderService({
      onChunkReady: (blob) => {
        processStreamingWhisperChunk(blob);
      },
      silenceThresholdMs: 1200,
      maxChunkDurationMs: 8000,
    });

    getSetting<AISettings>('ai_settings', { provider: 'groq', apiKey: '' }).then((saved) => {
      if (saved && saved.apiKey) {
        setEngine('whisper');
      } else {
        setEngine('browser');
      }
    });
  }, [processStreamingWhisperChunk]);

  // Commit an utterance into the transcript (instantly visible, then refined via Whisper in background)
  const commitUtterance = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const tempLine = trimmed;

      if (engine === 'browser') {
        setContent((prev) => {
          const separator = prev && !prev.endsWith('\n') ? '\n' : '';
          const updated = prev ? `${prev}${separator}${trimmed}` : trimmed;
          contentRef.current = updated;
          return updated;
        });
      } else if (engine === 'whisper') {
        // 1. Immediately append the text to editor so it is NEVER lost or dropped
        setContent((prev) => {
          const separator = prev && !prev.endsWith('\n') ? '\n' : '';
          const updated = prev ? `${prev}${separator}${tempLine}` : tempLine;
          contentRef.current = updated;
          return updated;
        });

        // 2. Cut audio utterance and refine via Whisper AI for scientific/technical precision & punctuation
        if (audioRecorderRef.current) {
          try {
            setIsTranscribingWhisper(true);
            const audioBlob = await audioRecorderRef.current.cutUtterance();
            if (audioBlob) {
              const settings = await getSetting<AISettings>('ai_settings', {
                provider: 'groq',
                apiKey: '',
              });
              if (settings.apiKey) {
                const res = await transcribeAudio(settings, audioBlob, language, contentRef.current);
                if (res.success && typeof res.result === 'string' && res.result.trim()) {
                  const refined = res.result.trim();
                  setContent((prev) => {
                    if (prev.endsWith(tempLine)) {
                      const updated = prev.slice(0, prev.length - tempLine.length) + refined;
                      contentRef.current = updated;
                      return updated;
                    } else if (prev.includes(tempLine)) {
                      const lastIndex = prev.lastIndexOf(tempLine);
                      const updated = prev.slice(0, lastIndex) + refined + prev.slice(lastIndex + tempLine.length);
                      contentRef.current = updated;
                      return updated;
                    }
                    return prev;
                  });
                }
              }
            }
          } catch (err) {
            console.warn('Whisper refinement error:', err);
          } finally {
            setIsTranscribingWhisper(false);
          }
        }
      }
    },
    [engine, language]
  );

  // Speech Recognition for live visual feedback
  useEffect(() => {
    speechServiceRef.current = new SpeechService(
      {
        onFinalTranscript: (text) => {
          if (silenceDebounceTimerRef.current) {
            clearTimeout(silenceDebounceTimerRef.current);
            silenceDebounceTimerRef.current = null;
          }
          interimSpeechRef.current = '';
          setInterimContent('');
          const trimmed = text.trim();
          if (trimmed) {
            commitUtterance(trimmed);
          }
        },
        onInterimTranscript: (text) => {
          setInterimContent(text);
          interimSpeechRef.current = text;

          // Clear previous silence timer
          if (silenceDebounceTimerRef.current) {
            clearTimeout(silenceDebounceTimerRef.current);
            silenceDebounceTimerRef.current = null;
          }

          // If speech is detected, start a 1000ms countdown of silence to commit
          // This guarantees that when the user stops speaking, it NEVER disappears!
          if (text.trim()) {
            silenceDebounceTimerRef.current = setTimeout(() => {
              if (interimSpeechRef.current.trim()) {
                const speechToCommit = interimSpeechRef.current.trim();
                interimSpeechRef.current = '';
                setInterimContent('');
                commitUtterance(speechToCommit);
              }
            }, 1000);
          }
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

  // Timer loop when recording
  useEffect(() => {
    let interval: any = null;
    if (speechState === 'recording') {
      interval = setInterval(() => {
        setDurationSeconds((sec) => sec + 1);
      }, 1000);
    } else {
      if (interval) clearInterval(interval);
    }
    return () => {
      if (interval) clearInterval(interval);
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
        alert('Mode Whisper AI membutuhkan API Key (Groq / OpenAI / Gemini). Silakan simpan API Key Anda di menu Pengaturan.');
        return;
      }
    }
    setEngine(newEngine);
  };

  // Controls Handlers
  const handleStart = async () => {
    if (engine === 'whisper') {
      const settings = await getSetting<AISettings>('ai_settings', {
        provider: 'groq',
        apiKey: '',
      });
      if (!settings.apiKey) {
        setIsSettingsOpen(true);
        alert('Silakan masukkan API Key (Groq / OpenAI / Gemini) terlebih dahulu di Pengaturan untuk mengaktifkan transkripsi akurat Whisper AI.');
        return;
      }
      try {
        await audioRecorderRef.current?.start();
      } catch (err: any) {
        alert(`Gagal mengakses mikrofon untuk perekaman audio: ${err.message}`);
        return;
      }
    }

    speechServiceRef.current?.setLanguage(language);
    speechServiceRef.current?.start();
  };

  const handlePause = () => {
    speechServiceRef.current?.pause();
    if (engine === 'whisper') {
      audioRecorderRef.current?.pause();
    }
    persistTranscript();
  };

  const handleResume = () => {
    speechServiceRef.current?.resume();
    if (engine === 'whisper') {
      audioRecorderRef.current?.resume();
    }
  };

  const handleStop = async () => {
    if (silenceDebounceTimerRef.current) {
      clearTimeout(silenceDebounceTimerRef.current);
      silenceDebounceTimerRef.current = null;
    }
    if (interimSpeechRef.current.trim()) {
      const remainingSpeech = interimSpeechRef.current.trim();
      interimSpeechRef.current = '';
      await commitUtterance(remainingSpeech);
    }

    speechServiceRef.current?.stop();
    setInterimContent('');

    if (engine === 'whisper' && audioRecorderRef.current) {
      try {
        await audioRecorderRef.current.stop();
        persistTranscript();
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

    setActiveId(null);
    setTitle('Transkrip Baru');
    setContent('');
    setInterimContent('');
    setDurationSeconds(0);
    setAiSummary(undefined);
    setAiActionItems(undefined);
  };

  const handleSelectTranscript = (id: number) => {
    if (speechState !== 'idle') {
      speechServiceRef.current?.stop();
      if (engine === 'whisper') {
        audioRecorderRef.current?.stop();
      }
    }
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
    createdAt: activeId ? transcripts.find((t) => t.id === activeId)?.createdAt || new Date() : new Date(),
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 font-sans">
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
      />

      {/* Main Workspace Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden p-3 sm:p-5 lg:p-6 gap-3.5">
        {/* Top Bar on Mobile for sidebar trigger */}
        <div className="flex lg:hidden items-center justify-between bg-white px-4 py-2.5 rounded-2xl border border-slate-200 shadow-xs">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="flex items-center gap-2 text-xs font-semibold text-slate-700 p-1.5 rounded-lg hover:bg-slate-100"
          >
            <PanelLeft className="w-4 h-4 text-indigo-600" />
            <span>Riwayat Transkrip</span>
          </button>
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="Logo" className="w-5 h-5 rounded-md" />
            <span className="text-xs font-bold text-slate-800">Transkrip Kilat</span>
          </div>
        </div>

        {/* 1. Recording Controls Bar with Engine Toggle */}
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
        />

        {/* 2. Main Live Transcript Editor with Sentence Dialog View */}
        <TranscriptEditor
          title={title}
          onTitleChange={setTitle}
          content={content}
          interimContent={interimContent}
          onContentChange={setContent}
          isRecording={speechState === 'recording'}
          aiSummary={aiSummary}
          aiActionItems={aiActionItems}
          onClearAiSummary={() => setAiSummary(undefined)}
          onClearAiActions={() => setAiActionItems(undefined)}
        />

        {/* 3. Export & Action Toolbar */}
        <ExportToolbar
          currentRecord={currentRecord}
        />
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
