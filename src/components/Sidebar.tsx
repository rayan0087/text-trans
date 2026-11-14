import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  Trash2, 
  Mic, 
  Clock, 
  Calendar, 
  Settings, 
  ShieldCheck, 
  FileText,
  ChevronRight,
  PanelLeftClose,
  Moon,
  Sun,
} from 'lucide-react';
import { type TranscriptRecord } from '../db';
import { formatDuration } from '../services/exportService';

interface SidebarProps {
  transcripts: TranscriptRecord[];
  activeId: number | null;
  onSelectTranscript: (id: number) => void;
  onNewTranscript: () => void;
  onDeleteTranscript: (id: number) => void;
  onOpenSettings: () => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  transcripts,
  activeId,
  onSelectTranscript,
  onNewTranscript,
  onDeleteTranscript,
  onOpenSettings,
  isOpen,
  onToggleOpen,
  theme,
  onToggleTheme,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTranscripts = transcripts.filter((t) => {
    const q = searchQuery.toLowerCase();
    return (
      t.title.toLowerCase().includes(q) ||
      (t.content && t.content.toLowerCase().includes(q))
    );
  });

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          onClick={onToggleOpen}
          className="fixed inset-0 bg-slate-900/30 z-30 lg:hidden backdrop-blur-xs"
        />
      )}

      {/* Sidebar Panel */}
      <aside
        className={`fixed lg:static top-0 bottom-0 left-0 z-40 w-72 sm:w-80 bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800 flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 lg:w-72 sm:lg:w-80'
        }`}
      >
        {/* App Branding */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-200 dark:shadow-none">
              <Mic className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-slate-800 dark:text-slate-100 text-base leading-tight">Transkrip Kilat</h1>
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Browser Local Engine
              </span>
            </div>
          </div>
          <button
            onClick={onToggleOpen}
            className="lg:hidden p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <PanelLeftClose className="w-5 h-5" />
          </button>
        </div>

        {/* New Session Button */}
        <div className="p-3">
          <button
            onClick={() => {
              onNewTranscript();
              if (window.innerWidth < 1024) onToggleOpen();
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold shadow-sm shadow-indigo-200 dark:shadow-none hover:shadow-indigo-300 transition-all active:scale-98"
          >
            <Plus className="w-4 h-4" />
            <span>Rekaman Baru</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari riwayat transkrip..."
              className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all"
            />
          </div>
        </div>

        {/* Transcript History List */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Riwayat Lokal ({filteredTranscripts.length})
            </span>
          </div>

          {filteredTranscripts.length === 0 ? (
            <div className="text-center py-10 px-4 text-slate-400 dark:text-slate-600">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs font-medium">Belum ada rekaman tersimpan</p>
              <p className="text-[11px] mt-1 text-slate-400 dark:text-slate-600">
                Mulai merekam untuk membuat transkrip pertama Anda.
              </p>
            </div>
          ) : (
            filteredTranscripts.map((item) => {
              const isSelected = activeId === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (item.id) onSelectTranscript(item.id);
                    if (window.innerWidth < 1024) onToggleOpen();
                  }}
                  className={`group relative flex flex-col p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800 shadow-xs'
                      : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:border-slate-200/60 dark:hover:border-slate-700/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span
                      className={`text-xs font-semibold truncate flex-1 ${
                        isSelected ? 'text-indigo-900 dark:text-indigo-200' : 'text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {item.title || 'Transkrip Tanpa Judul'}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.id && confirm('Hapus rekaman ini dari IndexedDB lokal?')) {
                          onDeleteTranscript(item.id);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition-all"
                      title="Hapus rekaman"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                    {item.content || '(Belum ada teks)'}
                  </p>

                  <div className="flex items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500 mt-2">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDuration(item.durationSeconds || 0)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(item.createdAt).toLocaleDateString('id-ID', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                    {item.aiSummary && (
                      <span className="ml-auto px-1.5 py-0.2 bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 font-semibold rounded text-[9px]">
                        AI
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Area: Settings, Dark Mode Toggle, & Privacy Info */}
        <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 space-y-2">
          {/* Theme Toggle Button */}
          <button
            onClick={onToggleTheme}
            className="w-full flex items-center justify-between p-2 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 transition-all"
          >
            <div className="flex items-center gap-2">
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-indigo-600" />
              )}
              <span>{theme === 'dark' ? 'Tema Terang (Light)' : 'Tema Gelap (Dark)'}</span>
            </div>
            <span className="text-[10px] font-mono uppercase bg-slate-200/80 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400">
              {theme}
            </span>
          </button>

          {/* Settings Button */}
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center justify-between p-2 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 transition-all"
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <span>Pengaturan & API Key</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          </button>

          <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-slate-400 dark:text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Privat • IndexedDB Browser</span>
          </div>
        </div>
      </aside>
    </>
  );
};
