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

  var audioCtx=null,osc=null,gain=null,playing=false;
  var volumeVal=Number(vol.value)/100;
  var DATA=[];
  var voices=[]; // active voices for multi-play
  var selected=new Set(); // selected item ids

  function itemId(x){
    return x.id || (String(x.name||'').trim()+"|"+String(x.frequency));
  }

  function updateSelUI(){
    if(selCountEl){ selCountEl.textContent='Selected: '+selected.size; }
    if(playSelectedBtn){ playSelectedBtn.disabled = selected.size===0; }
  }

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
      gain.connect(audioCtx.destination);
    }
  }

  function clamp(v,min,max){return Math.min(Math.max(v,min),max)}
  function fmtHz(v){return Number(v).toFixed(2)+" Hz"}
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

  function startTone(f){
    ensureAudio();
    if(audioCtx && audioCtx.state==='suspended'){
      try{audioCtx.resume()}catch(e){}
    }
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
      var names=voices.map(function(v){return v.meta&&v.meta.name? v.meta.name : fmtHz(v.meta.frequency)});
      nowPlaying.textContent='Playing '+voices.length+' tones';
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
      if(items.length){ startMulti(items,0.02); }
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

  DATA = dedup(normalizeItems(window.FREQUENCY_DATA||[]));
  buildCategories(DATA);
  renderList('');
  updateUI();
})();
