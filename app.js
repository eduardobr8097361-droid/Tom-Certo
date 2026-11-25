(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const ui = {
    trialBadge: $('#trialBadge'), installButton: $('#installButton'), installHelp: $('#installHelp'),
    paywall: $('#paywall'), unlockButton: $('#unlockButton'), unlockStatus: $('#unlockStatus'),
    modeOptions: [...document.querySelectorAll('.mode-option')],
    durationOptions: [...document.querySelectorAll('.duration-option')],
    modeDescription: $('#modeDescription'), countdown: $('#countdown'), hint: $('#visualizerHint'),
    visualizer: $('#visualizer'), progress: $('#progressFill'), progressTrack: $('#progressTrack'),
    mic: $('#micIndicator'), micStatus: $('#micStatus'), message: $('#inlineMessage'),
    start: $('#startButton'), again: $('#againButton'), result: $('#resultCard'),
    resultEyebrow: $('#resultEyebrow'), resultHeading: $('#resultHeading'), keyName: $('#keyName'),
    keyMode: $('#keyMode'), relative: $('#relativeKey'), confidence: $('#confidence'),
    metricOneLabel: $('#metricOneLabel'), metricTwoLabel: $('#metricTwoLabel'),
    notesTitle: $('#notesTitle'), notesSubtitle: $('#notesSubtitle'),
    topNotes: $('#topNotes'), disclaimer: $('#resultDisclaimer'),
  };
  const CACHE_KEY = 'tom-certo-v1';
  const TRIAL_MS = 24 * 60 * 60 * 1000;
  const SAMPLE_INTERVAL_MS = 45; // ~22 leituras/s: suficiente para a janela rápida e mais leve no celular.
  const NOTES = ['Dó','Dó♯','Ré','Ré♯','Mi','Fá','Fá♯','Sol','Sol♯','Lá','Lá♯','Si'];
  const SHORT_NOTES = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  const MAJOR = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
  const MINOR = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
  const keys = [...Array(12)].flatMap((_, root) => [
    {root, mode:'Maior', profile:rotate(MAJOR, root)},
    {root, mode:'Menor', profile:rotate(MINOR, root)},
  ]);
  let mode = 'music', duration = 25, stream = null, audioContext = null, analyser = null, source = null;
  let raf = 0, timer = 0, active = false, deferredInstall = null;
  let chroma = new Float64Array(12), pitchCounts = new Float64Array(12), frameCount = 0;
  let voiceFrames = [], lastSampleAt = 0;
  const bars = [];
  for (let i=0;i<48;i++) { const bar=document.createElement('span'); ui.visualizer.appendChild(bar); bars.push(bar); }

  function rotate(profile, offset) { return profile.map((_, i) => profile[(i - offset + 12) % 12]); }
  function readState() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; } }
  function saveState(data) { try { localStorage.setItem(CACHE_KEY, JSON.stringify({...readState(), ...data})); } catch {} }
  function setTrialAndAccess() {
    if (new URLSearchParams(location.search).get('reset') === '1') {
      try { localStorage.removeItem(CACHE_KEY); } catch {}
      history.replaceState({}, '', location.pathname + location.hash);
    }
    const state = readState();
    if (!Number.isFinite(state.firstAccessTimestamp)) {
      state.firstAccessTimestamp = Date.now(); saveState({firstAccessTimestamp:state.firstAccessTimestamp});
    }
    updateTrialBadge(state);
    if (!state.isUnlocked && Date.now() - state.firstAccessTimestamp >= TRIAL_MS) ui.paywall.hidden = false;
    window.setInterval(() => {
      const current=readState(); updateTrialBadge(current);
      if (!current.isUnlocked && Date.now()-current.firstAccessTimestamp>=TRIAL_MS && !active) ui.paywall.hidden=false;
    }, 60_000);
  }
  function updateTrialBadge(state) {
    if(state.isUnlocked){ui.trialBadge.hidden=true;return;}
    const remaining=Math.max(0,TRIAL_MS-(Date.now()-state.firstAccessTimestamp));
    if(!Number.isFinite(remaining))return;
    ui.trialBadge.hidden=false;
    ui.trialBadge.textContent=remaining>0?`Teste grátis: ${Math.ceil(remaining/3_600_000)}h restantes`:'Teste grátis encerrado';
  }
  function permitted() {
    const s=readState();
    return !!s.isUnlocked || (Number.isFinite(s.firstAccessTimestamp)&&Date.now()-s.firstAccessTimestamp<TRIAL_MS);
  }
  function updateDuration(seconds) {
    duration=seconds;
    ui.durationOptions.forEach(btn=>{
      const selected=Number(btn.dataset.seconds)===duration;
      btn.classList.toggle('active',selected); btn.setAttribute('aria-pressed',String(selected));
    });
    if(!active)ui.countdown.innerHTML=`${duration}<span>s</span>`;
  }
  function updateMode(nextMode) {
    if(active || !['music','voice'].includes(nextMode))return;
    mode=nextMode; ui.result.hidden=true; setMessage(''); resetVisual();
    ui.modeOptions.forEach(btn=>{
      const selected=btn.dataset.mode===mode;
      btn.classList.toggle('active',selected); btn.setAttribute('aria-pressed',String(selected));
    });
    if(mode==='voice'){
      ui.modeDescription.textContent='Cante uma frase: vamos destacar as notas longas e os pontos de repouso da melodia.';
      ui.start.innerHTML='<span aria-hidden="true">●</span> Analisar minha voz';
      ui.hint.textContent='Pronto para ouvir sua voz';
    } else {
      ui.modeDescription.textContent='Analise a harmonia de uma música tocando perto do microfone.';
      ui.start.innerHTML='<span aria-hidden="true">●</span> Analisar música';
      ui.hint.textContent='Pronto para ouvir';
    }
    ui.countdown.innerHTML=`${duration}<span>s</span>`;
  }
  ui.modeOptions.forEach(btn=>btn.addEventListener('click',()=>updateMode(btn.dataset.mode)));
  ui.durationOptions.forEach(btn=>btn.addEventListener('click',()=>{if(!active)updateDuration(Number(btn.dataset.seconds));}));
  function setMessage(text=''){ui.message.textContent=text;}
  function setLive(on){ui.mic.classList.toggle('live',on);ui.micStatus.textContent=on?'Ouvindo':'Pronto';}
  function resetVisual(){bars.forEach(b=>b.style.height='4px');ui.progress.style.width='0%';ui.progressTrack.setAttribute('aria-valuenow','0');}

  async function begin() {
    if(active)return;
    if(!permitted()){ui.paywall.hidden=false;return;}
    if(!navigator.mediaDevices?.getUserMedia || !(window.AudioContext||window.webkitAudioContext)){
      setMessage('Este navegador não oferece captura de áudio. Tente uma versão atualizada do Chrome ou Safari.');return;
    }
    setMessage('');ui.start.disabled=true;ui.start.textContent='Solicitando acesso ao microfone…';
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      audioContext=new(window.AudioContext||window.webkitAudioContext)();
      if(audioContext.state==='suspended')await audioContext.resume();
      analyser=audioContext.createAnalyser();analyser.fftSize=4096;analyser.smoothingTimeConstant=.4;
      source=audioContext.createMediaStreamSource(stream);source.connect(analyser);
      chroma=new Float64Array(12);pitchCounts=new Float64Array(12);frameCount=0;voiceFrames=[];active=true;
      ui.result.hidden=true;ui.start.disabled=false;ui.start.innerHTML='<span aria-hidden="true">■</span> Parar análise';
      ui.hint.textContent=mode==='voice'?'Cante uma frase com notas sustentadas…':'Escutando a música…';setLive(true);resetVisual();
      const started=performance.now(),total=duration*1000;lastSampleAt=started-SAMPLE_INTERVAL_MS;
      const loop=now=>{
        if(!active)return;
        const elapsed=now-started,remaining=Math.max(0,total-elapsed),pct=Math.min(100,elapsed/total*100);
        ui.countdown.innerHTML=`${Math.ceil(remaining/1000)}<span>s</span>`;
        ui.progress.style.width=`${pct}%`;ui.progressTrack.setAttribute('aria-valuenow',String(Math.round(pct)));
        if(now-lastSampleAt>=SAMPLE_INTERVAL_MS){lastSampleAt=now;collectFrame(elapsed/1000);}
        if(remaining<=0){finish();return;}
        raf=requestAnimationFrame(loop);
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
  function collectFrame(timeSeconds) {
    if(!analyser)return;
    const n=analyser.fftSize,data=new Float32Array(n);analyser.getFloatTimeDomainData(data);
    const spectrum=new Float32Array(analyser.frequencyBinCount);analyser.getFloatFrequencyData(spectrum);
    let rms=0;for(let i=0;i<n;i++)rms+=data[i]*data[i];rms=Math.sqrt(rms/n);
    drawBars(spectrum);
    const minRms=mode==='voice'?.006:.008;
    if(rms<minRms){if(mode==='voice')voiceFrames.push({time:timeSeconds,silence:true});return;}
    const pitch=detectPitch(data,audioContext.sampleRate);
    const pitchValid=pitch&&pitch.frequency>=65&&pitch.frequency<=1100&&pitch.confidence>(mode==='voice'?.62:.58);
    if(mode==='voice'){
      if(pitchValid){
        const midi=69+12*Math.log2(pitch.frequency/440),note=Math.round(midi);
        voiceFrames.push({time:timeSeconds,midi,note:((note%12)+12)%12,confidence:pitch.confidence,rms,silence:false});
      } else voiceFrames.push({time:timeSeconds,silence:true});
      if(pitchValid)frameCount++;
      return;
    }
    if(pitchValid){
      const midi=69+12*Math.log2(pitch.frequency/440),rounded=Math.round(midi),cls=((rounded%12)+12)%12;
      pitchCounts[cls]+=Math.max(.25,Math.min(1,pitch.confidence));
    }
    const binHz=audioContext.sampleRate/analyser.fftSize;
    for(let bin=2;bin<spectrum.length;bin++){
      const db=spectrum[bin];if(!Number.isFinite(db)||db < -92)continue;
      const freq=bin*binHz;if(freq<55||freq>2200)continue;
      const midi=69+12*Math.log2(freq/440);if(!Number.isFinite(midi))continue;
      const nearest=Math.round(midi),cents=Math.abs(midi-nearest);if(cents>.48)continue;
      const amp=Math.pow(10,db/20),weight=amp*amp/(1+Math.log2(freq/55)*.45);
      const cls=((nearest%12)+12)%12;chroma[cls]+=weight*(1-cents*.8);
    }
    frameCount++;
  }
  function drawBars(spectrum){
    const step=Math.max(1,Math.floor((spectrum.length-2)/bars.length));
    bars.forEach((bar,i)=>{const db=spectrum[Math.min(spectrum.length-1,2+i*step)];const norm=Number.isFinite(db)?Math.max(0,Math.min(1,(db+90)/65)):0;bar.style.height=`${4+norm*58}px`;bar.style.opacity=String(.3+norm*.7);});
  }
  // Autocorrelação normalizada, com decimação 2: reduz CPU e preserva a faixa de voz/melodia.
  function detectPitch(input,sampleRate){
    const factor=2,size=Math.floor(input.length/factor),reduced=new Float32Array(size);let mean=0;
    for(let i=0;i<size;i++){reduced[i]=(input[i*factor]+input[i*factor+1])*.5;mean+=reduced[i];}mean/=size;
    let energy=0;for(let i=0;i<size;i++){const x=reduced[i]-mean;energy+=x*x;}if(energy/size<.000035)return null;
    const reducedRate=sampleRate/factor,minLag=Math.max(2,Math.floor(reducedRate/1000)),maxLag=Math.min(Math.floor(reducedRate/65),Math.floor(size*.45));
    let bestLag=-1,best=-1;const correlations=new Float32Array(maxLag+1);
    for(let lag=minLag;lag<=maxLag;lag++){
      let cross=0,left=0,right=0;
      for(let i=0;i<size-lag;i++){const a=reduced[i]-mean,b=reduced[i+lag]-mean;cross+=a*b;left+=a*a;right+=b*b;}
      const corr=cross/Math.sqrt((left+1e-15)*(right+1e-15));correlations[lag]=corr;
      if(corr>best){best=corr;bestLag=lag;}
    }
    if(bestLag<0||best<(mode==='voice'?.62:.55))return null;
    for(let lag=minLag+1;lag<bestLag;lag++){const c=correlations[lag];if(c>.72&&c>=correlations[lag-1]&&c>=correlations[lag+1]){bestLag=lag;best=c;break;}}
    const a=correlations[bestLag-1]||best,b=correlations[bestLag],c=correlations[bestLag+1]||best;
    const denom=a-2*b+c,shift=Math.abs(denom)>1e-8?.5*(a-c)/denom:0;
    return{frequency:reducedRate/(bestLag+Math.max(-.5,Math.min(.5,shift))),confidence:best};
  }
  function finish(){
    if(!active)return;active=false;cancelAnimationFrame(raf);ui.progress.style.width='100%';ui.progressTrack.setAttribute('aria-valuenow','100');
    const result=mode==='voice'?analyzeVoice():analyzeMusic();
    void stopAudio();setLive(false);ui.hint.textContent='Análise concluída';ui.countdown.innerHTML='✓';
    ui.start.disabled=false;updateModeLabelOnly();
    if(!result){setMessage(mode==='voice'?'Não consegui separar uma nota cantada estável. Tente cantar uma frase com notas mais longas, perto do microfone e com pouco ruído.':'Não detectei notas suficientes. Tente um trecho mais melódico, com menos ruído, e analise novamente.');return;}
    setMessage('');showResult(result);
  }
  async function stopAudio(){
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
    if(source){try{source.disconnect();}catch{}source=null;}
    if(audioContext){try{await audioContext.close();}catch{}audioContext=null;}
    analyser=null;
  }
  function analyzeMusic(){
    const spectrumSum=chroma.reduce((a,b)=>a+b,0),pMax=Math.max(0,...pitchCounts),sMax=Math.max(0,...chroma);
    if(pMax>0)for(let i=0;i<12;i++)chroma[i]+=pitchCounts[i]*(spectrumSum>0?Math.max(sMax*.20,spectrumSum*.055):1);
    const sum=chroma.reduce((a,b)=>a+b,0);if(frameCount<6||sum<=1e-10)return null;
    const values=Array.from(chroma),mean=values.reduce((a,b)=>a+b,0)/12,centered=values.map(x=>x-mean);
    const norm=Math.sqrt(centered.reduce((s,x)=>s+x*x,0));if(norm<1e-9)return null;
    const scores=keys.map(k=>{const pm=k.profile.reduce((a,b)=>a+b,0)/12,prof=k.profile.map(x=>x-pm);let dot=0,den=0;for(let i=0;i<12;i++){dot+=centered[i]*prof[i];den+=prof[i]*prof[i];}return{...k,score:dot/(norm*Math.sqrt(den))};}).sort((a,b)=>b.score-a.score);
    const top=scores[0],second=scores[1],separation=Math.max(0,top.score-second.score);
    const base=Math.max(0,Math.min(1,(top.score+.05)/.58)),gap=Math.max(0,Math.min(1,separation/.17));
    const evidence=Math.max(.35,Math.min(1,Math.log1p(frameCount)/Math.log(110)));
    const confidence=Math.round(100*(.58*base+.27*gap+.15*evidence));
    const relRoot=top.mode==='Maior'?(top.root+9)%12:(top.root+3)%12,relMode=top.mode==='Maior'?'Menor':'Maior';
    const relative=`${NOTES[relRoot]} / ${SHORT_NOTES[relRoot]} ${relMode}`;
    const notes=values.map((v,i)=>({i,v})).sort((a,b)=>b.v-a.v).slice(0,3).map(x=>x.i);
    return{type:'music',key:`${NOTES[top.root]} / ${SHORT_NOTES[top.root]} ${top.mode}`,mode:top.mode,relative,confidence,notes};
  }
  function buildVoiceSegments(analysisLength){
    const valid=voiceFrames.filter(f=>!f.silence),segments=[];let current=null;
    for(const frame of valid){
      if(current&&frame.note===current.note&&frame.time-current.lastTime<=.18){
        current.frames.push(frame);current.lastTime=frame.time;current.confidenceSum+=frame.confidence;continue;
      }
      if(current){current.end=current.lastTime+SAMPLE_INTERVAL_MS/1000;segments.push(current);}
      current={note:frame.note,start:frame.time,lastTime:frame.time,frames:[frame],confidenceSum:frame.confidence,end:frame.time+SAMPLE_INTERVAL_MS/1000};
    }
    if(current){current.end=current.lastTime+SAMPLE_INTERVAL_MS/1000;segments.push(current);}
    return segments.map((seg,index)=>{
      const duration=Math.max(SAMPLE_INTERVAL_MS/1000,seg.end-seg.start),mids=seg.frames.map(f=>f.midi).sort((a,b)=>a-b);
      const median=mids[Math.floor(mids.length/2)],deviations=mids.map(v=>Math.abs(v-median)).sort((a,b)=>a-b),mad=deviations[Math.floor(deviations.length/2)]||0;
      const spreadCents=mad*100,stability=Math.max(0,Math.min(1,1-spreadCents/65));
      const avgConfidence=seg.confidenceSum/seg.frames.length;
      const next=segments[index+1],pauseAfter=next?Math.max(0,next.start-seg.end):Math.max(0,analysisLength-seg.end);
      const eligible=duration>=.20&&stability>=.18;
      // Long, stable notes get duration weight; a following breath/rest boosts likely phrase-final resolution.
      const sustainWeight=duration*(.55+.75*stability)*(.65+.35*avgConfidence);
      const restBoost=pauseAfter>=.22?1+Math.min(.75,(pauseAfter-.22)*.8):1;
      const shortPassagePenalty=duration<.34?.55:1;
      return{...seg,duration,stability,spreadCents,pauseAfter,weight:eligible?sustainWeight*restBoost*shortPassagePenalty:0,eligible};
    });
  }
  function analyzeVoice(){
    const segments=buildVoiceSegments(duration).filter(s=>s.eligible&&s.weight>0);if(!segments.length)return null;
    const totals=new Float64Array(12),sustain=new Float64Array(12),restCount=new Float64Array(12);
    for(const seg of segments){totals[seg.note]+=seg.weight;sustain[seg.note]+=seg.duration;if(seg.pauseAfter>=.22)restCount[seg.note]+=1;}
    const ranked=Array.from({length:12},(_,i)=>({note:i,weight:totals[i],seconds:sustain[i],rests:restCount[i]})).filter(n=>n.weight>0).sort((a,b)=>b.weight-a.weight);
    if(!ranked.length)return null;
    const lead=ranked[0],other=ranked.slice(1,4).map(n=>n.note);
    // Indicador heurístico de concentração das notas, estabilidade e quantidade de amostras úteis.
    const totalWeight=ranked.reduce((s,n)=>s+n.weight,0),dominance=lead.weight/Math.max(totalWeight,1e-9);
    const related=segments.filter(s=>s.note===lead.note);
    const avgStability=related.reduce((s,v)=>s+v.stability*v.duration,0)/Math.max(lead.seconds,1e-9);
    const coverage=Math.min(1,voiceFrames.length/80);
    const confidence=Math.round(Math.max(25,Math.min(96,100*(.48*dominance+.32*avgStability+.20*coverage))));
    return{type:'voice',key:`${NOTES[lead.note]} / ${SHORT_NOTES[lead.note]}`,seconds:lead.seconds,secondary:other,confidence,restCount:lead.rests};
  }
  function showResult(result){
    ui.resultEyebrow.textContent=result.type==='voice'?'LEITURA DA MELODIA':'SUA ESTIMATIVA';
    if(result.type==='voice'){
      ui.resultHeading.textContent='Nota de repouso principal';
      ui.keyName.textContent=result.key;
      ui.keyMode.textContent='Nota de repouso / tom da voz';
      ui.metricOneLabel.textContent='SUSTENTAÇÃO NESSA NOTA';
      ui.relative.textContent=formatSeconds(result.seconds);
      ui.metricTwoLabel.textContent='CONFIANÇA ESTIMADA';ui.confidence.textContent=`${result.confidence}%`;
      ui.notesTitle.textContent='Notas de apoio da melodia';ui.notesSubtitle.textContent='para testar no instrumento';
      ui.disclaimer.textContent=`Repouso melódico estimado por estabilidade e duração das notas${result.restCount?' e finais de frase próximos a pausas':''}. “Confiança” é um indicador heurístico, não uma probabilidade calibrada.`;
      const notes=result.secondary.length?result.secondary.map(n=>`${NOTES[n]} · ${SHORT_NOTES[n]}`):['Sem outras notas estáveis'];
      renderNotes(notes);
    }else{
      ui.resultHeading.textContent='Tom identificado';ui.keyName.textContent=result.key;ui.keyMode.textContent='Tonalidade principal';
      ui.metricOneLabel.textContent='TOM RELATIVO';ui.relative.textContent=result.relative;
      ui.metricTwoLabel.textContent='CONFIANÇA ESTIMADA';ui.confidence.textContent=`${result.confidence}%`;
      ui.notesTitle.textContent='Notas mais presentes';ui.notesSubtitle.textContent='no trecho analisado';
      ui.disclaimer.textContent='Estimativa baseada no conteúdo harmônico captado. Em músicas com mudanças de tom, muitos instrumentos ou ruído, o resultado pode variar.';
      renderNotes(result.notes.map(i=>`${NOTES[i]} · ${SHORT_NOTES[i]}`));
    }
    ui.result.hidden=false;ui.result.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function renderNotes(notes){
    ui.topNotes.replaceChildren(...notes.map(label=>{const el=document.createElement('span');el.className='note-chip';el.textContent=label;return el;}));
  }
  function formatSeconds(seconds){return `${seconds.toFixed(1).replace('.',',')} s`+(seconds>=1?' de sustentação':'');}
  function updateModeLabelOnly(){
    ui.start.innerHTML=mode==='voice'?'<span aria-hidden="true">●</span> Analisar minha voz':'<span aria-hidden="true">●</span> Analisar música';
  }
  ui.start.addEventListener('click',()=>{
    if(active){active=false;cancelAnimationFrame(raf);void stopAudio();setLive(false);ui.hint.textContent='Análise interrompida';ui.start.disabled=false;updateModeLabelOnly();return;}
    void begin();
  });
  ui.again.addEventListener('click',()=>{ui.result.hidden=true;setMessage('');updateDuration(duration);resetVisual();ui.hint.textContent=mode==='voice'?'Pronto para ouvir sua voz':'Pronto para ouvir';window.scrollTo({top:0,behavior:'smooth'});});
  ui.installButton.addEventListener('click',async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;ui.installButton.hidden=true;}else ui.installHelp.hidden=false;});
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;ui.installButton.hidden=false;});
  window.addEventListener('appinstalled',()=>{ui.installButton.hidden=true;deferredInstall=null;});
  document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>{const modal=document.getElementById(btn.dataset.close);if(modal)modal.hidden=true;}));
  ui.unlockButton.addEventListener('click',()=>{
    if(ui.unlockButton.disabled)return;
    const ok=window.confirm('Atenção: o Tom Certo não consegue verificar o pagamento Pix. Continuar vai liberar este navegador sem confirmar a transação.');
    if(!ok)return;
    ui.unlockButton.disabled=true;let left=4;ui.unlockStatus.textContent=`Liberando acesso local… ${left}s`;
    const tick=()=>{left--;if(left>0){ui.unlockStatus.textContent=`Liberando acesso local… ${left}s`;timer=window.setTimeout(tick,1000);}else{saveState({isUnlocked:true,unlockedAt:Date.now()});ui.paywall.hidden=true;ui.trialBadge.hidden=true;ui.unlockStatus.textContent='Acesso local liberado neste navegador.';ui.unlockButton.disabled=false;}};
    timer=window.setTimeout(tick,1000);
  });
  if('serviceWorker'in navigator&&location.protocol.startsWith('http'))window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  setTrialAndAccess();updateMode(mode);
})();
