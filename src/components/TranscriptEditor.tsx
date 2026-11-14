import React, { useState, useRef, useEffect } from 'react';
import { Check, FileText, CheckSquare, Trash, MessageSquare, Edit3, UserCheck } from 'lucide-react';

interface TranscriptEditorProps {
  title: string;
  onTitleChange: (newTitle: string) => void;
  content: string;
  interimContent: string;
  onContentChange: (newContent: string) => void;
  isRecording: boolean;
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
  aiSummary,
  aiActionItems,
  onClearAiSummary,
  onClearAiActions,
}) => {
  const [viewMode, setViewMode] = useState<'dialog' | 'raw'>('dialog');
  const [editingSpeakerOld, setEditingSpeakerOld] = useState<string | null>(null);
  const [editingSpeakerNew, setEditingSpeakerNew] = useState('');
  
  const containerRef = useRef<HTMLDivElement>(null);

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  // Split lines for dialog view
  const lines = content.split('\n').filter((l) => l.trim().length > 0);

  // Auto-scroll when new text arrives while recording
  useEffect(() => {
    if (isRecording && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [content, interimContent, isRecording]);

  const handleRenameSpeaker = (oldName: string) => {
    if (!editingSpeakerNew.trim() || editingSpeakerNew.trim() === oldName) {
      setEditingSpeakerOld(null);
      return;
    }
    const newName = editingSpeakerNew.trim();
    // Replace all instances of [oldName] in the text
    const escapedOld = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\[${escapedOld}\\]`, 'g');
    const updated = content.replace(regex, `[${newName}]`);
    onContentChange(updated);
    setEditingSpeakerOld(null);
    setEditingSpeakerNew('');
  };

  // Helper to format line with speaker highlight if present
  const renderDialogLine = (line: string, index: number) => {
    const speakerRegex = /^(\*\*\[.*?\]\*\*|\*\[.*?\]\*|\[.*?\]|Pembicara\s+[A-Za-z0-9]+:?|Mas\s+\w+:?|Pak\s+\w+:?|Bu\s+\w+:?):?\s*(.*)$/i;
    const match = line.match(speakerRegex);

    if (match) {
      const speakerName = match[1].replace(/[*\[\]:]/g, '').trim();
      const speechText = match[2];
      const isEditingThis = editingSpeakerOld === speakerName;

      return (
        <div
          key={index}
          className="border-l-[3px] border-sky-400 pl-3.5 py-1 text-slate-800 dark:text-slate-100 leading-relaxed transition-colors hover:bg-sky-50/40 dark:hover:bg-sky-950/20 rounded-r-lg group"
        >
          <div className="flex items-center gap-2 mb-1">
            {isEditingThis ? (
              <div className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-sky-300 dark:border-sky-600 p-1 rounded-lg shadow-xs">
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
                onClick={() => {
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
          <p className="text-[15px] text-slate-800 dark:text-slate-200">{speechText}</p>
        </div>
      );
    }

    return (
      <div
        key={index}
        className="border-l-[3px] border-sky-400 pl-3.5 py-1 text-slate-800 dark:text-slate-200 leading-relaxed text-[15px] transition-colors hover:bg-sky-50/40 dark:hover:bg-sky-950/20 rounded-r-lg"
      >
        <p>{line}</p>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden transition-colors">
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
                viewMode === 'dialog' ? 'bg-white dark:bg-slate-700 text-sky-700 dark:text-sky-300 shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
              title="Tampilan dialog bergaris kiri seperti di notulensi rapat"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Dialog</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('raw')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all ${
                viewMode === 'raw' ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
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
                {lines.map((line, idx) => renderDialogLine(line, idx))}
                {interimContent && (
                  <div className="border-l-[3px] border-amber-400 bg-amber-50/50 dark:bg-amber-950/30 pl-3.5 py-1.5 rounded-r-lg text-slate-700 dark:text-slate-300 animate-pulse transition-all">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-100/90 dark:bg-amber-900/60 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping inline-block" />
                        Bicara Aktif
                      </span>
                    </div>
                    <p className="text-[15px] italic text-slate-600 dark:text-slate-400 leading-relaxed">&ldquo;{interimContent}&rdquo;</p>
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
                <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {aiSummary}
                </div>
              </div>
            )}

            {aiActionItems && (
              <div className="p-4 bg-teal-50/60 border border-teal-100 rounded-2xl relative">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-teal-900 uppercase tracking-wider">
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
                <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
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
