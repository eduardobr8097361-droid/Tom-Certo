(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const ui = {
    trialBadge: $('#trialBadge'), trialNotice: $('#trialNotice'), trialRemaining: $('#trialRemaining'),
    installButton: $('#installButton'), installHelp: $('#installHelp'), paywall: $('#paywall'),
    unlockButton: $('#unlockButton'), unlockStatus: $('#unlockStatus'),
    durationOptions: [...document.querySelectorAll('.duration-option')], countdown: $('#countdown'),
    hint: $('#visualizerHint'), visualizer: $('#visualizer'), progress: $('#progressFill'), progressTrack: $('#progressTrack'),
    mic: $('#micIndicator'), micStatus: $('#micStatus'), message: $('#inlineMessage'), start: $('#startButton'), again: $('#againButton'),
    result: $('#resultCard'), keyName: $('#keyName'), relative: $('#relativeKey'), confidence: $('#confidence'), topNotes: $('#topNotes'),
  };
  const STATE_KEY = 'tom-certo-v1';
  const TRIAL_MS = 15 * 60 * 1000;
  const TRIAL_KEYS = ['tom-certo-trial-start-v2','tom-certo.first-access.v2','tomcerto_trial_started_at'];
  const UNLOCK_KEYS = ['tom-certo-unlocked-v2','tom-certo.access.v2'];
  const SAMPLE_INTERVAL_MS = 45;
  const NOTES_PT = ['Dó','Dó♯','Ré','Ré♯','Mi','Fá','Fá♯','Sol','Sol♯','Lá','Lá♯','Si'];
  const NOTES_INT = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  const MAJOR_PROFILE = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
  const MINOR_PROFILE = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
  let duration = 25, stream = null, audioContext = null, analyser = null, source = null;
  let raf = 0, trialTicker = 0, active = false, deferredInstall = null, trialStart = 0;
  let chroma = new Float64Array(12), pitchCounts = new Float64Array(12), frameCount = 0, lastSampleAt = 0;
  const bars = [];
  for (let i=0;i<48;i++) { const bar=document.createElement('span'); ui.visualizer.appendChild(bar); bars.push(bar); }

  function rotate(profile, offset) { return profile.map((_, i) => profile[(i-offset+12)%12]); }
  function readState() { try { return JSON.parse(localStorage.getItem(STATE_KEY)||'{}'); } catch { return {}; } }
  function writeState(data) { try { localStorage.setItem(STATE_KEY,JSON.stringify({...readState(),...data})); } catch {} }
  function unlockIsSaved(state=readState()) {
    if (state.isUnlocked) return true;
    return UNLOCK_KEYS.some(key=>{ try { return localStorage.getItem(key)==='1'; } catch { return false; } });
  }
  function setUnlocked() {
    writeState({isUnlocked:true,unlockedAt:Date.now()});
    for (const key of UNLOCK_KEYS) { try { localStorage.setItem(key,'1'); } catch {} }
  }
  function saveTrialStart(timestamp) {
    trialStart=timestamp; writeState({trialStartTimestamp:timestamp});
    for (const key of TRIAL_KEYS) { try { localStorage.setItem(key,String(timestamp)); } catch {} }
  }
  function clearTomCertoStorage() {
    for (const key of [STATE_KEY,...TRIAL_KEYS,...UNLOCK_KEYS,'tom-certo-trial-start','tom-certo-v1-trial']) {
      try { localStorage.removeItem(key); } catch {}
    }
  }
  function initTrial() {
    if (new URLSearchParams(location.search).get('reset')==='1') {
      clearTomCertoStorage(); history.replaceState({},'',location.pathname+location.hash);
    }
    const state=readState();
    const stored=[state.trialStartTimestamp,...TRIAL_KEYS.map(key=>{ try { return Number(localStorage.getItem(key)); } catch { return NaN; } })]
      .map(Number).filter(value=>Number.isFinite(value)&&value>0);
    // A data mais antiga espelhada evita que a remoção de uma única chave reinicie o contador.
    trialStart=stored.length?Math.min(...stored):Date.now();
    if (!stored.length||stored.some(value=>value!==trialStart)) saveTrialStart(trialStart);
    refreshTrialUI(); trialTicker=window.setInterval(refreshTrialUI,1000);
  }
  function remainingTrialMs() { return Math.max(0,TRIAL_MS-(Date.now()-trialStart)); }
  function formatClock(milliseconds) {
    const seconds=Math.ceil(milliseconds/1000),minutes=Math.floor(seconds/60),remainder=seconds%60;
    return `${String(minutes).padStart(2,'0')}:${String(remainder).padStart(2,'0')}`;
  }
  function refreshTrialUI() {
    const unlocked=unlockIsSaved(),remaining=remainingTrialMs();
    ui.trialBadge.hidden=unlocked;
    ui.trialBadge.textContent=remaining>0?`Teste: ${formatClock(remaining)}`:'Teste encerrado';
    ui.trialRemaining.textContent=unlocked?'Acesso liberado':`${formatClock(remaining)} restantes`;
    if (unlocked) { ui.trialNotice.classList.add('trial-complete'); ui.trialNotice.querySelector('strong').textContent='Acesso liberado neste navegador'; }
    if (!unlocked&&remaining<=0&&!active) ui.paywall.hidden=false;
  }
  function permitted() { return unlockIsSaved()||Date.now()-trialStart<TRIAL_MS; }

  function updateDuration(seconds) {
    duration=seconds;
    ui.durationOptions.forEach(button=>{
      const selected=Number(button.dataset.seconds)===duration;
      button.classList.toggle('active',selected); button.setAttribute('aria-pressed',String(selected));
    });
    if (!active) ui.countdown.innerHTML=`${duration}<span>s</span>`;
  }
  ui.durationOptions.forEach(button=>button.addEventListener('click',()=>{ if (!active) updateDuration(Number(button.dataset.seconds)); }));
  function setMessage(text='') { ui.message.textContent=text; }
  function setLive(on) { ui.mic.classList.toggle('live',on); ui.micStatus.textContent=on?'Ouvindo':'Pronto'; }
  function resetVisual() { bars.forEach(bar=>bar.style.height='4px'); ui.progress.style.width='0%'; ui.progressTrack.setAttribute('aria-valuenow','0'); }

  async function begin() {
    if (active) return;
    if (!permitted()) { ui.paywall.hidden=false; return; }
    if (!navigator.mediaDevices?.getUserMedia||!(window.AudioContext||window.webkitAudioContext)) {
      setMessage('Este navegador não oferece captura de áudio. Tente uma versão atualizada do Chrome ou Safari.'); return;
    }
    setMessage(''); ui.start.disabled=true; ui.start.textContent='Solicitando acesso ao microfone…';
    try {
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      audioContext=new(window.AudioContext||window.webkitAudioContext)();
      if (audioContext.state==='suspended') await audioContext.resume();
      analyser=audioContext.createAnalyser(); analyser.fftSize=4096; analyser.smoothingTimeConstant=.4;
      source=audioContext.createMediaStreamSource(stream); source.connect(analyser);
      chroma=new Float64Array(12); pitchCounts=new Float64Array(12); frameCount=0; active=true;
      ui.result.hidden=true; ui.start.disabled=false; ui.start.innerHTML='<span aria-hidden="true">■</span> Parar análise';
      ui.hint.textContent='Cante ou reproduza um trecho…'; setLive(true); resetVisual();
      const started=performance.now(),total=duration*1000; lastSampleAt=started-SAMPLE_INTERVAL_MS;
      const loop=now=>{
        if (!active) return;
        const elapsed=now-started,remaining=Math.max(0,total-elapsed),pct=Math.min(100,elapsed/total*100);
        ui.countdown.innerHTML=`${Math.ceil(remaining/1000)}<span>s</span>`;
        ui.progress.style.width=`${pct}%`; ui.progressTrack.setAttribute('aria-valuenow',String(Math.round(pct)));
        if (now-lastSampleAt>=SAMPLE_INTERVAL_MS) { lastSampleAt=now; collectFrame(); }
        if (remaining<=0) { finish(); return; }
        raf=requestAnimationFrame(loop);
      };
      raf=requestAnimationFrame(loop);
    } catch (error) {
      await stopAudio(); ui.start.disabled=false; updateStartLabel();
      if (error?.name==='NotAllowedError'||error?.name==='PermissionDeniedError') setMessage('Permissão do microfone negada. Autorize o acesso nas configurações do navegador e tente novamente.');
      else if (error?.name==='NotFoundError') setMessage('Nenhum microfone foi encontrado neste aparelho.');
      else if (error?.name==='NotReadableError') setMessage('O microfone está sendo usado por outro aplicativo. Feche-o e tente novamente.');
      else setMessage('Não foi possível iniciar o microfone. Confira a conexão HTTPS e as permissões do navegador.');
      ui.hint.textContent='Pronto para ouvir'; setLive(false);
    }
  }
  function collectFrame() {
    if (!analyser) return;
    const timeData=new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(timeData);
    const spectrum=new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(spectrum);
    let rms=0; for (let i=0;i<timeData.length;i++) rms+=timeData[i]*timeData[i]; rms=Math.sqrt(rms/timeData.length);
    drawBars(spectrum);
    if (rms<.008) return; // filtro de silêncio/ruído antes de atualizar pitch e cromagrama
    const pitch=detectPitch(timeData,audioContext.sampleRate);
    if (pitch&&pitch.frequency>=65&&pitch.frequency<=1100&&pitch.confidence>.58) {
      const midi=69+12*Math.log2(pitch.frequency/440),note=Math.round(midi),pitchClass=((note%12)+12)%12;
      pitchCounts[pitchClass]+=Math.max(.25,Math.min(1,pitch.confidence));
    }
    const binHz=audioContext.sampleRate/analyser.fftSize;
    for (let bin=2;bin<spectrum.length;bin++) {
      const db=spectrum[bin]; if (!Number.isFinite(db)||db < -92) continue;
      const frequency=bin*binHz; if (frequency<55||frequency>2200) continue;
      const midi=69+12*Math.log2(frequency/440); if (!Number.isFinite(midi)) continue;
      const nearest=Math.round(midi),cents=Math.abs(midi-nearest); if (cents>.48) continue;
      const amplitude=Math.pow(10,db/20),weight=amplitude*amplitude/(1+Math.log2(frequency/55)*.45);
      chroma[((nearest%12)+12)%12]+=weight*(1-cents*.8);
    }
    frameCount++;
  }
  function drawBars(spectrum) {
    const step=Math.max(1,Math.floor((spectrum.length-2)/bars.length));
    bars.forEach((bar,index)=>{
      const db=spectrum[Math.min(spectrum.length-1,2+index*step)],level=Number.isFinite(db)?Math.max(0,Math.min(1,(db+90)/65)):0;
      bar.style.height=`${4+level*58}px`; bar.style.opacity=String(.3+level*.7);
    });
  }
  // Autocorrelação normalizada no domínio do tempo, adequada como apoio para voz e melodias monofônicas.
  function detectPitch(input,sampleRate) {
    const factor=2,size=Math.floor(input.length/factor),reduced=new Float32Array(size); let mean=0;
    for (let i=0;i<size;i++) { reduced[i]=(input[i*factor]+input[i*factor+1])*.5; mean+=reduced[i]; }
    mean/=size;
    let energy=0; for (let i=0;i<size;i++) { const sample=reduced[i]-mean; energy+=sample*sample; }
    if (energy/size<.000035) return null;
    const reducedRate=sampleRate/factor,minLag=Math.max(2,Math.floor(reducedRate/1000)),maxLag=Math.min(Math.floor(reducedRate/65),Math.floor(size*.45));
    let bestLag=-1,best=-1; const correlations=new Float32Array(maxLag+1);
    for (let lag=minLag;lag<=maxLag;lag++) {
      let cross=0,left=0,right=0;
      for (let i=0;i<size-lag;i++) { const a=reduced[i]-mean,b=reduced[i+lag]-mean; cross+=a*b; left+=a*a; right+=b*b; }
      const correlation=cross/Math.sqrt((left+1e-15)*(right+1e-15)); correlations[lag]=correlation;
      if (correlation>best) { best=correlation; bestLag=lag; }
    }
    if (bestLag<0||best<.55) return null;
    for (let lag=minLag+1;lag<bestLag;lag++) {
      const value=correlations[lag];
      if (value>.72&&value>=correlations[lag-1]&&value>=correlations[lag+1]) { bestLag=lag; best=value; break; }
    }
    const left=correlations[bestLag-1]||best,center=correlations[bestLag],right=correlations[bestLag+1]||best;
    const denominator=left-2*center+right,shift=Math.abs(denominator)>1e-8?.5*(left-right)/denominator:0;
    return {frequency:reducedRate/(bestLag+Math.max(-.5,Math.min(.5,shift))),confidence:best};
  }
  function finish() {
    if (!active) return;
    active=false; cancelAnimationFrame(raf); ui.progress.style.width='100%'; ui.progressTrack.setAttribute('aria-valuenow','100');
    const result=analyzeKey(); void stopAudio(); setLive(false); ui.hint.textContent='Análise concluída'; ui.countdown.innerHTML='✓'; updateStartLabel();
    if (result) { setMessage(''); showResult(result); }
    else setMessage('Não detectei conteúdo tonal suficiente. Tente um trecho mais claro e com menos ruído.');
    refreshTrialUI();
  }
  async function stopAudio() {
    if (stream) { stream.getTracks().forEach(track=>track.stop()); stream=null; }
    if (source) { try { source.disconnect(); } catch {} source=null; }
    if (audioContext) { try { await audioContext.close(); } catch {} audioContext=null; }
    analyser=null;
  }
  function analyzeKey() {
    const spectrumSum=chroma.reduce((a,b)=>a+b,0),pitchMaximum=Math.max(0,...pitchCounts),chromaMaximum=Math.max(0,...chroma);
    if (pitchMaximum>0) {
      for (let note=0;note<12;note++) chroma[note]+=pitchCounts[note]*(spectrumSum>0?Math.max(chromaMaximum*.20,spectrumSum*.055):1);
    }
    const sum=chroma.reduce((a,b)=>a+b,0); if (frameCount<6||sum<=1e-10) return null;
    const values=Array.from(chroma),mean=values.reduce((a,b)=>a+b,0)/12,centered=values.map(value=>value-mean);
    const norm=Math.sqrt(centered.reduce((total,value)=>total+value*value,0)); if (norm<1e-9) return null;
    const candidates=[];
    for (let root=0;root<12;root++) {
      for (const mode of ['Maior','Menor']) {
        const profile=rotate(mode==='Maior'?MAJOR_PROFILE:MINOR_PROFILE,root),profileMean=profile.reduce((a,b)=>a+b,0)/12,centeredProfile=profile.map(value=>value-profileMean);
        let dot=0,denominator=0;
        for (let note=0;note<12;note++) { dot+=centered[note]*centeredProfile[note]; denominator+=centeredProfile[note]*centeredProfile[note]; }
        const score=dot/(norm*Math.sqrt(denominator));
        const relativeRoot=mode==='Maior'?(root+9)%12:(root+3)%12,relativeMode=mode==='Maior'?'Menor':'Maior';
        candidates.push({root,mode,score,relative:`${NOTES_PT[relativeRoot]} / ${NOTES_INT[relativeRoot]} ${relativeMode}`});
      }
    }
    candidates.sort((a,b)=>b.score-a.score);
    const best=candidates[0],runnerUp=candidates[1],gap=Math.max(0,best.score-runnerUp.score);
    const fit=Math.max(0,Math.min(1,(best.score+.05)/.58)),separation=Math.max(0,Math.min(1,gap/.17));
    const evidence=Math.max(.35,Math.min(1,Math.log1p(frameCount)/Math.log(110)));
    const confidence=Math.round(100*(.58*fit+.27*separation+.15*evidence));
    const notes=values.map((value,index)=>({value,index})).sort((a,b)=>b.value-a.value).slice(0,3).map(item=>item.index);
    return {key:`${NOTES_PT[best.root]} / ${NOTES_INT[best.root]} ${best.mode}`,relative:best.relative,confidence,notes};
  }
  function showResult(result) {
    ui.keyName.textContent=result.key; ui.relative.textContent=result.relative; ui.confidence.textContent=`${result.confidence}%`;
    ui.topNotes.replaceChildren(...result.notes.map(note=>{
      const chip=document.createElement('span'); chip.className='note-chip'; chip.textContent=`${NOTES_PT[note]} · ${NOTES_INT[note]}`; return chip;
    }));
    ui.result.hidden=false; ui.result.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function updateStartLabel() { ui.start.innerHTML='<span aria-hidden="true">●</span> Analisar com microfone'; }
  ui.start.addEventListener('click',()=>{
    if (active) {
      active=false; cancelAnimationFrame(raf); void stopAudio(); setLive(false); ui.hint.textContent='Análise interrompida'; updateStartLabel(); refreshTrialUI(); return;
    }
    void begin();
  });
  ui.again.addEventListener('click',()=>{
    ui.result.hidden=true; setMessage(''); updateDuration(duration); resetVisual(); ui.hint.textContent='Pronto para ouvir';
    window.scrollTo({top:0,behavior:'smooth'});
  });
  ui.installButton.addEventListener('click',async()=>{
    if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall=null; ui.installButton.hidden=true; }
    else ui.installHelp.hidden=false;
  });
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;ui.installButton.hidden=false;});
  window.addEventListener('appinstalled',()=>{ui.installButton.hidden=true;deferredInstall=null;});
  window.addEventListener('load',()=>{
    const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent||'')||(navigator.platform==='MacIntel'&&(navigator.maxTouchPoints||0)>1);
    const installed=window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;
    if (ios&&!installed&&!deferredInstall) ui.installButton.hidden=false;
  });
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>{
    const modal=document.getElementById(button.dataset.close); if (modal) modal.hidden=true;
  }));
  ui.unlockButton.addEventListener('click',()=>{
    setUnlocked();
    if (!unlockIsSaved()) {
      ui.unlockStatus.textContent='Não foi possível salvar a liberação neste navegador. Verifique as permissões de armazenamento e tente novamente.';
      return;
    }
    ui.paywall.hidden=true;
    ui.unlockStatus.textContent='Acesso local liberado neste aparelho. O Pix não foi verificado pelo app.';
    refreshTrialUI();
  });
  if ('serviceWorker'in navigator&&location.protocol.startsWith('http')) {
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  }
  initTrial();
  updateDuration(duration);
})();
