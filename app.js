(function(){
  var search=document.getElementById('search');
  var searchClear=document.getElementById('searchClear');
  var listEl=document.getElementById('list');
  var freqInput=document.getElementById('freq');
  var playBtn=document.getElementById('play');
  var stopBtn=document.getElementById('stop');
  var vol=document.getElementById('volume');
  var nowPlaying=document.getElementById('now-playing');
  var categorySel=document.getElementById('category');
  var onlyFavs=document.getElementById('onlyFavs');
  var playSelectedBtn=document.getElementById('playSelected');
  var selCountEl=document.getElementById('selCount');
  var clearSelectedBtn=document.getElementById('clearSelected');
  var bgLoopSelect=document.getElementById('bgLoopSelect');
  var bgLoopVolume=document.getElementById('bgLoopVolume');
  var audioOut=document.getElementById('audioOut');
  var sleepTimerSel=document.getElementById('sleepTimer');
  var timerCustomWrap=document.getElementById('timerCustomWrap');
  var timerHrs=document.getElementById('timerHrs');
  var timerMin=document.getElementById('timerMin');
  var timerCountdown=document.getElementById('timerCountdown');
  // Help elements
  var helpBtn=document.getElementById('helpBtn');
  var helpModal=document.getElementById('helpModal');
  var helpClose=document.getElementById('helpClose');
  var helpCloseBtn=document.getElementById('helpCloseBtn');
  // Settings elements
  var settingsBtn=document.getElementById('settingsBtn');
  var settingsModal=document.getElementById('settingsModal');
  var settingsClose=document.getElementById('settingsClose');
  var settingsCancel=document.getElementById('settingsCancel');
  var settingsSave=document.getElementById('settingsSave');
  var themeDark=document.getElementById('themeDark');
  var themeLight=document.getElementById('themeLight');
  var resetAudioBtn=document.getElementById('resetAudio');

  var audioCtx=null,osc=null,gain=null,playing=false, mediaDest=null;
  var directConnected=false; // guard to avoid multiple connection into output chain
  var masterComp=null; // dynamics compressor to prevent clipping/distortion
  var volumeVal=Number(vol.value)/100;
  var bgAudio=null; // fallback media element
  var bgGain=null, bgSource=null, bgMediaSource=null;
  var bgBuffers=Object.create(null);
  var bgVolumeVal=bgLoopVolume? Number(bgLoopVolume.value)/100 : 0.4;
  var DATA=[];
  var voices=[]; // active voices for multi-play
  var selected=new Set(); // selected item ids
  var outputMode=null; // 'direct' | 'media'
  var outputOverride=null; // force 'direct' or 'media' temporarily
  var outputOverrideTimer=null;
  var keepAliveInterval=null; // watchdog to keep sink alive on iOS PWA
  var lastPlayItems=[]; var lastRampIn=5.0; var lastBgId=''; var lastPlayActive=false; var resetting=false;

  function itemId(x){
    return x.id || (String(x.name||'').trim()+"|"+String(x.frequency));
  }
  function isIOS(){ try{ return /iPad|iPhone|iPod/.test(navigator.userAgent); }catch(e){ return false } }
  function isStandalone(){ try{ return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || !!(navigator.standalone); }catch(e){ return false } }
  function preferMediaBG(){ return isIOS() && isStandalone(); }

  function isBgActive(){
    try{ return !!(bgSource || (bgAudio && !bgAudio.paused)); }catch(e){ return false }
  }

  // Theme
  function applyTheme(t){
    var theme=(t==='light')?'light':'dark';
    try{ document.documentElement.setAttribute('data-theme', theme); }catch(e){}
  }
  function loadTheme(){
    try{
      var saved=localStorage.getItem('fd.theme');
      if(saved){ return saved; }
    }catch(e){}
    try{
      if(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches){return 'light'}
    }catch(e){}
    return 'dark';
  }
  function saveTheme(t){ try{localStorage.setItem('fd.theme',t)}catch(e){} }
  function openSettings(){ if(settingsModal) settingsModal.hidden=false; syncThemeRadios(); }
  function closeSettings(){ if(settingsModal) settingsModal.hidden=true; }
  function syncThemeRadios(){
    var t=document.documentElement.getAttribute('data-theme')||'dark';
    if(themeDark) themeDark.checked=(t==='dark');
    if(themeLight) themeLight.checked=(t==='light');
  }

  function updateSelUI(){
    if(selCountEl){ selCountEl.textContent='Selected: '+selected.size; }
    if(playSelectedBtn){ playSelectedBtn.disabled = selected.size===0; }
  }

  function openHelp(){ if(helpModal) helpModal.hidden=false; }
  function closeHelp(){ if(helpModal) helpModal.hidden=true; }

  function loadFavs(){
    try{
      var raw=localStorage.getItem('fd.favs');
      if(!raw) return new Set();
      var arr=JSON.parse(raw);
      if(Array.isArray(arr)) return new Set(arr);
    }catch(e){}
    return new Set();
  }
  function saveFavs(set){
    try{localStorage.setItem('fd.favs',JSON.stringify(Array.from(set)))}catch(e){}
  }
  var favs=loadFavs();

  function ensureAudio(){
    if(audioCtx && audioCtx.state==='closed'){
      audioCtx=null; gain=null; masterComp=null; mediaDest=null; directConnected=false; outputMode=null;
    }
    if(!audioCtx){
      audioCtx=new (window.AudioContext||window.webkitAudioContext)();
      gain=audioCtx.createGain();
      gain.gain.value=0;
      try{
        audioCtx.onstatechange=function(){
          try{
            if(preferMediaBG()){
              if(audioCtx.state==='suspended'){
                try{ audioCtx.resume(); }catch(e){}
              }
              ensureOutputPlaying();
              startKeepAlive();
            }
          }catch(e){}
        };
      }catch(e){}
    }
    // Build output chain: gain -> compressor -> (wired later)
    if(audioCtx && !masterComp){
      try{
        masterComp=audioCtx.createDynamicsCompressor();
        masterComp.threshold.setValueAtTime(-12, audioCtx.currentTime);
        masterComp.knee.setValueAtTime(24, audioCtx.currentTime);
        masterComp.ratio.setValueAtTime(4, audioCtx.currentTime);
        masterComp.attack.setValueAtTime(0.003, audioCtx.currentTime);
        masterComp.release.setValueAtTime(0.25, audioCtx.currentTime);
      }catch(e){}
    }
    if(audioCtx && masterComp && !directConnected){
      try{ gain.connect(masterComp); directConnected=true; }catch(e){}
    }
    if(audioCtx && !bgGain){
      bgGain=audioCtx.createGain();
      bgGain.gain.value=bgVolumeVal;
      // route background loop into master gain
      if(gain) bgGain.connect(gain);
    }
    // ensure output is wired correctly for this environment
    wireOutput();
  }

  function wireOutput(){
    try{
      if(!audioCtx || !masterComp) return;
      var wantMedia = outputOverride? (outputOverride==='media') : preferMediaBG(); // iOS standalone -> use MediaStreamDestination
      if(wantMedia){
        if(outputMode !== 'media'){
          try{ masterComp.disconnect(); }catch(e){}
          try{ if(!mediaDest){ mediaDest = audioCtx.createMediaStreamDestination(); } }catch(e){}
          try{ masterComp.connect(mediaDest); }catch(e){}
          if(audioOut){
            try{ if(audioOut.srcObject !== mediaDest.stream){ audioOut.srcObject = mediaDest.stream; } }catch(e){}
          }
          outputMode='media';
        }
      } else {
        if(outputMode !== 'direct'){
          try{ masterComp.disconnect(); }catch(e){}
          try{ masterComp.connect(audioCtx.destination); }catch(e){}
          outputMode='direct';
        }
      }
    }catch(e){}
  }
  function setOutputOverride(mode, ttlMs){
    try{
      outputOverride = mode || null;
      if(outputOverrideTimer){ try{ clearTimeout(outputOverrideTimer); }catch(e){} outputOverrideTimer=null; }
      if(mode && ttlMs>0){ outputOverrideTimer = setTimeout(function(){ outputOverride=null; outputOverrideTimer=null; wireOutput(); }, ttlMs); }
      wireOutput();
    }catch(e){}
  }

  function clamp(v,min,max){return Math.min(Math.max(v,min),max)}
  function fmtHz(v){return Number(v).toFixed(2)+" Hz"}
  function isMediaOutputBroken(){
    try{
      if(!preferMediaBG()) return false;
      if(!audioOut) return true;
      if(!mediaDest || !mediaDest.stream) return true;
      if(audioOut.srcObject !== mediaDest.stream) return true;
      var trks = mediaDest.stream.getAudioTracks ? mediaDest.stream.getAudioTracks() : [];
      if(!trks || trks.length===0) return true;
      var t=trks[0];
      if(t && t.readyState && t.readyState!=='live') return true;
      return false;
    }catch(e){ return false }
  }
  function startOutputIfNeeded(){
    if(!audioOut) return;
    wireOutput();
    if(isMediaOutputBroken()){ hardResetAudioEngine(true); return; }
    if(!(audioOut.srcObject || audioOut.src)) return; // nothing assigned -> no-op
    try{
      var p=audioOut.play();
      if(p && p.catch){ p.catch(function(){}) }
    }catch(e){}
  }
  var brokenCount=0;
  function ensureOutputPlaying(){
    try{
      if(preferMediaBG()){
        ensureAudio();
        if(isMediaOutputBroken()){
          brokenCount++;
          if(brokenCount>=2){ setOutputOverride('direct', 20000); }
          hardResetAudioEngine(true); return;
        } else { brokenCount=0; }
        if(audioCtx && audioCtx.state==='suspended'){
          try{ audioCtx.resume(); }catch(e){}
        }
        if(audioOut && (audioOut.paused || audioOut.readyState<2)){
          try{ var pp=audioOut.play(); if(pp && pp.catch){ pp.catch(function(){}) } }catch(e){}
        }
      }
    }catch(e){}
  }
  function startKeepAlive(){
    try{
      if(!preferMediaBG()) { stopKeepAlive(); return; }
      if(keepAliveInterval) return;
      keepAliveInterval = setInterval(function(){ ensureAudio(); ensureOutputPlaying(); recoverAudioGraph(); }, 3000);
    }catch(e){}
  }
  function stopKeepAlive(){ try{ if(keepAliveInterval){ clearInterval(keepAliveInterval); } }catch(e){} keepAliveInterval=null; }

  function recoverAudioGraph(){
    try{
      if(!audioCtx) return;
      if(audioCtx.state==='closed'){
        audioCtx=null; gain=null; masterComp=null; mediaDest=null; directConnected=false; outputMode=null;
        ensureAudio(); wireOutput(); startOutputIfNeeded();
      }
    }catch(e){}
  }
  function updateSearchClear(){ if(searchClear){ searchClear.style.display = (search && search.value)? 'inline-flex' : 'none'; } }
  function hasSelection(){
    try{
      var s=window.getSelection&&window.getSelection();
      return !!(s && s.toString());
    }catch(e){return false}
  }
  function parseDurationMs(raw){
    if(!raw) return 0;
    var s=String(raw).trim().toLowerCase().replace(',', '.').replace(/\s+/g,'');
    if(!s) return 0;
    if(/^\d+:\d{1,2}(:\d{1,2})?$/.test(s)){
      var parts=s.split(':').map(function(x){return Number(x)});
      var ms=0;
      if(parts.length===2){ var h=parts[0], m=parts[1]; if(isNaN(h)||isNaN(m)) return 0; ms=((h*60)+m)*60*1000; }
      else { var h2=parts[0], m2=parts[1], sec=parts[2]; if([h2,m2,sec].some(function(v){return isNaN(v)})) return 0; ms=(((h2*60)+m2)*60 + sec)*1000; }
      return ms>0?ms:0;
    }
    var m=s.match(/^([0-9]*\.?[0-9]+)(h|m|s)?$/);
    if(m){
      var val=parseFloat(m[1]); var unit=m[2]||'m'; if(isNaN(val)) return 0;
      if(unit==='h') return Math.max(0, val*3600000);
      if(unit==='m') return Math.max(0, val*60000);
      if(unit==='s') return Math.max(0, val*1000);
    }
    return 0;
  }
  var sleepTimeout=null, sleepDeadline=0, countdownInterval=null, preFadeTimeout=null, postStopTimeout=null;
  function clearPostStopSchedule(){ if(postStopTimeout){ try{clearTimeout(postStopTimeout)}catch(e){} postStopTimeout=null; } }
  function clearFadeSchedule(){ if(preFadeTimeout){ try{clearTimeout(preFadeTimeout)}catch(e){} preFadeTimeout=null; } }
  function startVolumeFade(seconds){
    try{
      if(!gain || !audioCtx) return;
      var now=audioCtx.currentTime;
      var current=gain.gain.value;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(current, now);
      gain.gain.linearRampToValueAtTime(0, now + Math.max(0.001, seconds));
    }catch(e){}
  }
  function restoreMasterVolume(){
    try{
      if(!gain || !audioCtx) return;
      var now=audioCtx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(volumeVal, now, 0.03);
    }catch(e){}
  }
  function hardResetAudioEngine(autoplay){
    if(resetting) return; resetting=true;
    try{
      try{ stopKeepAlive(); }catch(e){}
      try{ if(audioOut){ audioOut.pause(); audioOut.srcObject=null; audioOut.removeAttribute('src'); audioOut.load && audioOut.load();
        // Recreate the audio element to avoid stale sinks
        var oldOut=audioOut; var parent=oldOut && oldOut.parentNode;
        if(parent){ var neo=document.createElement('audio'); neo.id='audioOut'; neo.setAttribute('playsinline',''); neo.style.display='none'; parent.replaceChild(neo, oldOut); audioOut=neo; }
      } }catch(e){}
      if(audioCtx){ try{ audioCtx.close(); }catch(e){} }
      audioCtx=null; gain=null; masterComp=null; mediaDest=null; directConnected=false; outputMode=null; bgGain=null; bgSource=null; bgMediaSource=null;
      ensureAudio(); wireOutput();
      if(autoplay){
        // restart BG first so fades pick it up too
        try{ if(bgLoopSelect && bgLoopSelect.value){ lastBgId=bgLoopSelect.value; startBgLoop(lastBgId); } }catch(e){}
        // restart tones if they were active
        try{ if(lastPlayActive && lastPlayItems && lastPlayItems.length){ startMulti(lastPlayItems.slice(), Math.min(1.0, lastRampIn||0.5)); } }catch(e){}
      }
      attachAudioOutHandlers();
      startKeepAlive(); ensureOutputPlaying();
      verifyResetRecovery();
    }catch(e){} finally{ resetting=false; }
  }
  function verifyResetRecovery(){
    try{
      if(!preferMediaBG()) return;
      setTimeout(function(){
        if(isMediaOutputBroken() || (audioOut && audioOut.paused)){
          // Fall back to direct for a short period to recover UI-level audio, then auto-clear
          setOutputOverride('direct', 20000);
          ensureAudio(); wireOutput(); startOutputIfNeeded();
        }
      }, 1200);
    }catch(e){}
  }
  function stopCountdownDisplay(){
    if(countdownInterval){ try{clearInterval(countdownInterval)}catch(e){} countdownInterval=null; }
    if(timerCountdown){ timerCountdown.hidden=false; timerCountdown.textContent='00:00:00'; }
  }
  function formatClock(ms){
    ms=Math.max(0, Math.floor(ms));
    var totalSec=Math.floor(ms/1000);
    var h=Math.floor(totalSec/3600);
    var m=Math.floor((totalSec%3600)/60);
    var s=totalSec%60;
    var hh=(h<10?'0':'')+h;
    var mm=(m<10?'0':'')+m;
    var ss=(s<10?'0':'')+s;
    return hh+":"+mm+":"+ss;
  }
  function ensureCountdownRunning(){
    if(!timerCountdown){ return; }
    if(playing && sleepDeadline>0){
      timerCountdown.hidden=false;
      timerCountdown.textContent=formatClock(sleepDeadline - Date.now());
      if(!countdownInterval){
        countdownInterval=setInterval(function(){
          if(!(playing && sleepDeadline>0)){ stopCountdownDisplay(); return; }
          timerCountdown.textContent=formatClock(sleepDeadline - Date.now());
        }, 500);
      }
    } else {
      // Always visible when Off, show 00:00:00
      stopCountdownDisplay();
    }
  }
  function clearSleepTimer(){ if(sleepTimeout){ try{clearTimeout(sleepTimeout)}catch(e){} sleepTimeout=null; } sleepDeadline=0; stopCountdownDisplay(); clearFadeSchedule(); }
  function getSelectedTimerMs(){
    if(!sleepTimerSel) return 0;
    var v=sleepTimerSel.value||'';
    if(!v) return 0;
    if(v==='custom'){
      var h = timerHrs? parseInt(timerHrs.value||'0',10) : 0;
      var m = timerMin? parseInt(timerMin.value||'0',10) : 0;
      if(isNaN(h)) h=0; if(isNaN(m)) m=0;
      h = Math.max(0, Math.min(23, h));
      m = Math.max(0, Math.min(59, m));
      return ((h*60)+m)*60*1000;
    }
    return parseDurationMs(v);
  }
  function updateTimerPreview(){
    if(!timerCountdown) return;
    var ms=getSelectedTimerMs();
    if(ms>0){ timerCountdown.hidden=false; timerCountdown.textContent=formatClock(ms); }
    else { timerCountdown.hidden=true; }
  }
  function scheduleSleepTimerFromUI(){
    clearSleepTimer();
    var ms=getSelectedTimerMs();
    if(ms>0){
      sleepDeadline=Date.now()+ms;
      sleepTimeout=setTimeout(function(){ sleepTimeout=null; sleepDeadline=0; try{stopAllVoices(false)}catch(e){} try{stopBgLoop()}catch(e){} resetTimerUI(); restoreMasterVolume(); }, ms);
      var fadeSec=Math.min(15, ms/1000);
      var pre=Math.max(0, ms - Math.floor(fadeSec*1000));
      preFadeTimeout=setTimeout(function(){ startVolumeFade(fadeSec); }, pre);
      ensureCountdownRunning();
    } else { stopCountdownDisplay(); }
  }
  function resetTimerUI(){
    try{
      if(sleepTimerSel){ sleepTimerSel.value=''; }
      if(timerHrs){ timerHrs.value='0'; }
      if(timerMin){ timerMin.value='0'; }
      applyTimerCustomState();
      stopCountdownDisplay();
    }catch(e){}
  }

  function normalizeItems(data){
    return (data||[]).map(function(x){
      var y=Object.assign({},x);
      y.category= y.category || 'General';
      y.tags= Array.isArray(y.tags)? y.tags.slice(0,6) : [];
      y.description = y.description || '';
      y.id = itemId(y);
      return y;
    });
  }

  function dedup(items){
    var seen=new Set();
    var out=[];
    items.forEach(function(x){
      var id=itemId(x);
      if(!seen.has(id)){ seen.add(id); out.push(x); }
    });
    return out;
  }

  function buildCategories(items){
    if(!categorySel) return;
    var set=new Set();
    items.forEach(function(x){ set.add(String(x.category||'General')); });
    var cats=Array.from(set).sort();
    var frag=document.createDocumentFragment();
    var allOpt=document.createElement('option');
    allOpt.value=''; allOpt.textContent='All categories';
    frag.appendChild(allOpt);
    cats.forEach(function(c){
      var o=document.createElement('option');
      o.value=c; o.textContent=c; frag.appendChild(o);
    });
    categorySel.replaceChildren(frag);
  }

  function stopBgLoop(){
    try{
      if(!audioCtx) return;
      var now=audioCtx.currentTime;
      if(bgGain){
        bgGain.gain.cancelScheduledValues(now);
        bgGain.gain.setTargetAtTime(0, now, 0.03);
      }
      if(bgSource){ try{ bgSource.stop(now + 0.05); }catch(e){} try{ bgSource.disconnect(); }catch(e){} }
      if(bgMediaSource){ try{ bgMediaSource.disconnect(); }catch(e){} }
      if(bgAudio){ try{ bgAudio.pause(); }catch(e){} try{ bgAudio.currentTime=0; }catch(e){} }
    }finally{
      bgSource=null;
      bgMediaSource=null;
      if(!playing){ stopKeepAlive(); }
    }
  }

  function loadBgBuffer(id){
    if(!id) return Promise.reject(new Error('no-id'));
    if(bgBuffers[id]) return Promise.resolve(bgBuffers[id]);
    return fetch('audio/'+id).then(function(r){ return r.arrayBuffer(); }).then(function(ab){
      ensureAudio();
      return new Promise(function(resolve,reject){
        audioCtx.decodeAudioData(ab, function(buf){ bgBuffers[id]=buf; resolve(buf); }, function(err){ reject(err); });
      });
    });
  }

  function computeLoopPoints(buffer){
    try{
      var sr=buffer.sampleRate, ch=buffer.numberOfChannels, len=buffer.length;
      var start=0, end=len-1; var thresh=1e-3;
      var maxScan=Math.min(len-1, Math.floor(sr*2));
      
      var sFound=false;
      for(var i=0;i<maxScan;i++){
        var above=false;
        for(var c=0;c<ch;c++){
          var d=buffer.getChannelData(c);
          if(Math.abs(d[i])>thresh){ above=true; break; }
        }
        if(above){ start=i; sFound=true; break; }
      }
      if(!sFound) start=0;
      
      var eFound=false;
      var minEnd=Math.max(start+1, len-1 - maxScan);
      for(var j=len-1;j>=minEnd;j--){
        var aboveE=false;
        for(var c2=0;c2<ch;c2++){
          var d2=buffer.getChannelData(c2);
          if(Math.abs(d2[j])>thresh){ aboveE=true; break; }
        }
        if(aboveE){ end=j; eFound=true; break; }
      }
      if(!eFound) end=len-1;
      
      var margin=Math.floor(sr*0.002);
      start=Math.max(0, start - margin);
      end=Math.min(len, end + margin);
      if(end <= start+10){ start=0; end=len; }

      var win=Math.floor(sr*0.01);
      var s0=Math.max(1, start - win), s1=Math.min(len-2, start + win);
      var bestS=start, bestSA=1;
      for(var si=s0; si<=s1; si++){
        var acc=0;
        for(var c3=0;c3<ch;c3++){ acc+=Math.abs(buffer.getChannelData(c3)[si]); }
        acc/=Math.max(1,ch);
        if(acc<bestSA){ bestSA=acc; bestS=si; if(acc===0) break; }
      }
      start=bestS;
      var e0=Math.max(start+1, end - win), e1=Math.min(len-2, end + win);
      var bestE=end, bestEA=1;
      for(var ei=e0; ei<=e1; ei++){
        var acc2=0;
        for(var c4=0;c4<ch;c4++){ acc2+=Math.abs(buffer.getChannelData(c4)[ei]); }
        acc2/=Math.max(1,ch);
        if(acc2<bestEA){ bestEA=acc2; bestE=ei; if(acc2===0) break; }
      }
      end=bestE;
      return {start:start/sr, end:end/sr};
    }catch(e){
      return {start:0, end:buffer.duration};
    }
  }

  function startBgLoop(id){
    stopBgLoop();
    if(!id){ return; }
    try{ lastBgId=id; }catch(e){}
    ensureAudio();
    if(audioCtx && audioCtx.state==='suspended'){
      try{ audioCtx.resume(); }catch(e){}
    }
    startOutputIfNeeded();
    startKeepAlive();
    clearPostStopSchedule();
    loadBgBuffer(id).then(function(buffer){
      var points=computeLoopPoints(buffer);
      var now=audioCtx.currentTime;
      var src=audioCtx.createBufferSource();
      src.buffer=buffer;
      src.loop=true;
      src.loopStart=points.start;
      src.loopEnd=points.end;
      src.connect(bgGain);
      bgSource=src;
      // gentle fade-in to avoid clicks
      bgGain.gain.cancelScheduledValues(now);
      bgGain.gain.setValueAtTime(Math.max(0,bgGain.gain.value), now);
      bgGain.gain.setTargetAtTime(bgVolumeVal, now, 0.05);
      src.start(now);
    }).catch(function(){
      try{
        var srcUrl='audio/'+id;
        bgAudio=new Audio(srcUrl);
        bgAudio.crossOrigin='anonymous';
        bgAudio.loop=true;
        // route element through WebAudio for unified fading
        bgMediaSource=audioCtx.createMediaElementSource(bgAudio);
        bgMediaSource.connect(bgGain);
        // fade-in via bgGain already scheduled by startBgLoop
        var now=audioCtx.currentTime;
        bgGain.gain.cancelScheduledValues(now);
        bgGain.gain.setValueAtTime(Math.max(0,bgGain.gain.value), now);
        bgGain.gain.setTargetAtTime(bgVolumeVal, now, 0.05);
        bgAudio.play().catch(function(){});
      }catch(e){}
    });
  }

  function initBgLoopOptions(){
    if(!bgLoopSelect) return;
    var options=[
      {value:'', label:'No background'},
      {value:'ambientalsynth.mp3', label:'Ambiental synth'},
      {value:'birds.mp3', label:'Birds'},
      {value:'rain_forest.mp3', label:'Rain forest'},
      {value:'galactic_waves.mp3', label:'Galactic waves'},
      {value:'white_noise.mp3', label:'White noise'}
    ];
    var frag=document.createDocumentFragment();
    options.forEach(function(opt){
      var o=document.createElement('option');
      o.value=opt.value;
      o.textContent=opt.label;
      frag.appendChild(o);
    });
    bgLoopSelect.replaceChildren(frag);
  }

  function startTone(f){
    ensureAudio();
    if(audioCtx && audioCtx.state==='suspended'){
      try{audioCtx.resume()}catch(e){}
    }
    startOutputIfNeeded();
    clearPostStopSchedule();
    stopAllVoices(true);
    startMulti([{id:'custom|'+f,name:'Custom',frequency:f}],5.0);
  }

  function stopTone(silent, fadeSec){ stopAllVoices(silent, fadeSec); }

  function createPanner(pan){
    if(!audioCtx) ensureAudio();
    if(audioCtx.createStereoPanner){
      var sp=audioCtx.createStereoPanner();
      sp.pan.setValueAtTime(pan,audioCtx.currentTime);
      return sp;
    }
    var p=audioCtx.createPanner();
    p.panningModel='equalpower';
    var x=pan; var z=1-Math.abs(pan);
    if(p.positionX){
      p.positionX.setValueAtTime(x,audioCtx.currentTime);
      p.positionY.setValueAtTime(0,audioCtx.currentTime);
      p.positionZ.setValueAtTime(z,audioCtx.currentTime);
    } else if(p.setPosition){
      try{ p.setPosition(x,0,z); }catch(e){}
    }
    return p;
  }

  function startMulti(items, rampIn){
    ensureAudio();
    if(audioCtx && audioCtx.state==='suspended'){
      try{audioCtx.resume()}catch(e){}
    }
    startOutputIfNeeded();
    startKeepAlive();
    clearPostStopSchedule();
    try{ lastPlayItems = items.slice(); lastRampIn = (typeof rampIn==='number'? rampIn:5.0); }catch(e){}
    voices.forEach(function(v){ try{v.osc.stop()}catch(e){} try{v.osc.disconnect()}catch(e){} });
    voices.length=0;
    var n=items.length;
    var perGain = 1/Math.max(1,Math.sqrt(n));
    var now=audioCtx.currentTime;
    var rin = (typeof rampIn==='number')?rampIn:5.0;
    // ramp master to volume
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0,now);
    gain.gain.linearRampToValueAtTime(volumeVal, now+rin);
    items.forEach(function(x,idx){
      var osc=audioCtx.createOscillator();
      osc.type='sine';
      osc.frequency.setValueAtTime(Number(x.frequency),now);
      var g=audioCtx.createGain();
      g.gain.setValueAtTime(0,now);
      g.gain.linearRampToValueAtTime(perGain, now+rin);
      var panVal = (n===1)?0 : (n===2? (idx===0?-1:1) : (-1 + (2*idx/(n-1))));
      var p=createPanner(panVal);
      osc.connect(g); g.connect(p); p.connect(gain);
      osc.start();
      voices.push({osc:osc,gain:g,panner:p,pan:panVal,meta:x});
    });
    playing = voices.length>0;
    lastPlayActive = playing;
    updateUI();
    // Ensure background FX restarts if selected and not currently active
    try{
      if(bgLoopSelect && bgLoopSelect.value && !isBgActive()){
        startBgLoop(bgLoopSelect.value);
      }
    }catch(e){}
    // Media Session
    try{
      if('mediaSession' in navigator){
        var freqs=items.map(function(x){return Number(x.frequency).toFixed(2)+' Hz'}).join(' · ');
        navigator.mediaSession.metadata=new window.MediaMetadata({title: 'Frequencies', artist: 'FrequencyDoctor', album: 'Tones', artwork: []});
        navigator.mediaSession.playbackState= playing ? 'playing' : 'paused';
        navigator.mediaSession.setActionHandler('play', function(){ if(preferMediaBG()){ hardResetAudioEngine(true); } else { startOutputIfNeeded(); if(audioCtx && audioCtx.state==='suspended'){ audioCtx.resume(); } } });
        navigator.mediaSession.setActionHandler('pause', function(){ stopAllVoices(false); });
        navigator.mediaSession.setActionHandler('stop', function(){ stopAllVoices(false); });
      }
    }catch(e){}
  }

  function stopAllVoices(silent, fadeSec){
    var now=audioCtx?audioCtx.currentTime:0;
    var rout=silent?0: (typeof fadeSec==='number'? fadeSec : 15.0);
    // ramp master to 0 and stop all
    if(gain && audioCtx){
      var v=gain.gain.value;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(v,now);
      gain.gain.linearRampToValueAtTime(0, now+rout);
    }
    var copy=voices.slice();
    voices.length=0;
    copy.forEach(function(v){
      try{ v.osc.stop(now + rout + 0.001); }catch(e){}
      try{ v.osc.disconnect(); }catch(e){}
    });
    playing=false; lastPlayActive=false;
    updateUI();
    clearSleepTimer();
    clearPostStopSchedule();
    if(!silent){
      try{
        var delay=Math.ceil(rout*1000)+60;
        postStopTimeout = setTimeout(function(){ try{stopBgLoop()}catch(e){} restoreMasterVolume(); }, delay);
      }catch(e){}
    }
  }

  function updateUI(){
    var f=Number(freqInput.value)||0;
    if(voices.length>1){
      var freqs=voices.map(function(v){return fmtHz(v.meta.frequency)});
      nowPlaying.textContent='Playing '+freqs.join(' · ');
    }else if(voices.length===1){
      nowPlaying.textContent='Playing '+fmtHz(voices[0].meta.frequency);
    }else{
      nowPlaying.textContent='Idle';
    }
    playBtn.disabled=playing;
    stopBtn.disabled=!playing;
    updateSelUI();
  }

  playBtn.addEventListener('click',function(){
    var f=clamp(Number(freqInput.value)||0,0.1,20000);
    freqInput.value=String(f);
    startOutputIfNeeded();
    startTone(f);
    scheduleSleepTimerFromUI();
  });
  stopBtn.addEventListener('click',function(){ stopTone(false, 3.0); clearSleepTimer(); resetTimerUI(); });
  vol.addEventListener('input',function(){
    volumeVal=Number(vol.value)/100;
    if(gain && audioCtx){
      var now=audioCtx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(volumeVal,now,0.02);
    }
  });
  function initTimerHMS(){
    if(timerHrs && timerHrs.options.length===0){
      var f=document.createDocumentFragment();
      for(var h=0; h<=23; h++){
        var o=document.createElement('option'); o.value=String(h); o.textContent=(h<10?'0':'')+h; f.appendChild(o);
      }
      timerHrs.appendChild(f);
    }
    if(timerMin && timerMin.options.length===0){
      var f2=document.createDocumentFragment();
      for(var m=0; m<=59; m++){
        var o2=document.createElement('option'); o2.value=String(m); o2.textContent=(m<10?'0':'')+m; f2.appendChild(o2);
      }
      timerMin.appendChild(f2);
    }
  }
  function applyTimerCustomState(){
    var v = (sleepTimerSel && sleepTimerSel.value) || '';
    var custom = v==='custom';
    if(timerCustomWrap){ timerCustomWrap.hidden = false; }
    if(timerHrs){ timerHrs.disabled = !custom; }
    if(timerMin){ timerMin.disabled = !custom; }
    if(timerCountdown){ try{ timerCountdown.classList.toggle('disabled', (!custom)); }catch(e){} }
  }
  if(sleepTimerSel){
    sleepTimerSel.addEventListener('change', function(){
      applyTimerCustomState();
      if(sleepTimerSel.value==='custom'){
        initTimerHMS(); if(timerHrs && timerHrs.value===''){ timerHrs.value='0'; } if(timerMin && timerMin.value===''){ timerMin.value='30'; }
      }
      updateTimerPreview();
      if(playing){ scheduleSleepTimerFromUI(); }
    });
    // initialize state on load
    applyTimerCustomState();
    stopCountdownDisplay();
  }
  // Ensure H/M are populated at load
  initTimerHMS();
  if(timerHrs){ timerHrs.addEventListener('change', function(){ updateTimerPreview(); if(playing && sleepTimerSel && sleepTimerSel.value==='custom'){ scheduleSleepTimerFromUI(); } }); }
  if(timerMin){ timerMin.addEventListener('change', function(){ updateTimerPreview(); if(playing && sleepTimerSel && sleepTimerSel.value==='custom'){ scheduleSleepTimerFromUI(); } }); }
  if(bgLoopVolume){
    bgLoopVolume.addEventListener('input',function(){
      bgVolumeVal=Number(bgLoopVolume.value)/100;
      if(bgGain && audioCtx){
        var now=audioCtx.currentTime;
        bgGain.gain.cancelScheduledValues(now);
        bgGain.gain.setTargetAtTime(bgVolumeVal, now, 0.03);
      }
    });
  }
  freqInput.addEventListener('input',function(){
    if(playing && osc && audioCtx){
      var f=clamp(Number(freqInput.value)||0,0.1,20000);
      osc.frequency.setTargetAtTime(f,audioCtx.currentTime,0.02);
      nowPlaying.textContent='Playing '+fmtHz(f);
    }
  });
  // Auto-select text on focus for quick overwrite
  function autoSelect(el){
    if(!el) return;
    el.addEventListener('focus',function(){
      try{ el.select(); }catch(e){}
      try{ setTimeout(function(){ el.setSelectionRange(0, 99999); }, 0); }catch(e){}
    });
  }
  autoSelect(freqInput);
  autoSelect(search);

  if(playSelectedBtn){
    playSelectedBtn.addEventListener('click',function(){
      var items=DATA.filter(function(x){return selected.has(x.id)});
      if(items.length){ startOutputIfNeeded(); startMulti(items,5.0); scheduleSleepTimerFromUI(); }
    });
  }
  if(settingsBtn){ settingsBtn.addEventListener('click',openSettings); }
  if(settingsClose){ settingsClose.addEventListener('click',closeSettings); }
  if(settingsCancel){ settingsCancel.addEventListener('click',closeSettings); }
  if(settingsModal){
    settingsModal.addEventListener('click',function(ev){
      var t=ev.target; if(t && t.getAttribute && t.getAttribute('data-close')) closeSettings();
    });
  }
  if(settingsSave){
    settingsSave.addEventListener('click',function(){
      var t=(themeLight && themeLight.checked)?'light':'dark';
      applyTheme(t); saveTheme(t); closeSettings();
    });
  }
  if(resetAudioBtn){
    resetAudioBtn.addEventListener('click', function(){ try{ hardResetAudioEngine(true); }catch(e){} closeSettings(); });
  }
  document.addEventListener('keydown',function(ev){ if(ev.key==='Escape') closeSettings(); });

  // Help modal wiring
  if(helpBtn){ helpBtn.addEventListener('click', openHelp); }
  if(helpClose){ helpClose.addEventListener('click', closeHelp); }
  if(helpCloseBtn){ helpCloseBtn.addEventListener('click', closeHelp); }
  if(helpModal){
    helpModal.addEventListener('click', function(ev){ var t=ev.target; if(t && t.getAttribute && t.getAttribute('data-close')) closeHelp(); });
  }
  document.addEventListener('keydown',function(ev){ if(ev.key==='Escape') closeHelp(); });

  // Lifecycle guards: reassert playback on visibility/page changes (iOS PWA)
  try{
    document.addEventListener('visibilitychange', function(){ if(preferMediaBG()){ ensureAudio(); recoverAudioGraph(); ensureOutputPlaying(); startKeepAlive(); } });
    window.addEventListener('pageshow', function(){ if(preferMediaBG()){ ensureAudio(); recoverAudioGraph(); ensureOutputPlaying(); startKeepAlive(); } });
    window.addEventListener('pagehide', function(){ if(preferMediaBG()){ ensureAudio(); recoverAudioGraph(); ensureOutputPlaying(); startKeepAlive(); } });
  }catch(e){}

  // One-time audio unlock for stricter browsers (iOS Safari, etc.)
  (function(){
    var unlocked=false;
    function unlock(){
      if(unlocked) return; unlocked=true;
      try{ ensureAudio(); if(audioCtx && audioCtx.state==='suspended'){ audioCtx.resume(); } recoverAudioGraph(); startOutputIfNeeded(); }catch(e){}
      try{ document.removeEventListener('pointerdown',unlock); document.removeEventListener('keydown',unlock); document.removeEventListener('touchstart',unlock); }catch(e){}
    }
    try{
      document.addEventListener('pointerdown',unlock,{passive:true});
      document.addEventListener('touchstart',unlock,{passive:true});
      document.addEventListener('keydown',unlock);
    }catch(e){}
  })();

  function attachAudioOutHandlers(){
    try{
      if(!audioOut) return;
      ['pause','stalled','waiting','error','emptied'].forEach(function(ev){
        try{ audioOut.addEventListener(ev, function(){ if(preferMediaBG()){ hardResetAudioEngine(true); } }, {passive:true}); }catch(e){}
      });
    }catch(e){}
  }
  // audioOut error recovery
  attachAudioOutHandlers();

  if(clearSelectedBtn){
    clearSelectedBtn.addEventListener('click',function(){
      selected.clear();
      var picks=listEl.querySelectorAll('.pick');
      picks.forEach(function(p){ p.checked=false; });
      stopAllVoices(true);
      updateSelUI();
    });
  }

  if(bgLoopSelect){
    initBgLoopOptions();
    bgLoopSelect.addEventListener('change',function(){
      startBgLoop(bgLoopSelect.value);
    });
  }

  function renderList(filter){
    var q=(filter||'').trim().toLowerCase();
    var items=DATA.slice().sort(function(a,b){
      return a.name.localeCompare(b.name);
    });
    if(q){
      items=items.filter(function(x){
        var hay=[
          String(x.name||'').toLowerCase(),
          String(x.frequency),
          String(x.category||'').toLowerCase(),
          String(x.description||'').toLowerCase(),
          (Array.isArray(x.tags)?x.tags.join(' '):'').toLowerCase()
        ].join(' ');
        return hay.includes(q);
      });
    }
    if(categorySel && categorySel.value){
      var cv=categorySel.value.toLowerCase();
      items=items.filter(function(x){return String(x.category||'').toLowerCase()===cv});
    }
    if(onlyFavs && onlyFavs.checked){
      items=items.filter(function(x){return favs.has(x.id)});
    }
    var byLetter={};
    items.forEach(function(x){
      var k=(x.name[0]||'#').toUpperCase();
      if(!byLetter[k])byLetter[k]=[];
      byLetter[k].push(x);
    });
    var letters=Object.keys(byLetter).sort();
    var frag=document.createDocumentFragment();
    if(letters.length===0){
      var empty=document.createElement('div');
      empty.className='section';
      empty.innerHTML='<div class="items"><div class="item"><span class="name">No results</span><span class="hz"></span></div></div>';
      frag.appendChild(empty);
    } else {
      letters.forEach(function(L){
        var sec=document.createElement('div');
        sec.className='section';
        var head=document.createElement('div');
        head.className='section-head';
        head.textContent=L;
        sec.appendChild(head);
        var wrap=document.createElement('div');
        wrap.className='items';
        byLetter[L].forEach(function(x){
          var it=document.createElement('div');
          it.className='item';
          it.setAttribute('role','button');
          it.tabIndex=0;

          var left=document.createElement('div');
          left.className='left';

          var pick=document.createElement('input');
          pick.type='checkbox';
          pick.className='pick';
          pick.checked=selected.has(x.id);
          pick.addEventListener('click',function(ev){ev.stopPropagation()});
          pick.addEventListener('change',function(ev){
            if(ev.target.checked) selected.add(x.id); else selected.delete(x.id);
            updateSelUI();
          });

          var isFav=favs.has(x.id);
          var star=document.createElement('button');
          star.className='star'+(isFav?' active':'');
          star.type='button';
          star.setAttribute('aria-label','Favorite');
          star.textContent='★';
          star.addEventListener('click',function(ev){
            ev.stopPropagation();
            if(favs.has(x.id)) favs.delete(x.id); else favs.add(x.id);
            saveFavs(favs);
            renderList(search.value);
          });

          var text=document.createElement('div');
          text.className='text';
          var name=document.createElement('div');
          name.className='name';
          name.textContent=x.name;
          text.appendChild(name);
          if(x.description){
            var desc=document.createElement('div');
            desc.className='desc';
            desc.textContent=x.description;
            text.appendChild(desc);
          }
          if(Array.isArray(x.tags) && x.tags.length){
            var tags=document.createElement('div');
            tags.className='tags';
            x.tags.forEach(function(t){
              var tg=document.createElement('span');
              tg.className='tag';
              tg.textContent=t;
              tags.appendChild(tg);
            });
            text.appendChild(tags);
          }
          left.appendChild(pick);
          left.appendChild(star);
          left.appendChild(text);

          var hz=document.createElement('span');
          hz.className='hz';
          hz.textContent=fmtHz(x.frequency);

          it.appendChild(left);
          it.appendChild(hz);
          it.addEventListener('click',function(ev){
            if(hasSelection()) return;
            freqInput.value=String(x.frequency);
            startTone(Number(x.frequency));
          });
          it.addEventListener('keydown',function(ev){
            if(ev.key==='Enter' || ev.key===' '){
              ev.preventDefault();
              freqInput.value=String(x.frequency);
              startTone(Number(x.frequency));
            }
          });
          wrap.appendChild(it);
        });
        sec.appendChild(wrap);
        frag.appendChild(sec);
      });
    }
    listEl.replaceChildren(frag);
  }

  search.addEventListener('input',function(){renderList(search.value); updateSearchClear();});
  if(searchClear){ searchClear.addEventListener('click', function(){ search.value=''; renderList(''); updateSearchClear(); try{search.focus()}catch(e){} }); }
  if(categorySel){categorySel.addEventListener('change',function(){renderList(search.value)})}
  if(onlyFavs){onlyFavs.addEventListener('change',function(){renderList(search.value)})}

  if('serviceWorker' in navigator){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('sw.js').then(function(reg){
        function skip(sw){ try{ sw.postMessage({type:'SKIP_WAITING'}); }catch(e){} }
        if(reg.waiting){ skip(reg.waiting); }
        reg.addEventListener('updatefound', function(){
          var nw=reg.installing;
          if(!nw) return;
          nw.addEventListener('statechange', function(){
            if(nw.state==='installed' && navigator.serviceWorker.controller){ skip(nw); }
          });
        });
        navigator.serviceWorker.addEventListener('controllerchange', function(){
          try{ window.location.reload(); }catch(e){}
        });
      }).catch(function(){});
    });
  }
  // Attempt resume on visibility change (iOS may suspend on background)
  document.addEventListener('visibilitychange', function(){
    try{ if(audioCtx && audioCtx.state==='suspended'){ audioCtx.resume(); } }catch(e){}
    startOutputIfNeeded();
  });

  // Apply theme on startup
  applyTheme(loadTheme());
  DATA = dedup(normalizeItems(window.FREQUENCY_DATA||[]));
  buildCategories(DATA);
  renderList('');
  updateUI();
  updateSearchClear();
})();
