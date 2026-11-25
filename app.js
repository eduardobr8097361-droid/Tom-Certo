(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const ui = {
    trialBadge: $('#trialBadge'), trialNotice: $('#trialNotice'), trialRemaining: $('#trialRemaining'),
    installButton: $('#installButton'), installHelp: $('#installHelp'), paywall: $('#paywall'),
    unlockButton: $('#unlockButton'), unlockStatus: $('#unlockStatus'),
    modeOptions: [...document.querySelectorAll('.mode-option')], durationOptions: [...document.querySelectorAll('.duration-option')],
    modeDescription: $('#modeDescription'), countdown: $('#countdown'), hint: $('#visualizerHint'),
    visualizer: $('#visualizer'), progress: $('#progressFill'), progressTrack: $('#progressTrack'),
    mic: $('#micIndicator'), micStatus: $('#micStatus'), message: $('#inlineMessage'), start: $('#startButton'), again: $('#againButton'),
    result: $('#resultCard'), resultEyebrow: $('#resultEyebrow'), resultHeading: $('#resultHeading'),
    keyName: $('#keyName'), keyMode: $('#keyMode'), relative: $('#relativeKey'), confidence: $('#confidence'),
    metricOneLabel: $('#metricOneLabel'), metricTwoLabel: $('#metricTwoLabel'), notesTitle: $('#notesTitle'),
    notesSubtitle: $('#notesSubtitle'), topNotes: $('#topNotes'), disclaimer: $('#resultDisclaimer'), thirdNotice: $('#thirdNotice'),
  };
  const STATE_KEY = 'tom-certo-v1';
  const TRIAL_MS = 15 * 60 * 1000;
  const TRIAL_KEYS = ['tom-certo-trial-start-v2','tom-certo.first-access.v2','tomcerto_trial_started_at'];
  const UNLOCK_KEYS = ['tom-certo-unlocked-v2','tom-certo.access.v2'];
  const SAMPLE_INTERVAL_MS = 45;
  const NOTES = ['Dó','Dó♯','Ré','Mi♭','Mi','Fá','Fá♯','Sol','Lá♭','Lá','Si♭','Si'];
  const SHORT_NOTES = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
  const PITCH_CLASS = {C:0,'B#':0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,Fb:4,'E#':5,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,Cb:11};
  const MAJOR_PROFILE = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
  const MINOR_PROFILE = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
  // Referência explícita: as grafias E# e B# convertem-se cromaticamente em F e C.
  const MAJOR_SCALE_REFERENCE = [
    {name:'Dó Maior',short:'C',root:'C',notes:['C','D','E','F','G','A','B']},
    {name:'Sol Maior',short:'G',root:'G',notes:['G','A','B','C','D','E','F#']},
    {name:'Ré Maior',short:'D',root:'D',notes:['D','E','F#','G','A','B','C#']},
    {name:'Lá Maior',short:'A',root:'A',notes:['A','B','C#','D','E','F#','G#']},
    {name:'Mi Maior',short:'E',root:'E',notes:['E','F#','G#','A','B','C#','D#']},
    {name:'Si Maior',short:'B',root:'B',notes:['B','C#','D#','E','F#','G#','A#']},
    {name:'Fá♯ Maior',short:'F#',root:'F#',notes:['F#','G#','A#','B','C#','D#','E#']},
    {name:'Dó♯ Maior',short:'C#',root:'C#',notes:['C#','D#','E#','F#','G#','A#','B#']},
    {name:'Fá Maior',short:'F',root:'F',notes:['F','G','A','Bb','C','D','E']},
    {name:'Si♭ Maior',short:'B♭',root:'Bb',notes:['Bb','C','D','Eb','F','G','A']},
    {name:'Mi♭ Maior',short:'E♭',root:'Eb',notes:['Eb','F','G','Ab','Bb','C','D']},
    {name:'Lá♭ Maior',short:'A♭',root:'Ab',notes:['Ab','Bb','C','Db','Eb','F','G']},
  ];
  const TONIC_NAMES = ['Dó','Dó♯','Ré','Mi♭','Mi','Fá','Fá♯','Sol','Lá♭','Lá','Si♭','Si'];
  const MINOR_INTERVALS = [0,2,3,5,7,8,10];
  let mode='music',duration=25,stream=null,audioContext=null,analyser=null,source=null;
  let raf=0,trialTicker=0,active=false,deferredInstall=null,trialStart=0;
  let chroma=new Float64Array(12),pitchCounts=new Float64Array(12),frameCount=0,voiceFrames=[],lastSampleAt=0;
  const bars=[];
  for(let i=0;i<48;i++){const bar=document.createElement('span');ui.visualizer.appendChild(bar);bars.push(bar);}

  const rotate=(profile,offset)=>profile.map((_,i)=>profile[(i-offset+12)%12]);
  const readState=()=>{try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}');}catch{return{};}};
  function writeState(data){try{localStorage.setItem(STATE_KEY,JSON.stringify({...readState(),...data}));}catch{}}
  function unlockIsSaved(state=readState()){
    if(state.isUnlocked)return true;
    return UNLOCK_KEYS.some(key=>{try{return localStorage.getItem(key)==='1';}catch{return false;}});
  }
  function setUnlocked(){writeState({isUnlocked:true,unlockedAt:Date.now()});for(const key of UNLOCK_KEYS){try{localStorage.setItem(key,'1');}catch{}}}
  function saveTrialStart(timestamp){
    trialStart=timestamp;
    writeState({trialStartTimestamp:timestamp});
    for(const key of TRIAL_KEYS){try{localStorage.setItem(key,String(timestamp));}catch{}}
  }
  function clearTomCertoStorage(){
    for(const key of [STATE_KEY,...TRIAL_KEYS,...UNLOCK_KEYS,'tom-certo-trial-start','tom-certo-v1-trial']){try{localStorage.removeItem(key);}catch{}}
  }
  function initTrial(){
    if(new URLSearchParams(location.search).get('reset')==='1'){
      clearTomCertoStorage();history.replaceState({},'',location.pathname+location.hash);
    }
    const state=readState();
    const stored=[state.trialStartTimestamp,...TRIAL_KEYS.map(key=>{try{return Number(localStorage.getItem(key));}catch{return NaN;}})]
      .map(Number).filter(value=>Number.isFinite(value)&&value>0);
    // Usa a data mais antiga espelhada: remover apenas uma chave não reinicia o contador.
    trialStart=stored.length?Math.min(...stored):Date.now();
    if(!stored.length||stored.some(value=>value!==trialStart))saveTrialStart(trialStart);
    refreshTrialUI();
    trialTicker=window.setInterval(refreshTrialUI,1000);
  }
  function remainingTrialMs(){return Math.max(0,TRIAL_MS-(Date.now()-trialStart));}
  function formatClock(milliseconds){const seconds=Math.ceil(milliseconds/1000),minutes=Math.floor(seconds/60),remainder=seconds%60;return `${String(minutes).padStart(2,'0')}:${String(remainder).padStart(2,'0')}`;}
  function refreshTrialUI(){
    const unlocked=unlockIsSaved(),remaining=remainingTrialMs();
    ui.trialBadge.hidden=unlocked;
    ui.trialBadge.textContent=remaining>0?`Teste: ${formatClock(remaining)}`:'Teste encerrado';
    ui.trialRemaining.textContent=unlocked?'Acesso liberado':`${formatClock(remaining)} restantes`;
    if(unlocked){ui.trialNotice.classList.add('trial-complete');ui.trialNotice.querySelector('strong').textContent='Acesso liberado neste navegador';}
    if(!unlocked&&remaining<=0&&!active)ui.paywall.hidden=false;
  }
  function permitted(){return unlockIsSaved()||Date.now()-trialStart<TRIAL_MS;}

  function updateDuration(seconds){
    duration=seconds;
    ui.durationOptions.forEach(btn=>{const selected=Number(btn.dataset.seconds)===duration;btn.classList.toggle('active',selected);btn.setAttribute('aria-pressed',String(selected));});
    if(!active)ui.countdown.innerHTML=`${duration}<span>s</span>`;
  }
  function updateMode(nextMode){
    if(active||!['music','voice'].includes(nextMode))return;
    mode=nextMode;ui.result.hidden=true;ui.thirdNotice.hidden=true;setMessage('');resetVisual();
    ui.modeOptions.forEach(btn=>{const selected=btn.dataset.mode===mode;btn.classList.toggle('active',selected);btn.setAttribute('aria-pressed',String(selected));});
    if(mode==='voice'){
      ui.modeDescription.textContent='Cante uma frase: identificamos a tonalidade pela escala e pelos pontos de repouso.';
      ui.start.innerHTML='<span aria-hidden="true">●</span> Analisar minha voz';ui.hint.textContent='Pronto para ouvir sua voz';
    }else{
      ui.modeDescription.textContent='Analise a harmonia de uma música tocando perto do microfone.';
      ui.start.innerHTML='<span aria-hidden="true">●</span> Analisar música';ui.hint.textContent='Pronto para ouvir';
    }
    ui.countdown.innerHTML=`${duration}<span>s</span>`;
  }
  ui.modeOptions.forEach(btn=>btn.addEventListener('click',()=>updateMode(btn.dataset.mode)));
  ui.durationOptions.forEach(btn=>btn.addEventListener('click',()=>{if(!active)updateDuration(Number(btn.dataset.seconds));}));
  function setMessage(text=''){ui.message.textContent=text;}
  function setLive(on){ui.mic.classList.toggle('live',on);ui.micStatus.textContent=on?'Ouvindo':'Pronto';}
  function resetVisual(){bars.forEach(bar=>bar.style.height='4px');ui.progress.style.width='0%';ui.progressTrack.setAttribute('aria-valuenow','0');}

  async function begin(){
    if(active)return;
    if(!permitted()){ui.paywall.hidden=false;return;}
    if(!navigator.mediaDevices?.getUserMedia||!(window.AudioContext||window.webkitAudioContext)){
      setMessage('Este navegador não oferece captura de áudio. Tente uma versão atualizada do Chrome ou Safari.');return;
    }
    setMessage('');ui.start.disabled=true;ui.start.textContent='Solicitando acesso ao microfone…';
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      audioContext=new(window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')await audioContext.resume();
      analyser=audioContext.createAnalyser();analyser.fftSize=4096;analyser.smoothingTimeConstant=.4;
      source=audioContext.createMediaStreamSource(stream);source.connect(analyser);
      chroma=new Float64Array(12);pitchCounts=new Float64Array(12);frameCount=0;voiceFrames=[];active=true;
      ui.result.hidden=true;ui.start.disabled=false;ui.start.innerHTML='<span aria-hidden="true">■</span> Parar análise';
      ui.hint.textContent=mode==='voice'?'Cante notas longas e deixe uma pausa ao fim da frase…':'Escutando a música…';setLive(true);resetVisual();
      const started=performance.now(),total=duration*1000;lastSampleAt=started-SAMPLE_INTERVAL_MS;
      const loop=now=>{
        if(!active)return;
        const elapsed=now-started,remaining=Math.max(0,total-elapsed),pct=Math.min(100,elapsed/total*100);
        ui.countdown.innerHTML=`${Math.ceil(remaining/1000)}<span>s</span>`;ui.progress.style.width=`${pct}%`;ui.progressTrack.setAttribute('aria-valuenow',String(Math.round(pct)));
        if(now-lastSampleAt>=SAMPLE_INTERVAL_MS){lastSampleAt=now;collectFrame(elapsed/1000);}
        if(remaining<=0){finish();return;}raf=requestAnimationFrame(loop);
      };
      raf=requestAnimationFrame(loop);
    }catch(err){
      await stopAudio();ui.start.disabled=false;updateMode(mode);
      if(err?.name==='NotAllowedError'||err?.name==='PermissionDeniedError')setMessage('Permissão do microfone negada. Autorize o acesso nas configurações do navegador e tente novamente.');
      else if(err?.name==='NotFoundError')setMessage('Nenhum microfone foi encontrado neste aparelho.');
      else if(err?.name==='NotReadableError')setMessage('O microfone está sendo usado por outro aplicativo. Feche-o e tente novamente.');
      else setMessage('Não foi possível iniciar o microfone. Confira a conexão HTTPS e as permissões do navegador.');
      ui.hint.textContent='Pronto para ouvir';setLive(false);
    }
  }
  function collectFrame(timeSeconds){
    if(!analyser)return;
    const n=analyser.fftSize,data=new Float32Array(n);analyser.getFloatTimeDomainData(data);
    const spectrum=new Float32Array(analyser.frequencyBinCount);analyser.getFloatFrequencyData(spectrum);
    let rms=0;for(let i=0;i<n;i++)rms+=data[i]*data[i];rms=Math.sqrt(rms/n);drawBars(spectrum);
    if(rms<(mode==='voice'?.006:.008)){if(mode==='voice')voiceFrames.push({time:timeSeconds,silence:true});return;}
    const pitch=detectPitch(data,audioContext.sampleRate);
    const pitchValid=pitch&&pitch.frequency>=65&&pitch.frequency<=1100&&pitch.confidence>(mode==='voice'?.62:.58);
    if(mode==='voice'){
      if(pitchValid){const midi=69+12*Math.log2(pitch.frequency/440),note=Math.round(midi);voiceFrames.push({time:timeSeconds,midi,note:((note%12)+12)%12,confidence:pitch.confidence,rms,silence:false});frameCount++;}
      else voiceFrames.push({time:timeSeconds,silence:true});
      return;
    }
    if(pitchValid){const midi=69+12*Math.log2(pitch.frequency/440),rounded=Math.round(midi),cls=((rounded%12)+12)%12;pitchCounts[cls]+=Math.max(.25,Math.min(1,pitch.confidence));}
    const binHz=audioContext.sampleRate/analyser.fftSize;
    for(let bin=2;bin<spectrum.length;bin++){
      const db=spectrum[bin];if(!Number.isFinite(db)||db < -92)continue;
      const frequency=bin*binHz;if(frequency<55||frequency>2200)continue;
      const midi=69+12*Math.log2(frequency/440);if(!Number.isFinite(midi))continue;
      const nearest=Math.round(midi),cents=Math.abs(midi-nearest);if(cents>.48)continue;
      const amplitude=Math.pow(10,db/20),weight=amplitude*amplitude/(1+Math.log2(frequency/55)*.45);
      chroma[((nearest%12)+12)%12]+=weight*(1-cents*.8);
    }
    frameCount++;
  }
  function drawBars(spectrum){
    const step=Math.max(1,Math.floor((spectrum.length-2)/bars.length));
    bars.forEach((bar,index)=>{const db=spectrum[Math.min(spectrum.length-1,2+index*step)],norm=Number.isFinite(db)?Math.max(0,Math.min(1,(db+90)/65)):0;bar.style.height=`${4+norm*58}px`;bar.style.opacity=String(.3+norm*.7);});
  }
  function detectPitch(input,sampleRate){
    const factor=2,size=Math.floor(input.length/factor),reduced=new Float32Array(size);let mean=0;
    for(let i=0;i<size;i++){reduced[i]=(input[i*factor]+input[i*factor+1])*.5;mean+=reduced[i];}mean/=size;
    let energy=0;for(let i=0;i<size;i++){const sample=reduced[i]-mean;energy+=sample*sample;}if(energy/size<.000035)return null;
    const reducedRate=sampleRate/factor,minLag=Math.max(2,Math.floor(reducedRate/1000)),maxLag=Math.min(Math.floor(reducedRate/65),Math.floor(size*.45));
    let bestLag=-1,best=-1;const correlations=new Float32Array(maxLag+1);
    for(let lag=minLag;lag<=maxLag;lag++){
      let cross=0,left=0,right=0;
      for(let i=0;i<size-lag;i++){const a=reduced[i]-mean,b=reduced[i+lag]-mean;cross+=a*b;left+=a*a;right+=b*b;}
      const correlation=cross/Math.sqrt((left+1e-15)*(right+1e-15));correlations[lag]=correlation;if(correlation>best){best=correlation;bestLag=lag;}
    }
    if(bestLag<0||best<(mode==='voice'?.62:.55))return null;
    for(let lag=minLag+1;lag<bestLag;lag++){const value=correlations[lag];if(value>.72&&value>=correlations[lag-1]&&value>=correlations[lag+1]){bestLag=lag;best=value;break;}}
    const left=correlations[bestLag-1]||best,center=correlations[bestLag],right=correlations[bestLag+1]||best;
    const denominator=left-2*center+right,shift=Math.abs(denominator)>1e-8?.5*(left-right)/denominator:0;
    return{frequency:reducedRate/(bestLag+Math.max(-.5,Math.min(.5,shift))),confidence:best};
  }
  function finish(){
    if(!active)return;active=false;cancelAnimationFrame(raf);ui.progress.style.width='100%';ui.progressTrack.setAttribute('aria-valuenow','100');
    const result=mode==='voice'?analyzeVoice():analyzeMusic();void stopAudio();setLive(false);ui.hint.textContent='Análise concluída';ui.countdown.innerHTML='✓';
    ui.start.disabled=false;updateModeLabelOnly();
    if(result){setMessage('');showResult(result);}else setMessage(mode==='voice'?'Não consegui separar notas cantadas estáveis. Cante uma frase com notas longas, perto do microfone e com pouco ruído.':'Não detectei notas suficientes. Tente um trecho mais melódico, com menos ruído, e analise novamente.');
    refreshTrialUI();
  }
  async function stopAudio(){if(stream){stream.getTracks().forEach(track=>track.stop());stream=null;}if(source){try{source.disconnect();}catch{}source=null;}if(audioContext){try{await audioContext.close();}catch{}audioContext=null;}analyser=null;}
  function analyzeMusic(){
    const spectrumSum=chroma.reduce((a,b)=>a+b,0),pMax=Math.max(0,...pitchCounts),sMax=Math.max(0,...chroma);
    if(pMax>0)for(let i=0;i<12;i++)chroma[i]+=pitchCounts[i]*(spectrumSum>0?Math.max(sMax*.20,spectrumSum*.055):1);
    const sum=chroma.reduce((a,b)=>a+b,0);if(frameCount<6||sum<=1e-10)return null;
    const values=Array.from(chroma),mean=values.reduce((a,b)=>a+b,0)/12,centered=values.map(value=>value-mean),norm=Math.sqrt(centered.reduce((total,value)=>total+value*value,0));if(norm<1e-9)return null;
    const candidates=[];
    for(let root=0;root<12;root++)for(const keyMode of ['Maior','Menor']){
      const profile=rotate(keyMode==='Maior'?MAJOR_PROFILE:MINOR_PROFILE,root),profileMean=profile.reduce((a,b)=>a+b,0)/12,centeredProfile=profile.map(value=>value-profileMean);
      let dot=0,den=0;for(let i=0;i<12;i++){dot+=centered[i]*centeredProfile[i];den+=centeredProfile[i]*centeredProfile[i];}
      const score=dot/(norm*Math.sqrt(den)),relativeRoot=keyMode==='Maior'?(root+9)%12:(root+3)%12;
      candidates.push({root,mode:keyMode,score,relative:`${NOTES[relativeRoot]} / ${SHORT_NOTES[relativeRoot]} ${keyMode==='Maior'?'Menor':'Maior'}`});
    }
    candidates.sort((a,b)=>b.score-a.score);const top=candidates[0],second=candidates[1],gap=Math.max(0,top.score-second.score);
    const base=Math.max(0,Math.min(1,(top.score+.05)/.58)),separation=Math.max(0,Math.min(1,gap/.17)),evidence=Math.max(.35,Math.min(1,Math.log1p(frameCount)/Math.log(110)));
    const confidence=Math.round(100*(.58*base+.27*separation+.15*evidence));
    const notes=values.map((value,index)=>({value,index})).sort((a,b)=>b.value-a.value).slice(0,3).map(item=>item.index);
    return{type:'music',key:`${NOTES[top.root]} / ${SHORT_NOTES[top.root]} ${top.mode}`,relative:top.relative,confidence,notes};
  }
  function buildVoiceSegments(analysisLength){
    const valid=voiceFrames.filter(frame=>!frame.silence),segments=[];let current=null;
    for(const frame of valid){
      if(current&&frame.note===current.note&&frame.time-current.lastTime<=.18){current.frames.push(frame);current.lastTime=frame.time;current.confidenceSum+=frame.confidence;continue;}
      if(current){current.end=current.lastTime+SAMPLE_INTERVAL_MS/1000;segments.push(current);}
      current={note:frame.note,start:frame.time,lastTime:frame.time,frames:[frame],confidenceSum:frame.confidence,end:frame.time+SAMPLE_INTERVAL_MS/1000};
    }
    if(current){current.end=current.lastTime+SAMPLE_INTERVAL_MS/1000;segments.push(current);}
    return segments.map((segment,index)=>{
      const seconds=Math.max(SAMPLE_INTERVAL_MS/1000,segment.end-segment.start),midiValues=segment.frames.map(frame=>frame.midi).sort((a,b)=>a-b);
      const median=midiValues[Math.floor(midiValues.length/2)],deviations=midiValues.map(value=>Math.abs(value-median)).sort((a,b)=>a-b),mad=deviations[Math.floor(deviations.length/2)]||0;
      const stability=Math.max(0,Math.min(1,1-mad*100/65)),confidence=segment.confidenceSum/segment.frames.length,next=segments[index+1];
      const pauseAfter=next?Math.max(0,next.start-segment.end):Math.max(0,analysisLength-segment.end);
      const pauseBoost=pauseAfter>=.22?1+Math.min(.85,(pauseAfter-.22)*.8):1;
      const passagePenalty=seconds<.20?.12:seconds<.32?.20:seconds<.50?.48:1;
      const weight=seconds*(.42+.68*stability)*(.68+.32*confidence)*pauseBoost*passagePenalty;
      return{...segment,seconds,stability,confidence,pauseAfter,weight};
    });
  }
  function correlation(values,profile){
    const mean=values.reduce((a,b)=>a+b,0)/12,centered=values.map(value=>value-mean),profileMean=profile.reduce((a,b)=>a+b,0)/12,centeredProfile=profile.map(value=>value-profileMean);
    let dot=0,a=0,b=0;for(let i=0;i<12;i++){dot+=centered[i]*centeredProfile[i];a+=centered[i]*centered[i];b+=centeredProfile[i]*centeredProfile[i];}
    return a&&b?dot/Math.sqrt(a*b):0;
  }
  function getVoiceCandidates(){
    const candidates=[];
    for(const item of MAJOR_SCALE_REFERENCE){
      const root=PITCH_CLASS[item.root],scale=item.notes.map(note=>PITCH_CLASS[note]);
      candidates.push({root,mode:'Maior',name:item.name,short:item.short,scale,profile:rotate(MAJOR_PROFILE,root)});
    }
    for(let root=0;root<12;root++){
      const scale=MINOR_INTERVALS.map(interval=>(root+interval)%12);
      candidates.push({root,mode:'Menor',name:`${TONIC_NAMES[root]} Menor`,short:`${SHORT_NOTES[root]}m`,scale,profile:rotate(MINOR_PROFILE,root)});
    }
    return candidates;
  }
  function analyzeVoice(){
    const segments=buildVoiceSegments(duration);if(!segments.length)return null;
    const noteWeights=new Float64Array(12),sustainSeconds=new Float64Array(12),restWeights=new Float64Array(12);
    for(const segment of segments){
      noteWeights[segment.note]+=segment.weight;sustainSeconds[segment.note]+=segment.seconds;
      if(segment.pauseAfter>=.22)restWeights[segment.note]+=segment.weight*Math.min(1.8,1+(segment.pauseAfter-.22)*.65);
    }
    const total=noteWeights.reduce((a,b)=>a+b,0);if(total<.012)return null;
    const restScores=Array.from({length:12},(_,note)=>noteWeights[note]+restWeights[note]*.42);
    const restNote=restScores.indexOf(Math.max(...restScores)),restDenom=Math.max(...restScores,1e-9);
    const candidates=getVoiceCandidates().map(candidate=>{
      const scaleWeight=candidate.scale.reduce((sum,note)=>sum+noteWeights[note],0),scaleFit=scaleWeight/total;
      const outOfScale=1-scaleFit,tonic=noteWeights[candidate.root]/total,fifth=noteWeights[(candidate.root+7)%12]/total;
      const tonicRest=restScores[candidate.root]/restDenom;
      const ks=Math.max(-1,Math.min(1,correlation(noteWeights,candidate.profile)));
      const majorThird=noteWeights[(candidate.root+4)%12],minorThird=noteWeights[(candidate.root+3)%12];
      const thirdEvidence=Math.min(1,(majorThird+minorThird)/(total*.22+1e-9));
      const expected=candidate.mode==='Maior'?majorThird:minorThird,other=candidate.mode==='Maior'?minorThird:majorThird;
      const thirdContrast=(expected-other)/(expected+other+total*.025+1e-9);
      // Enfatiza coerência diatônica, tônica/quinta, repouso e perfil tonal; terça é bônus condicional.
      const score=.31*scaleFit-.16*outOfScale+.13*tonic+.09*fifth+.22*tonicRest+.13*((ks+1)/2)+.11*thirdEvidence*thirdContrast;
      return{...candidate,score,scaleFit,tonic,fifth,tonicRest,thirdEvidence,majorThird,minorThird};
    }).sort((a,b)=>b.score-a.score);
    const top=candidates[0],second=candidates[1],margin=Math.max(0,top.score-second.score);
    const allStability=segments.reduce((sum,segment)=>sum+segment.stability*segment.seconds,0)/Math.max(segments.reduce((sum,segment)=>sum+segment.seconds,0),1e-9);
    const dominant=noteWeights[restNote]/total,coverage=Math.min(1,frameCount/100),confidence=Math.round(Math.max(20,Math.min(96,27+dominant*27+allStability*17+coverage*12+Math.min(.15,margin)*75)));
    const majorThird=top.majorThird,minorThird=top.minorThird,thirdSum=majorThird+minorThird;
    const totalSustain=sustainSeconds.reduce((a,b)=>a+b,0);
    const observedThirdSeconds=sustainSeconds[(top.root+4)%12]+sustainSeconds[(top.root+3)%12];
    let thirdText='Terça pouco evidente na frase';
    if(thirdSum/total>=.025&&observedThirdSeconds/Math.max(totalSustain,1e-9)>=.055&&Math.max(majorThird,minorThird)>Math.min(majorThird,minorThird)*1.22){
      const isMajor=majorThird>minorThird,pc=(top.root+(isMajor?4:3))%12;
      thirdText=`Terça ${isMajor?'maior':'menor'} observada: ${NOTES[pc]} / ${SHORT_NOTES[pc]}`;
    }
    const notes=Array.from({length:12},(_,note)=>({note,weight:noteWeights[note],seconds:sustainSeconds[note]}))
      .filter(item=>item.weight>0&&item.seconds>=.08).sort((a,b)=>b.weight-a.weight).map(item=>item.note);
    return{type:'voice',key:top.name,root:top.root,mode:top.mode,restNote,restSeconds:sustainSeconds[restNote],thirdText,thirdMissing:thirdText.startsWith('Terça pouco'),notes,confidence,scaleFit:top.scaleFit};
  }
  function showResult(result){
    ui.thirdNotice.hidden=true;
    if(result.type==='voice'){
      ui.resultEyebrow.textContent='LEITURA DA MELODIA';ui.resultHeading.textContent='Tonalidade estimada';ui.keyName.textContent=result.key;
      ui.keyMode.textContent=`Nota de repouso principal: ${NOTES[result.restNote]} / ${SHORT_NOTES[result.restNote]}`;
      ui.metricOneLabel.textContent='SUSTENTAÇÃO DO REPOUSO';ui.relative.textContent=`${result.restSeconds.toFixed(1).replace('.',',')} s`;
      ui.metricTwoLabel.textContent='CONFIANÇA ESTIMADA';ui.confidence.textContent=`${result.confidence}%`;
      ui.thirdNotice.textContent=result.thirdMissing?`${result.thirdText}; a classificação considera também a escala, a tônica, a quinta e o repouso.`:result.thirdText;
      ui.thirdNotice.hidden=false;ui.notesTitle.textContent='Notas cantadas na análise';ui.notesSubtitle.textContent='classes cromáticas detectadas';
      ui.disclaimer.textContent='A tonalidade da voz é estimada pela coerência da escala, pela nota de repouso e pela sustentação. A terça pode não aparecer numa frase curta; “confiança” é um indicador heurístico, não uma probabilidade calibrada.';
      renderNotes(result.notes.map(note=>`${NOTES[note]} · ${SHORT_NOTES[note]}`));
    }else{
      ui.resultEyebrow.textContent='SUA ESTIMATIVA';ui.resultHeading.textContent='Tom identificado';ui.keyName.textContent=result.key;ui.keyMode.textContent='Tonalidade principal';
      ui.metricOneLabel.textContent='TOM RELATIVO';ui.relative.textContent=result.relative;ui.metricTwoLabel.textContent='CONFIANÇA ESTIMADA';ui.confidence.textContent=`${result.confidence}%`;
      ui.notesTitle.textContent='Notas mais presentes';ui.notesSubtitle.textContent='no trecho analisado';
      ui.disclaimer.textContent='Estimativa baseada no conteúdo harmônico captado. Em músicas com mudanças de tom, muitos instrumentos ou ruído, o resultado pode variar.';
      renderNotes(result.notes.map(note=>`${NOTES[note]} · ${SHORT_NOTES[note]}`));
    }
    ui.result.hidden=false;ui.result.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function renderNotes(notes){ui.topNotes.replaceChildren(...notes.map(label=>{const chip=document.createElement('span');chip.className='note-chip';chip.textContent=label;return chip;}));}
  function updateModeLabelOnly(){ui.start.innerHTML=mode==='voice'?'<span aria-hidden="true">●</span> Analisar minha voz':'<span aria-hidden="true">●</span> Analisar música';}
  ui.start.addEventListener('click',()=>{
    if(active){active=false;cancelAnimationFrame(raf);void stopAudio();setLive(false);ui.hint.textContent='Análise interrompida';ui.start.disabled=false;updateModeLabelOnly();refreshTrialUI();return;}
    void begin();
  });
  ui.again.addEventListener('click',()=>{ui.result.hidden=true;ui.thirdNotice.hidden=true;setMessage('');updateDuration(duration);resetVisual();ui.hint.textContent=mode==='voice'?'Pronto para ouvir sua voz':'Pronto para ouvir';window.scrollTo({top:0,behavior:'smooth'});});
  ui.installButton.addEventListener('click',async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;ui.installButton.hidden=true;}else ui.installHelp.hidden=false;});
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;ui.installButton.hidden=false;});
  window.addEventListener('appinstalled',()=>{ui.installButton.hidden=true;deferredInstall=null;});
  window.addEventListener('load',()=>{
    const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent||'')||(navigator.platform==='MacIntel'&&(navigator.maxTouchPoints||0)>1);
    const installed=(window.matchMedia?.('(display-mode: standalone)').matches)||navigator.standalone===true;
    if(ios&&!installed&&!deferredInstall)ui.installButton.hidden=false;
  });
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>{const modal=document.getElementById(button.dataset.close);if(modal)modal.hidden=true;}));
  ui.unlockButton.addEventListener('click',()=>{
    setUnlocked();
    if(!unlockIsSaved()){
      ui.unlockStatus.textContent='Não foi possível salvar a liberação neste navegador. Verifique as permissões de armazenamento e tente novamente.';
      return;
    }
    ui.paywall.hidden=true;
    ui.unlockStatus.textContent='Acesso local liberado neste aparelho. O Pix não foi verificado pelo app.';
    refreshTrialUI();
  });
  if('serviceWorker'in navigator&&location.protocol.startsWith('http'))window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  initTrial();updateMode(mode);
})();
