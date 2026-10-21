/** Use the phone/OS voice without a server synthesis request. */
export class BrowserSpeech {
  private enabled = false;
  private utterances = new Set<SpeechSynthesisUtterance>();
  constructor(private onError: (error: Error) => void) {}
  enable() {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return Promise.reject(new Error('이 브라우저는 기본 음성 안내를 지원하지 않습니다.'));
    this.enabled = true;
    window.speechSynthesis.resume();
    // Invoke speak within the touch handler to unlock mobile speech playback.
    const unlock = new SpeechSynthesisUtterance('음성 안내를 시작합니다.');
    unlock.lang = 'ko-KR';
    unlock.onerror = event => {
      if(this.enabled && !['canceled','interrupted'].includes(event.error)) this.onError(new Error('화면을 터치해 음성 안내를 다시 시작해 주세요.'));
    };
    window.speechSynthesis.speak(unlock);
    return Promise.resolve();
  }
  speak(text: string) {
    if (!this.enabled) return;
    const content = text.replace(/^\[데모\]\s*/, '').trim();
    if (!content) return;
    const speech = new SpeechSynthesisUtterance(content);
    speech.lang = 'ko-KR'; speech.rate = 1; speech.pitch = 1; speech.volume = 1;
    const korean = window.speechSynthesis.getVoices().filter(voice => /^ko(?:-|_)/i.test(voice.lang) || voice.lang === 'ko');
    const voice = korean.find(voice => voice.localService) ?? korean[0];
    if (voice) speech.voice = voice;
    this.utterances.add(speech);
    speech.onend = () => { this.utterances.delete(speech); };
    speech.onerror = event => {
      this.utterances.delete(speech);
      if (this.enabled && !['canceled','interrupted'].includes(event.error)) this.onError(new Error('기기의 한국어 음성 안내를 재생하지 못했습니다.'));
    };
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(speech);
  }
  cancel() { this.enabled = false; window.speechSynthesis?.cancel(); this.utterances.clear(); }
  dispose() { this.cancel(); }
}
