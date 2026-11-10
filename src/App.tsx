import { useState, useEffect, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type TranscriptRecord } from './db';
import { SpeechService, type SpeechState } from './services/speechRecognition';
import { Sidebar } from './components/Sidebar';
import { RecordingControls } from './components/RecordingControls';
import { TranscriptEditor } from './components/TranscriptEditor';
import { ExportToolbar } from './components/ExportToolbar';
import { SettingsModal } from './components/SettingsModal';
import { AiAssistantModal } from './components/AiAssistantModal';
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

  // Recording State & Service
  const [speechState, setSpeechState] = useState<SpeechState>('idle');
  const [isSupported, setIsSupported] = useState(true);
  const speechServiceRef = useRef<SpeechService | null>(null);

  // Modals & UI Layout
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);

  // Ref to track latest content for speech callbacks without closure traps
  const contentRef = useRef(content);
  contentRef.current = content;

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
        // Only create new entry if there's actual content or user changed title
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

  // Check Web Speech API support
  useEffect(() => {
    setIsSupported(SpeechService.isSupported());
  }, []);

  // Initialize Speech Service
  useEffect(() => {
    speechServiceRef.current = new SpeechService(
      {
        onFinalTranscript: (text) => {
          setContent((prev) => {
            const separator = prev && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : '';
            const updated = prev + separator + text;
            contentRef.current = updated;
            return updated;
          });
          setInterimContent('');
        },
        onInterimTranscript: (text) => {
          setInterimContent(text);
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
  }, []);

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

  // Controls Handlers
  const handleStart = () => {
    speechServiceRef.current?.setLanguage(language);
    speechServiceRef.current?.start();
  };

  const handlePause = () => {
    speechServiceRef.current?.pause();
    persistTranscript();
  };

  const handleResume = () => {
    speechServiceRef.current?.resume();
  };

  const handleStop = () => {
    speechServiceRef.current?.stop();
    setInterimContent('');
    persistTranscript();
  };

  const handleLanguageChange = (newLang: string) => {
    setLanguage(newLang);
    speechServiceRef.current?.setLanguage(newLang);
  };

  // Switch / Create New Session
  const handleNewTranscript = async () => {
    // If current one has text, save it first
    if (content.trim()) {
      await persistTranscript();
    }
    if (speechState !== 'idle') {
      speechServiceRef.current?.stop();
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

  // AI Result Handlers
  const handleApplyPolished = (newText: string) => {
    setContent(newText);
    persistTranscript({ content: newText });
  };

  const handleSaveSummary = (summaryText: string) => {
    setAiSummary(summaryText);
    persistTranscript({ aiSummary: summaryText });
  };

  const handleSaveActions = (actionsText: string) => {
    setAiActionItems(actionsText);
    persistTranscript({ aiActionItems: actionsText });
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
          <span className="text-xs font-bold text-slate-800">Transkrip Kilat</span>
        </div>

        {/* 1. Recording Controls Bar */}
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
        />

        {/* 2. Main Live Transcript Editor */}
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
          onOpenAiAssistant={() => setIsAiModalOpen(true)}
        />

        {/* 3. Export & Action Toolbar */}
        <ExportToolbar
          currentRecord={currentRecord}
          onOpenAiAssistant={() => setIsAiModalOpen(true)}
        />
      </main>

      {/* Settings Modal (BYOK AI) */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* AI Assistant Modal */}
      <AiAssistantModal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        transcriptContent={content}
        onApplyPolished={handleApplyPolished}
        onSaveSummary={handleSaveSummary}
        onSaveActions={handleSaveActions}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
    </div>
  );
}

export default App;
