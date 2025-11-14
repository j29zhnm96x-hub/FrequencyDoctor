(function(){
  var search=document.getElementById('search');
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

  var audioCtx=null,osc=null,gain=null,playing=false, mediaDest=null;
  var volumeVal=Number(vol.value)/100;
  var bgAudio=null; // legacy reference (unused in new loop path)
  var bgGain=null, bgSource=null;
  var bgBuffers=Object.create(null);
  var bgVolumeVal=bgLoopVolume? Number(bgLoopVolume.value)/100 : 0.4;
  var DATA=[];
  var voices=[]; // active voices for multi-play
  var selected=new Set(); // selected item ids

  function itemId(x){
    return x.id || (String(x.name||'').trim()+"|"+String(x.frequency));
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
    if(!audioCtx){
      audioCtx=new (window.AudioContext||window.webkitAudioContext)();
      gain=audioCtx.createGain();
      gain.gain.value=0;
    }
    if(audioCtx && !mediaDest){
      try{
        mediaDest=audioCtx.createMediaStreamDestination();
        if(gain) gain.connect(mediaDest);
        if(audioOut){ audioOut.srcObject=mediaDest.stream; audioOut.crossOrigin='anonymous'; }
      }catch(e){}
    }
    if(audioCtx && !bgGain){
      bgGain=audioCtx.createGain();
      bgGain.gain.value=bgVolumeVal;
      // route background loop into master gain
      if(gain) bgGain.connect(gain);
    }
  }

  function clamp(v,min,max){return Math.min(Math.max(v,min),max)}
  function fmtHz(v){return Number(v).toFixed(2)+" Hz"}
  function startOutputIfNeeded(){
    if(!audioOut) return;
    try{
      var p=audioOut.play();
      if(p && p.catch){ p.catch(function(){}) }
    }catch(e){}
  }
  function hasSelection(){
    try{
      var s=window.getSelection&&window.getSelection();
      return !!(s && s.toString());
    }catch(e){return false}
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
      if(bgSource){
        try{ bgSource.stop(now + 0.05); }catch(e){}
        try{ bgSource.disconnect(); }catch(e){}
      }
    }finally{
      bgSource=null;
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
    ensureAudio();
    if(audioCtx && audioCtx.state==='suspended'){
      try{ audioCtx.resume(); }catch(e){}
    }
    startOutputIfNeeded();
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
    }).catch(function(){});
  }

  function initBgLoopOptions(){
    if(!bgLoopSelect) return;
    var options=[
      {value:'', label:'No background'},
      {value:'ambientalsynth.mp3', label:'Ambiental synth'},
      {value:'birds.mp3', label:'Birds'},
      {value:'rain_forest.mp3', label:'Rain forest'}
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
    stopAllVoices(true);
    startMulti([{id:'custom|'+f,name:'Custom',frequency:f}],0);
  }

  function stopTone(silent){ stopAllVoices(silent); }

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
    voices.forEach(function(v){ try{v.osc.stop()}catch(e){} try{v.osc.disconnect()}catch(e){} });
    voices.length=0;
    var n=items.length;
    var perGain = 1/Math.max(1,Math.sqrt(n));
    var now=audioCtx.currentTime;
    var rin = (typeof rampIn==='number')?rampIn:0.02;
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
    updateUI();
    // Media Session
    try{
      if('mediaSession' in navigator){
        var freqs=items.map(function(x){return Number(x.frequency).toFixed(2)+' Hz'}).join(' · ');
        navigator.mediaSession.metadata=new window.MediaMetadata({title: 'Frequencies', artist: 'FrequencyDoctor', album: 'Tones', artwork: []});
        navigator.mediaSession.playbackState= playing ? 'playing' : 'paused';
        navigator.mediaSession.setActionHandler('play', function(){ startOutputIfNeeded(); if(audioCtx && audioCtx.state==='suspended'){ audioCtx.resume(); }});
        navigator.mediaSession.setActionHandler('pause', function(){ stopAllVoices(false); });
        navigator.mediaSession.setActionHandler('stop', function(){ stopAllVoices(false); });
      }
    }catch(e){}
  }

  function stopAllVoices(silent){
    var now=audioCtx?audioCtx.currentTime:0;
    var rout=silent?0:0.05;
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
    playing=false;
    updateUI();
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
  });
  stopBtn.addEventListener('click',function(){stopTone(false)});
  vol.addEventListener('input',function(){
    volumeVal=Number(vol.value)/100;
    if(gain && audioCtx){
      var now=audioCtx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(volumeVal,now,0.02);
    }
  });
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
      if(items.length){ startOutputIfNeeded(); startMulti(items,0.02); }
    });
  }
  if(clearSelectedBtn){
    clearSelectedBtn.addEventListener('click',function(){
      selected.clear();
      updateSelUI();
      renderList(search.value);
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
  document.addEventListener('keydown',function(ev){ if(ev.key==='Escape') closeSettings(); });

  // Help modal wiring
  if(helpBtn){ helpBtn.addEventListener('click', openHelp); }
  if(helpClose){ helpClose.addEventListener('click', closeHelp); }
  if(helpCloseBtn){ helpCloseBtn.addEventListener('click', closeHelp); }
  if(helpModal){
    helpModal.addEventListener('click', function(ev){ var t=ev.target; if(t && t.getAttribute && t.getAttribute('data-close')) closeHelp(); });
  }
  document.addEventListener('keydown',function(ev){ if(ev.key==='Escape') closeHelp(); });

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

  search.addEventListener('input',function(){renderList(search.value)});
  if(categorySel){categorySel.addEventListener('change',function(){renderList(search.value)})}
  if(onlyFavs){onlyFavs.addEventListener('change',function(){renderList(search.value)})}

  if('serviceWorker' in navigator){
    window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){})});
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
})();
