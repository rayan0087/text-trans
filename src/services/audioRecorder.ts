export interface AudioRecorderOptions {
  onChunkReady?: (audioBlob: Blob) => void;
  onVolumeChange?: (volume: number, isSpeaking: boolean) => void;
  silenceThresholdMs?: number;
  maxChunkDurationMs?: number;
  enableVAD?: boolean;
}

export class AudioRecorderService {
  private mediaRecorder: MediaRecorder | null = null;
  private currentChunks: Blob[] = [];
  private allRecordedChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private mimeType: string = '';
  
  // Audio Analysis for Silence Detection (VAD)
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadInterval: any = null;
  private lastSpokeTime: number = 0;
  private chunkStartTime: number = 0;
  private hasSpokenInCurrentChunk: boolean = false;
  private options: AudioRecorderOptions;

  constructor(options: AudioRecorderOptions = {}) {
    this.options = {
      silenceThresholdMs: 1200, // 1.2s silence after speaking
      maxChunkDurationMs: 15000, // up to 15s before finding a pause
      enableVAD: true,           // enabled by default for pure Whisper live recording
      ...options,
    };
  }

  public static isSupported(): boolean {
    return typeof window !== 'undefined' && 'mediaDevices' in navigator && typeof window.MediaRecorder !== 'undefined';
  }

  private getSupportedMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/aac',
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return '';
  }

  public async start(): Promise<void> {
    this.currentChunks = [];
    this.allRecordedChunks = [];
    this.hasSpokenInCurrentChunk = false;
    this.lastSpokeTime = Date.now();
    this.chunkStartTime = Date.now();

    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    }

    this.mimeType = this.getSupportedMimeType();
    const options = this.mimeType ? { mimeType: this.mimeType } : undefined;
    this.mediaRecorder = new MediaRecorder(this.stream, options);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.currentChunks.push(event.data);
        this.allRecordedChunks.push(event.data);
      }
    };

    // Request data every 400ms for responsive slicing
    this.mediaRecorder.start(400);

    // Setup Audio Analysis for Voice Activity Detection
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
        const source = this.audioContext.createMediaStreamSource(this.stream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 512;
        source.connect(this.analyser);

        if (this.options.enableVAD) {
          const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

          this.vadInterval = setInterval(() => {
            if (!this.analyser || !this.mediaRecorder || this.mediaRecorder.state !== 'recording') return;

            this.analyser.getByteFrequencyData(dataArray);
            
            // Focus analysis on the human voice frequency band (~120Hz to ~3400Hz, bins 2 to 38)
            const minBin = 2;
            const maxBin = Math.min(38, dataArray.length);
            let voiceSum = 0;
            for (let i = minBin; i < maxBin; i++) {
              voiceSum += dataArray[i];
            }
            const avgVoiceVolume = voiceSum / (maxBin - minBin);

            const isSpeakingNow = avgVoiceVolume > 14;
            if (this.options.onVolumeChange) {
              this.options.onVolumeChange(avgVoiceVolume, isSpeakingNow);
            }

            const now = Date.now();
            const chunkDuration = now - this.chunkStartTime;

            if (isSpeakingNow) {
              this.hasSpokenInCurrentChunk = true;
              this.lastSpokeTime = now;
            }

            const silenceDuration = now - this.lastSpokeTime;

            // Condition 1: Natural sentence pause (user spoke for at least 1.5s, then fell silent for >= 1200ms)
            const isNaturalPause = 
              this.hasSpokenInCurrentChunk && 
              chunkDuration >= 1500 && 
              silenceDuration >= (this.options.silenceThresholdMs || 1200);

            // Condition 2: Max duration cap reached (default 15s) while speaking, catch brief 400ms pause
            const isMaxDuration = 
              this.hasSpokenInCurrentChunk && 
              chunkDuration >= (this.options.maxChunkDurationMs || 15000) &&
              silenceDuration >= 400;

            // Condition 3: Hard limit (25s) to prevent oversized payloads
            const isHardLimit = this.hasSpokenInCurrentChunk && chunkDuration >= 25000;

            if ((isNaturalPause || isMaxDuration || isHardLimit) && this.options.onChunkReady) {
              this.sliceAndEmitCurrentChunk();
            }
          }, 120);
        }
      }
    } catch (err) {
      console.warn('AudioContext setup error (silence detection disabled):', err);
    }
  }

  /**
   * Finalizes the current utterance into a 100% valid standalone WebM file (with EBML header)
   * and immediately restarts recording for the next phrase on the active microphone stream.
   */
  public async cutUtterance(): Promise<Blob | null> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      return null;
    }

    return new Promise((resolve) => {
      const recorder = this.mediaRecorder;
      if (!recorder || recorder.state === 'inactive') {
        resolve(null);
        return;
      }

      recorder.onstop = () => {
        const utteranceBlob = new Blob(this.currentChunks, {
          type: this.mimeType || 'audio/webm',
        });
        this.currentChunks = [];
        this.hasSpokenInCurrentChunk = false;
        this.chunkStartTime = Date.now();
        this.lastSpokeTime = Date.now();

        // Immediately restart MediaRecorder so subsequent speech is not lost
        try {
          if (this.stream && this.stream.active) {
            const options = this.mimeType ? { mimeType: this.mimeType } : undefined;
            this.mediaRecorder = new MediaRecorder(this.stream, options);
            this.mediaRecorder.ondataavailable = (event) => {
              if (event.data && event.data.size > 0) {
                this.currentChunks.push(event.data);
                this.allRecordedChunks.push(event.data);
              }
            };
            this.mediaRecorder.start(400);
          }
        } catch (err) {
          console.warn('Error restarting MediaRecorder for next utterance:', err);
        }

        resolve(utteranceBlob.size > 1500 ? utteranceBlob : null);
      };

      try {
        recorder.stop();
      } catch (err) {
        console.warn('Error stopping MediaRecorder in cutUtterance:', err);
        resolve(null);
      }
    });
  }

  private async sliceAndEmitCurrentChunk(): Promise<void> {
    const blob = await this.cutUtterance();
    if (blob && this.options.onChunkReady) {
      this.options.onChunkReady(blob);
    }
  }

  public pause(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
    }
  }

  public resume(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
      this.lastSpokeTime = Date.now();
      this.chunkStartTime = Date.now();
    }
  }

  public async stop(): Promise<Blob> {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve(new Blob([], { type: 'audio/webm' }));
        return;
      }

      this.mediaRecorder.onstop = () => {
        // Emit any last remaining slice if present
        if (this.currentChunks.length > 0 && this.hasSpokenInCurrentChunk && this.options.onChunkReady) {
          const lastSlice = new Blob(this.currentChunks, {
            type: this.mimeType || 'audio/webm',
          });
          if (lastSlice.size > 2000) {
            this.options.onChunkReady(lastSlice);
          }
        }

        const totalBlob = new Blob(this.allRecordedChunks, {
          type: this.mimeType || 'audio/webm',
        });
        this.currentChunks = [];
        this.allRecordedChunks = [];
        resolve(totalBlob);
      };

      if (this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }

      // Stop tracks to release mic hardware
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }
    });
  }

  public getFullAudioBlob(): Blob {
    return new Blob(this.allRecordedChunks, {
      type: this.mimeType || 'audio/webm',
    });
  }
}
