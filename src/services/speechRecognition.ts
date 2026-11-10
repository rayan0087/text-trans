// Browser SpeechRecognition Type Declarations
interface IWindow extends Window {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
}

export type SpeechState = 'idle' | 'recording' | 'paused';

export interface SpeechCallbacks {
  onFinalTranscript: (text: string) => void;
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

  private initRecognition(): void {
    const win = window as unknown as IWindow;
    const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      this.callbacks.onError('Browser ini belum mendukung Web Speech API. Disarankan menggunakan Google Chrome atau Microsoft Edge.');
      return;
    }

    try {
      this.recognition = new SpeechRecognitionClass();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = this.language;

      this.recognition.onstart = () => {
        if (!this.isPaused) {
          this.callbacks.onStateChange('recording');
        }
      };

      this.recognition.onresult = (event: any) => {
        let interimStr = '';
        let finalStr = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcriptChunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalStr += transcriptChunk + ' ';
          } else {
            interimStr += transcriptChunk;
          }
        }

        if (finalStr.trim()) {
          this.currentInterim = '';
          this.callbacks.onFinalTranscript(finalStr);
        }
        
        if (interimStr.trim()) {
          this.currentInterim = interimStr;
        }
        this.callbacks.onInterimTranscript(interimStr);
      };

      this.recognition.onerror = (event: any) => {
        // Ignorable errors like 'no-speech' or 'aborted'
        if (event.error === 'no-speech') {
          return;
        }
        if (event.error === 'aborted') {
          return;
        }

        let userFriendlyError = `Speech recognition error: ${event.error}`;
        if (event.error === 'not-allowed') {
          userFriendlyError = 'Akses mikrofon ditolak. Izinkan mikrofon di pengaturan browser untuk mulai merekam.';
        } else if (event.error === 'network') {
          userFriendlyError = 'Kendala jaringan koneksi speech recognition. Pastikan internet Anda aktif.';
        }
        this.callbacks.onError(userFriendlyError);
      };

      this.recognition.onend = () => {
        // If there was unfinalized speech when recognition ended/paused, finalize it so it is not lost
        if (this.currentInterim.trim()) {
          this.callbacks.onFinalTranscript(this.currentInterim);
          this.currentInterim = '';
        }

        // Auto restart if still supposed to be listening and not paused
        if (this.isListening && !this.isPaused) {
          try {
            this.recognition.start();
          } catch (e) {
            // ignore start collisions
          }
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
        // onend will automatically restart with new lang
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
    try {
      this.recognition.start();
      this.callbacks.onStateChange('recording');
    } catch (e) {
      // might already be started
    }
  }

  public pause(): void {
    if (!this.isListening || this.isPaused) return;
    this.isPaused = true;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }
    this.callbacks.onStateChange('paused');
    this.callbacks.onInterimTranscript('');
  }

  public resume(): void {
    if (!this.isListening || !this.isPaused) return;
    this.isPaused = false;
    if (this.recognition) {
      try {
        this.recognition.start();
        this.callbacks.onStateChange('recording');
      } catch (e) {}
    }
  }

  public stop(): void {
    this.isListening = false;
    this.isPaused = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }
    this.callbacks.onStateChange('idle');
    this.callbacks.onInterimTranscript('');
  }
}
