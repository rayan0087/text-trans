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
import { PanelLeft, Loader2 } from 'lucide-react';

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
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [uploadStatusMessage, setUploadStatusMessage] = useState('');
  const isTranscribingWhisper = isUploadingAudio;

  // Service References
  const speechServiceRef = useRef<SpeechService | null>(null);
  const audioRecorderRef = useRef<AudioRecorderService | null>(null);

  // Modals & UI Layout
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Ref to track latest content for speech callbacks without closure traps
  const contentRef = useRef(content);
  contentRef.current = content;

  // Unfinalized speech ref
  const interimSpeechRef = useRef<string>('');

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

  // Initialize Speech Services & Audio Recorder
  useEffect(() => {
    setIsSupported(SpeechService.isSupported());
    audioRecorderRef.current = new AudioRecorderService();

    getSetting<AISettings>('ai_settings', { provider: 'groq', apiKey: '' }).then((saved) => {
      if (saved && saved.apiKey) {
        setEngine('whisper');
      } else {
        setEngine('browser');
      }
    });
  }, []);

  // Commit an utterance into the transcript (strictly and faithfully records what was in "Bicara Aktif" with smart deduplication)
  const commitUtterance = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      setContent((prev) => {
        if (!prev) {
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

          // Case 1: Exact duplicate -> ignore
          if (normLast === normTrimmed) {
            return prev;
          }

          // Case 2: New text is an extended continuation of the last line -> update/replace the last line!
          // This completely eliminates cumulative interim duplication
          if (normTrimmed.startsWith(normLast + ' ') || (normLast.length > 3 && normTrimmed.startsWith(normLast))) {
            lines[lastNonEmptyIndex] = trimmed;
            const updated = lines.join('\n');
            contentRef.current = updated;
            return updated;
          }

          // Case 3: The last line already includes this new text completely -> ignore
          if (normLast.startsWith(normTrimmed + ' ') || normLast === normTrimmed) {
            return prev;
          }
        }

        // Case 4: Brand new utterance -> append on new line
        const separator = prev && !prev.endsWith('\n') ? '\n' : '';
        const updated = prev + separator + trimmed;
        contentRef.current = updated;
        return updated;
      });
    },
    []
  );

  // Speech Recognition for live visual feedback
  useEffect(() => {
    speechServiceRef.current = new SpeechService(
      {
        onFinalTranscript: (text) => {
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

  // Upload Audio File Transcription Handler
  const handleUploadAudio = async (file: File) => {
    // 1. Check file size (max 25MB for Groq & OpenAI Whisper)
    const maxSizeBytes = 25 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      alert(
        `Ukuran file "${file.name}" adalah ${(file.size / (1024 * 1024)).toFixed(1)} MB. Batas maksimal file audio untuk Whisper API adalah 25 MB.`
      );
      return;
    }

    // 2. Check API Key
    const settings = await getSetting<AISettings>('ai_settings', {
      provider: 'groq',
      apiKey: '',
    });
    if (!settings.apiKey || !settings.apiKey.trim()) {
      setIsSettingsOpen(true);
      alert('Untuk mentranskripsi file rekaman audio, dibutuhkan API Key Whisper AI (Groq / OpenAI / Gemini). Silakan masukkan API Key Anda di Pengaturan.');
      return;
    }

    // 3. Process transcription
    try {
      setIsUploadingAudio(true);
      setUploadStatusMessage(`Mentranskripsi "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB)... Harap tunggu sebentar.`);

      const res = await transcribeAudio(settings, file, language);
      if (res.success && typeof res.result === 'string' && res.result.trim()) {
        const fileBaseName = file.name.replace(/\.[^/.]+$/, '');
        const newTitle = `Transkrip - ${fileBaseName}`;
        setTitle(newTitle);
        setContent(res.result.trim());
        contentRef.current = res.result.trim();
        setEngine('whisper');
        await persistTranscript({
          title: newTitle,
          content: res.result.trim(),
        });
      } else {
        alert(`Gagal mentranskripsi file audio: ${res.error || 'Terjadi kesalahan saat memproses file audio.'}`);
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
    if (file && (file.type.startsWith('audio/') || file.type.startsWith('video/') || /\.(mp3|wav|m4a|ogg|webm|mp4)$/i.test(file.name))) {
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

      {/* Main Workspace Area with Drag and Drop Audio Support */}
      <main
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="flex-1 flex flex-col h-full overflow-hidden p-3 sm:p-5 lg:p-6 gap-3.5"
      >
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

        {/* Upload Audio File Progress Notification Banner */}
        {isUploadingAudio && (
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-3 rounded-2xl flex items-center justify-between gap-3 shadow-md animate-pulse">
            <div className="flex items-center gap-3 text-xs sm:text-sm font-semibold">
              <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin text-indigo-200 shrink-0" />
              <span>{uploadStatusMessage || 'Sedang memproses dan mentranskripsi file rekaman audio...'}</span>
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
