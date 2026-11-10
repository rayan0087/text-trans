export interface AudioRecorderOptions {
  onChunkReady?: (audioBlob: Blob) => void;
  silenceThresholdMs?: number;
  maxChunkDurationMs?: number;
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
      maxChunkDurationMs: 8000,  // max 8s per chunk
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

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

        this.vadInterval = setInterval(() => {
          if (!this.analyser || !this.mediaRecorder || this.mediaRecorder.state !== 'recording') return;

          this.analyser.getByteFrequencyData(dataArray);
          
          // Focus analysis on the human voice frequency band (~120Hz to ~3400Hz, bins 2 to 38)
          // to eliminate low-frequency rumbles (AC/mic bumps) and high-frequency noise
          const minBin = 2;
          const maxBin = Math.min(38, dataArray.length);
          let voiceSum = 0;
          for (let i = minBin; i < maxBin; i++) {
            voiceSum += dataArray[i];
          }
          const avgVoiceVolume = voiceSum / (maxBin - minBin);

          const now = Date.now();
          const chunkDuration = now - this.chunkStartTime;

          // Sound threshold: avgVoiceVolume > 12 indicates active human speech
          if (avgVoiceVolume > 12) {
            this.hasSpokenInCurrentChunk = true;
            this.lastSpokeTime = now;
          }

          const silenceDuration = now - this.lastSpokeTime;

          // Condition 1: Natural sentence pause
          // Trigger when user pauses for >= silenceThreshold (default 1100ms) AFTER having spoken for at least 2 seconds
          const isNaturalPause = 
            this.hasSpokenInCurrentChunk && 
            chunkDuration >= 2000 && 
            silenceDuration >= (this.options.silenceThresholdMs || 1100);

          // Condition 2: Max duration cap reached (default 8s) while speaking, to prevent lagging behind
          const isMaxDuration = 
            this.hasSpokenInCurrentChunk && 
            chunkDuration >= (this.options.maxChunkDurationMs || 8000) &&
            silenceDuration >= 400; // brief natural break within the speech

          // Condition 3: Hard limit (10s)
          const isHardLimit = this.hasSpokenInCurrentChunk && chunkDuration >= 10000;

          if ((isNaturalPause || isMaxDuration || isHardLimit) && this.options.onChunkReady) {
            this.sliceAndEmitCurrentChunk();
          }
        }, 150);
      }
    } catch (err) {
      console.warn('AudioContext setup error (silence detection disabled):', err);
    }
  }

  private sliceAndEmitCurrentChunk(): void {
    if (this.currentChunks.length === 0) return;

    const chunkBlob = new Blob(this.currentChunks, {
      type: this.mimeType || 'audio/webm',
    });
    this.currentChunks = [];
    this.hasSpokenInCurrentChunk = false;
    this.chunkStartTime = Date.now();
    this.lastSpokeTime = Date.now();

    // Ensure audio chunk contains enough data (> 3000 bytes) to be valid
    if (chunkBlob.size > 3000 && this.options.onChunkReady) {
      this.options.onChunkReady(chunkBlob);
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
