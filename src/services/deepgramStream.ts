import { type SpeechState } from './speechRecognition';

export interface DeepgramStreamCallbacks {
  onFinalTranscript: (text: string, startSec: number, endSec: number) => void;
  onInterimTranscript: (text: string) => void;
  onStateChange: (state: SpeechState) => void;
  onError: (errorMsg: string) => void;
}

/**
 * True Real-Time WebSocket Streaming Service via Deepgram Nova-2
 * - ~250ms latency (Zoom-level responsiveness)
 * - Streams 200ms Opus audio frames directly over WebSocket (no file slicing / HTTP upload lag)
 * - Built-in smart punctuation, number formatting, and real-time speaker diarization
 */
export class DeepgramStreamingService {
  private ws: WebSocket | null = null;
  private streamRecorder: MediaRecorder | null = null;
  private keepAliveInterval: any = null;
  private isPaused: boolean = false;
  private isActive: boolean = false;
  private callbacks: DeepgramStreamCallbacks;

  constructor(callbacks: DeepgramStreamCallbacks) {
    this.callbacks = callbacks;
  }

  private getStreamMimeType(): string {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
    ];
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  }

  public async start(
    apiKey: string,
    stream: MediaStream,
    language: string = 'id-ID'
  ): Promise<boolean> {
    this.stop();

    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      this.callbacks.onError('API Key Deepgram kosong.');
      return false;
    }

    const langCode = language.startsWith('id') ? 'id' : 'en';
    const params = new URLSearchParams({
      model: 'nova-2',
      language: langCode,
      smart_format: 'true',
      punctuate: 'true',
      diarize: 'true',
      interim_results: 'true',
      utterance_end_ms: '1000',
      vad_events: 'true',
    });

    const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    return new Promise<boolean>((resolve) => {
      let resolved = false;

      try {
        const ws = new WebSocket(wsUrl, ['token', cleanKey]);
        this.ws = ws;

        const connectTimeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            this.stop();
            this.callbacks.onError('Koneksi WebSocket Deepgram timeout.');
            resolve(false);
          }
        }, 7000);

        ws.onopen = () => {
          clearTimeout(connectTimeout);
          this.isActive = true;
          this.isPaused = false;

          // Start streaming 200ms Opus audio frames directly over the WebSocket
          try {
            const mimeType = this.getStreamMimeType();
            const recOptions = mimeType ? { mimeType } : undefined;
            this.streamRecorder = new MediaRecorder(stream, recOptions);

            this.streamRecorder.ondataavailable = (event) => {
              if (
                event.data &&
                event.data.size > 0 &&
                this.ws &&
                this.ws.readyState === WebSocket.OPEN &&
                !this.isPaused
              ) {
                this.ws.send(event.data);
              }
            };

            this.streamRecorder.start(200);
          } catch (err: any) {
            this.callbacks.onError(`Gagal memulai audio stream: ${err.message}`);
            this.stop();
            if (!resolved) {
              resolved = true;
              resolve(false);
            }
            return;
          }

          // KeepAlive heartbeat while paused so WebSocket remains connected
          this.keepAliveInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isPaused) {
              this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
            }
          }, 5000);

          this.callbacks.onStateChange('recording');
          if (!resolved) {
            resolved = true;
            resolve(true);
          }
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type !== 'Results') return;

            const alt = data.channel?.alternatives?.[0];
            const transcript: string = (alt?.transcript || '').trim();
            if (!transcript) return;

            if (data.is_final) {
              // Extract dominant speaker ID if diarization returned speaker metadata
              let formatted = transcript;
              const words = alt?.words;
              if (Array.isArray(words) && words.length > 0 && typeof words[0].speaker === 'number') {
                const speakerNum = words[0].speaker + 1;
                formatted = `[Pembicara ${speakerNum}]: ${transcript}`;
              }

              const startSec = typeof data.start === 'number' ? Number(data.start.toFixed(1)) : 0;
              const duration = typeof data.duration === 'number' ? data.duration : 1.5;
              const endSec = Number((startSec + Math.max(0.5, duration)).toFixed(1));

              this.callbacks.onInterimTranscript('');
              this.callbacks.onFinalTranscript(formatted, startSec, endSec);
            } else {
              this.callbacks.onInterimTranscript(transcript);
            }
          } catch {
            // ignore non-JSON frames
          }
        };

        ws.onerror = () => {
          clearTimeout(connectTimeout);
          if (!resolved) {
            resolved = true;
            this.callbacks.onError('Gagal terhubung ke Deepgram WebSocket. Periksa API Key atau koneksi internet.');
            resolve(false);
          }
        };

        ws.onclose = (ev) => {
          clearTimeout(connectTimeout);
          if (!resolved) {
            resolved = true;
            this.callbacks.onError(
              ev.code === 1008 || ev.code === 4001
                ? 'API Key Deepgram tidak valid.'
                : 'Koneksi Deepgram terputus.'
            );
            resolve(false);
          } else if (this.isActive) {
            this.isActive = false;
            this.callbacks.onInterimTranscript('');
            this.callbacks.onStateChange('idle');
          }
        };
      } catch (err: any) {
        this.callbacks.onError(`Deepgram error: ${err.message}`);
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      }
    });
  }

  public pause(): void {
    if (!this.isActive || this.isPaused) return;
    this.isPaused = true;
    if (this.streamRecorder && this.streamRecorder.state === 'recording') {
      try {
        this.streamRecorder.pause();
      } catch {}
    }
    this.callbacks.onInterimTranscript('');
    this.callbacks.onStateChange('paused');
  }

  public resume(): void {
    if (!this.isActive || !this.isPaused) return;
    this.isPaused = false;
    if (this.streamRecorder && this.streamRecorder.state === 'paused') {
      try {
        this.streamRecorder.resume();
      } catch {}
    }
    this.callbacks.onStateChange('recording');
  }

  public stop(): void {
    this.isActive = false;
    this.isPaused = false;

    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    if (this.streamRecorder && this.streamRecorder.state !== 'inactive') {
      try {
        this.streamRecorder.stop();
      } catch {}
    }
    this.streamRecorder = null;

    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'CloseStream' }));
        }
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    this.callbacks.onInterimTranscript('');
    this.callbacks.onStateChange('idle');
  }
}
