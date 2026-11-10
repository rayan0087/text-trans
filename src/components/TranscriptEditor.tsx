import React from 'react';
import { Check, FileText, CheckSquare, Trash, Sparkles } from 'lucide-react';

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
  onOpenAiAssistant?: () => void;
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
  onOpenAiAssistant,
}) => {
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  return (
    <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
      {/* Editor Header / Title bar */}
      <div className="px-6 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">
        <input
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Judul Rekaman..."
          className="text-lg font-bold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-600 focus:outline-none transition-colors w-full sm:w-auto flex-1 min-w-[200px]"
        />

        {/* Word count, status, and Quick AI button at top */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400">
            <span className="flex items-center gap-1 text-emerald-600 font-medium">
              <Check className="w-3.5 h-3.5" />
              <span>Tersimpan</span>
            </span>
            <span className="text-slate-300">•</span>
            <span>{wordCount} kata</span>
            <span className="text-slate-300">•</span>
            <span>{charCount} karakter</span>
          </div>

          {onOpenAiAssistant && (
            <button
              onClick={onOpenAiAssistant}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-all active:scale-95"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Asisten AI</span>
            </button>
          )}
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex-1 p-6 flex flex-col overflow-y-auto space-y-4">
        {/* Live Interim Speech Preview moved to TOP */}
        {interimContent && (
          <div className="p-3 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200/80 rounded-xl text-sm font-medium text-indigo-900 italic shadow-xs flex items-center gap-2.5 animate-fadeIn">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-600"></span>
            </span>
            <div className="flex-1">
              <span className="text-[11px] font-bold text-indigo-600 block uppercase tracking-wider not-italic mb-0.5">
                Sedang Mendengarkan (Live):
              </span>
              <span>{interimContent}</span>
            </div>
          </div>
        )}

        {/* Main Text Area */}
        <div className="relative flex-1 min-h-[220px]">
          <textarea
            value={content}
            onChange={(e) => onContentChange(e.target.value)}
            placeholder={
              isRecording
                ? 'Sedang mendengarkan suara Anda...'
                : 'Mulai bicara, teks Anda akan otomatis tertulis di sini secara real-time. Anda juga bisa mengedit atau mengetik langsung di sini...'
            }
            className="w-full h-full min-h-[220px] resize-none text-base text-slate-800 leading-relaxed font-sans placeholder:text-slate-300 focus:outline-none bg-transparent"
          />
        </div>

        {/* AI Attachments Section (If any) */}
        {(aiSummary || aiActionItems) && (
          <div className="pt-4 border-t border-slate-100 space-y-4">
            {aiSummary && (
              <div className="p-4 bg-purple-50/60 border border-purple-100 rounded-2xl relative">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-purple-900 uppercase tracking-wider">
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
