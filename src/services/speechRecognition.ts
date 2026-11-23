// Browser SpeechRecognition Type Declarations
interface IWindow extends Window {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
}

export type SpeechState = 'idle' | 'recording' | 'paused';

export interface SpeechCallbacks {
  onFinalTranscript: (text: string, replaceLastLine?: boolean) => void;
  onInterimTranscript: (text: string) => void;
  onStateChange: (state: SpeechState) => void;
  onError: (errorMsg: string) => void;
}

export class SpeechService {
  private recognition: any = null;
  private isListening: boolean = false;
  private isPaused: boolean = false;
  private language: string = 'id-ID';
  private currentInterim: string = '';
  private lastInterimText: string = '';
  private currentResultIndex: number = -1;
  private flushedResultIndex: number = -1;
  private silenceTimer: any = null;
  private callbacks: SpeechCallbacks;

  constructor(callbacks: SpeechCallbacks, language: string = 'id-ID') {
    this.callbacks = callbacks;
    this.language = language;
    this.initRecognition();
  }

  public static isSupported(): boolean {
    const win = window as unknown as IWindow;
    return !!(win.SpeechRecognition || win.webkitSpeechRecognition);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private flushInterim(): void {
    this.clearSilenceTimer();
    const textToCommit = this.currentInterim.trim();
    if (textToCommit) {
      const shouldReplaceLast =
        this.currentResultIndex !== -1 &&
        this.flushedResultIndex === this.currentResultIndex;

      this.flushedResultIndex = this.currentResultIndex;
      this.currentInterim = '';
      this.lastInterimText = '';
      this.callbacks.onInterimTranscript('');
      this.callbacks.onFinalTranscript(textToCommit, shouldReplaceLast);
    }
  }

  private initRecognition(): void {
    const win = window as unknown as IWindow;
    const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      this.callbacks.onError(
        'Browser ini belum mendukung Web Speech API. Disarankan menggunakan Google Chrome atau Microsoft Edge.'
      );
      return;
    }

    try {
      this.recognition = new SpeechRecognitionClass();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;
      this.recognition.lang = this.language;

      this.recognition.onstart = () => {
        this.currentResultIndex = -1;
        this.flushedResultIndex = -1;
        if (!this.isPaused) {
          this.callbacks.onStateChange('recording');
        }
      };

      this.recognition.onresult = (event: any) => {
        let interimStr = '';
        let latestInterimIndex = -1;

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcriptChunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            const finalChunk = transcriptChunk.trim();
            if (finalChunk) {
              const shouldReplaceLast = this.flushedResultIndex === i;
              if (this.flushedResultIndex === i) {
                this.flushedResultIndex = -1;
              }
              this.clearSilenceTimer();
              this.currentInterim = '';
              this.lastInterimText = '';
              this.callbacks.onInterimTranscript('');
              this.callbacks.onFinalTranscript(finalChunk, shouldReplaceLast);
            }
          } else {
            if (latestInterimIndex === -1) {
              latestInterimIndex = i;
            }
            interimStr += transcriptChunk;
          }
        }

        if (interimStr.trim()) {
          this.currentResultIndex = latestInterimIndex;
          const trimmedInterim = interimStr.trim();
          const isNewText = trimmedInterim !== this.lastInterimText.trim();
          this.currentInterim = interimStr;
          this.callbacks.onInterimTranscript(interimStr);

          // Reset silence timer ONLY when actual new speech words arrive
          if (isNewText) {
            this.lastInterimText = interimStr;
            this.clearSilenceTimer();
            this.silenceTimer = setTimeout(() => {
              this.flushInterim();
            }, 900);
          }
        }
      };

      this.recognition.onerror = (event: any) => {
        if (event.error === 'no-speech' || event.error === 'aborted') {
          return;
        }

        let userFriendlyError = `Speech recognition error: ${event.error}`;
        if (event.error === 'not-allowed') {
          userFriendlyError =
            'Akses mikrofon ditolak. Izinkan mikrofon di pengaturan browser untuk mulai merekam.';
        } else if (event.error === 'network') {
          userFriendlyError =
            'Kendala jaringan koneksi speech recognition. Pastikan internet Anda aktif.';
        }
        this.callbacks.onError(userFriendlyError);
      };

      this.recognition.onend = () => {
        this.clearSilenceTimer();

        if (this.currentInterim.trim()) {
          const text = this.currentInterim.trim();
          const shouldReplaceLast =
            this.currentResultIndex !== -1 &&
            this.flushedResultIndex === this.currentResultIndex;
          this.currentInterim = '';
          this.lastInterimText = '';
          this.callbacks.onInterimTranscript('');
          this.callbacks.onFinalTranscript(text, shouldReplaceLast);
        }

        this.currentResultIndex = -1;
        this.flushedResultIndex = -1;

        // Auto restart immediately if still listening and not paused
        if (this.isListening && !this.isPaused) {
          setTimeout(() => {
            if (this.isListening && !this.isPaused && this.recognition) {
              try {
                this.recognition.start();
              } catch {
                // ignore start collisions
              }
            }
          }, 30);
        } else if (this.isPaused) {
          this.callbacks.onStateChange('paused');
        } else {
          this.callbacks.onStateChange('idle');
          this.callbacks.onInterimTranscript('');
        }
      };
    } catch (err: any) {
      this.callbacks.onError(`Gagal menginisialisasi mikrofon: ${err.message}`);
    }
  }

  public setLanguage(lang: string): void {
    this.language = lang;
    if (this.recognition) {
      const wasListening = this.isListening;
      this.recognition.lang = lang;
      if (wasListening && !this.isPaused) {
        this.recognition.stop();
      }
    }
  }

  public start(): void {
    if (!this.recognition) {
      this.initRecognition();
    }
    if (!this.recognition) return;

    this.isListening = true;
    this.isPaused = false;
    this.currentInterim = '';
    this.lastInterimText = '';
    this.currentResultIndex = -1;
    this.flushedResultIndex = -1;
    this.clearSilenceTimer();
    try {
      this.recognition.start();
      this.callbacks.onStateChange('recording');
    } catch {
      // might already be started
    }
  }

  public pause(): void {
    if (!this.isListening || this.isPaused) return;
    this.isPaused = true;
    this.flushInterim();
    this.currentResultIndex = -1;
    this.flushedResultIndex = -1;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {}
    }
    this.callbacks.onStateChange('paused');
    this.callbacks.onInterimTranscript('');
  }

  public resume(): void {
    if (!this.isListening || !this.isPaused) return;
    this.isPaused = false;
    this.currentInterim = '';
    this.lastInterimText = '';
    this.currentResultIndex = -1;
    this.flushedResultIndex = -1;
    this.clearSilenceTimer();
    if (this.recognition) {
      try {
        this.recognition.start();
        this.callbacks.onStateChange('recording');
      } catch {}
    }
  }

  public stop(): void {
    this.isListening = false;
    this.isPaused = false;
    this.flushInterim();
    this.currentResultIndex = -1;
    this.flushedResultIndex = -1;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {}
    }
    this.callbacks.onStateChange('idle');
    this.callbacks.onInterimTranscript('');
  }
}
