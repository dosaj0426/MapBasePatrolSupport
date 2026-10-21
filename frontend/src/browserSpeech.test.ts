import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserSpeech} from './browserSpeech';

test('basic speech uses Korean device voice, strips demo tag and respects cancellation', async()=>{
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  const oldUtterance=Object.getOwnPropertyDescriptor(globalThis,'SpeechSynthesisUtterance');
  class Utterance { constructor(public text: string) {} }
  const spoken: SpeechSynthesisUtterance[]=[];
  let cancelled=0;
  const korean={lang:'ko-KR',localService:true};
  const synth={resume(){},speak(value: SpeechSynthesisUtterance){spoken.push(value);},cancel(){cancelled++;},getVoices(){return [{lang:'en-US'},korean];}};
  Object.defineProperty(globalThis,'SpeechSynthesisUtterance',{value:Utterance,configurable:true});
  Object.defineProperty(globalThis,'window',{value:{speechSynthesis:synth,SpeechSynthesisUtterance:Utterance},configurable:true});
  const errors: Error[]=[];
  const player=new BrowserSpeech(error=>errors.push(error));
  try {
    player.speak('disabled');assert.equal(spoken.length,0);
    await player.enable();
    player.speak('[데모] 좌측에 정보공학관이 있습니다.');
    const speech=spoken.at(-1)!;
    assert.equal(speech.text,'좌측에 정보공학관이 있습니다.');
    assert.equal(speech.lang,'ko-KR');assert.equal(speech.voice,korean);
    assert.equal(speech.rate,1);assert.equal(speech.pitch,1);
    speech.onerror?.({error:'not-allowed'} as SpeechSynthesisErrorEvent);
    assert.equal(errors.length,1);
    player.cancel();const count=spoken.length;player.speak('off');
    assert.equal(spoken.length,count);assert.equal(cancelled,1);
    player.dispose();assert.equal(cancelled,2);
  } finally {
    for(const [key,descriptor] of [['window',oldWindow],['SpeechSynthesisUtterance',oldUtterance]] as const) {
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);
    }
  }
});
