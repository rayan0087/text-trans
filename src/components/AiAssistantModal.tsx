import React, { useState } from 'react';
import { Sparkles, FileText, CheckSquare, Wand2, X, Copy, Check, AlertCircle, Settings, Loader2, ArrowRight } from 'lucide-react';
import { executeAITask, type AISettings } from '../services/aiService';
import { getSetting } from '../db';

interface AiAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  transcriptContent: string;
  onApplyPolished: (newText: string) => void;
  onSaveSummary: (summaryText: string) => void;
  onSaveActions: (actionsText: string) => void;
  onOpenSettings: () => void;
}

export const AiAssistantModal: React.FC<AiAssistantModalProps> = ({
  isOpen,
  onClose,
  transcriptContent,
  onApplyPolished,
  onSaveSummary,
  onSaveActions,
  onOpenSettings,
}) => {
  const [activeTab, setActiveTab] = useState<'polish' | 'summarize' | 'actions'>('polish');
  const [loading, setLoading] = useState(false);
  const [resultText, setResultText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);

  if (!isOpen) return null;

  const handleRunAI = async (type: 'polish' | 'summarize' | 'actions') => {
    setActiveTab(type);
    setErrorMsg('');
    setResultText('');
    setCopied(false);
    setApplied(false);

    if (!transcriptContent || !transcriptContent.trim()) {
      setErrorMsg('Transkrip masih kosong. Mulai rekam suara terlebih dahulu.');
      return;
    }

    const settings = await getSetting<AISettings>('ai_settings', {
      provider: 'gemini',
      apiKey: '',
    });

    if (!settings.apiKey) {
      setErrorMsg('API Key AI belum diatur. Silakan atur API Key gratis di menu Pengaturan.');
      return;
    }

    setLoading(true);
    const response = await executeAITask(settings, type, transcriptContent);
    setLoading(false);

    if (response.success && response.result) {
      setResultText(response.result);
    } else {
      setErrorMsg(response.error || 'Gagal memproses dengan AI.');
    }
  };

  const handleCopy = () => {
    if (!resultText) return;
    navigator.clipboard.writeText(resultText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApply = () => {
    if (!resultText) return;
    if (activeTab === 'polish') {
      onApplyPolished(resultText);
    } else if (activeTab === 'summarize') {
      onSaveSummary(resultText);
    } else if (activeTab === 'actions') {
      onSaveActions(resultText);
    }
    setApplied(true);
    setTimeout(() => {
      setApplied(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-linear-to-r from-indigo-50/50 to-purple-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 text-base">Asisten AI Transkrip</h3>
              <p className="text-xs text-slate-500">Olah rekaman Anda dengan model AI (Gemini / Groq / OpenAI)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1 hover:bg-slate-200/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 flex-1 overflow-y-auto space-y-5">
          {/* Action Tabs */}
          <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 rounded-xl">
            <button
              onClick={() => handleRunAI('polish')}
              disabled={loading}
              className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'polish'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Wand2 className="w-4 h-4" />
              <span>Rapikan Teks</span>
            </button>
            <button
              onClick={() => handleRunAI('summarize')}
              disabled={loading}
              className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'summarize'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Ringkasan Rapat</span>
            </button>
            <button
              onClick={() => handleRunAI('actions')}
              disabled={loading}
              className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'actions'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CheckSquare className="w-4 h-4" />
              <span>Action Items</span>
            </button>
          </div>

          {/* Error Banner */}
          {errorMsg && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start justify-between gap-3 text-xs text-rose-800">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
              {errorMsg.includes('API Key') && (
                <button
                  onClick={() => {
                    onClose();
                    onOpenSettings();
                  }}
                  className="inline-flex items-center gap-1 font-semibold text-rose-700 hover:underline shrink-0"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Buka Pengaturan</span>
                </button>
              )}
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
              <p className="text-sm font-medium text-slate-600">Sedang memproses dengan AI...</p>
              <p className="text-xs text-slate-400">Menganalisis konteks dan menyusun hasil</p>
            </div>
          )}

          {/* Result Box */}
          {!loading && resultText && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Hasil Pemrosesan ({activeTab})
                </span>
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-indigo-600 font-medium transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Tersalin!' : 'Salin Teks'}</span>
                </button>
              </div>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl max-h-60 overflow-y-auto text-sm text-slate-800 whitespace-pre-wrap leading-relaxed font-sans">
                {resultText}
              </div>
            </div>
          )}

          {/* Initial Prompt State if no action clicked yet */}
          {!loading && !resultText && !errorMsg && (
            <div className="text-center py-8 text-slate-400 space-y-2">
              <Sparkles className="w-10 h-10 mx-auto text-indigo-300 stroke-1" />
              <p className="text-sm font-medium text-slate-600">Pilih salah satu tindakan AI di atas</p>
              <p className="text-xs max-w-sm mx-auto text-slate-400">
                AI akan membantu memoles tanda baca, merangkum inti pembicaraan, atau mengekstrak daftar tugas penting.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/70">
          <button
            onClick={() => {
              onClose();
              onOpenSettings();
            }}
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Pengaturan API Key</span>
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200/50 rounded-xl transition-colors"
            >
              Tutup
            </button>
            {resultText && (
              <button
                onClick={handleApply}
                disabled={applied}
                className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-all active:scale-98"
              >
                {applied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-300" />
                    <span>Diterapkan!</span>
                  </>
                ) : (
                  <>
                    <span>{activeTab === 'polish' ? 'Gantikan ke Transkrip' : 'Simpan ke Transkrip'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
