import React from 'react';
import { Check, FileText, CheckSquare, Trash } from 'lucide-react';

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
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  return (
    <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
      {/* Editor Header / Title bar */}
      <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/40">
        <input
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Judul Rekaman..."
          className="text-lg font-bold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-600 focus:outline-none transition-colors w-full sm:w-auto flex-1 min-w-[200px]"
        />

        {/* Word count & auto-save badge */}
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1 text-emerald-600 font-medium">
            <Check className="w-3.5 h-3.5" />
            <span>Tersimpan di IndexedDB</span>
          </span>
          <span className="text-slate-300">•</span>
          <span>{wordCount} kata</span>
          <span className="text-slate-300">•</span>
          <span>{charCount} karakter</span>
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex-1 p-6 flex flex-col overflow-y-auto space-y-6">
        {/* Main Text Area with live interim feedback */}
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

          {/* Interim floating bubble/text at the end if recording */}
          {interimContent && (
            <div className="mt-2 p-2.5 bg-indigo-50/70 border border-indigo-100 rounded-xl text-sm text-indigo-700 italic animate-pulse flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping"></span>
              <span>{interimContent}</span>
            </div>
          )}
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
