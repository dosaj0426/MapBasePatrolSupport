import { api, jsonBody } from './api';

export class ServerSpeech {
  onError: (error: Error) => void;
  enabled: boolean;
  generation: number;
  queue: Promise<void>;
  context?: AudioContext;
  controller?: AbortController;
  source?: AudioBufferSourceNode;
  constructor(onError: (error: Error) => void) { this.onError = onError; this.enabled = false; this.generation = 0; this.queue = Promise.resolve(); }
  enable() {
    this.context ||= new (window.AudioContext || window.webkitAudioContext!)();
    this.enabled = true;
    return this.context.resume();
  }
  cancel() {
    this.enabled = false; this.generation++;
    this.controller?.abort();
    try { this.source?.stop(); } catch { /* 이미 종료됨 */ }
    this.queue = Promise.resolve();
  }
  speak(text: string) {
    if (!this.enabled) return;
    const generation = this.generation;
    this.queue = this.queue.then(async () => {
      if (!this.enabled || generation !== this.generation) return;
      const controller = new AbortController(); this.controller = controller;
      const result = await api<{url: string}>('/tts/synthesize', { method: 'POST', body: jsonBody({ text }), signal: controller.signal });
      const response = await fetch(result.url, { signal: controller.signal });
      if (!response.ok) throw new Error('음성 파일을 불러올 수 없습니다.');
      const buffer = await this.context!.decodeAudioData(await response.arrayBuffer());
      if (!this.enabled || generation !== this.generation) return;
      await new Promise<void>(resolve => {
        const source = this.context!.createBufferSource(); this.source = source;
        source.buffer = buffer; source.connect(this.context!.destination);
        source.onended = () => { source.disconnect(); resolve(); }; source.start();
      });
    }).catch(e => { if (this.enabled && generation === this.generation && e.name !== 'AbortError') this.onError(e); });
  }
  dispose() { this.cancel(); this.context?.close(); }
}
