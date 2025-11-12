(function(){
  var search=document.getElementById('search');
  var listEl=document.getElementById('list');
  var freqInput=document.getElementById('freq');
  var playBtn=document.getElementById('play');
  var stopBtn=document.getElementById('stop');
  var vol=document.getElementById('volume');
  var nowPlaying=document.getElementById('now-playing');

  var audioCtx=null,osc=null,gain=null,playing=false;
  var volumeVal=Number(vol.value)/100;

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

  function startTone(f){
    ensureAudio();
    stopTone(true);
    osc=audioCtx.createOscillator();
    osc.type='sine';
    osc.frequency.setValueAtTime(f,audioCtx.currentTime);
    osc.connect(gain);
    var rampIn=0.02;
    var now=audioCtx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0,now);
    gain.gain.linearRampToValueAtTime(volumeVal,now+rampIn);
    osc.start();
    playing=true;
    updateUI();
  }

  function stopTone(silent){
    if(!osc)return;
    var now=audioCtx?audioCtx.currentTime:0;
    var rampOut=silent?0:0.05;
    if(gain&&audioCtx){
      var v=gain.gain.value;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(v,now);
      gain.gain.linearRampToValueAtTime(0,now+rampOut);
    }
    var ref=osc;osc=null;
    setTimeout(function(){
      try{ref.stop()}catch(e){}
      try{ref.disconnect()}catch(e){}
      playing=false;updateUI();
    },(rampOut*1000)+8);
  }

  function updateUI(){
    var f=Number(freqInput.value)||0;
    nowPlaying.textContent=playing?('Playing '+fmtHz(f)):'Idle';
    playBtn.disabled=playing;
    stopBtn.disabled=!playing;
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

  function renderList(filter){
    var q=(filter||'').trim().toLowerCase();
    var items=(window.FREQUENCY_DATA||[]).slice().sort(function(a,b){
      return a.name.localeCompare(b.name);
    });
    if(q){
      items=items.filter(function(x){
        return x.name.toLowerCase().includes(q)||String(x.frequency).includes(q);
      });
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
          var it=document.createElement('button');
          it.className='item';
          it.type='button';
          var name=document.createElement('span');
          name.className='name';
          name.textContent=x.name;
          var hz=document.createElement('span');
          hz.className='hz';
          hz.textContent=fmtHz(x.frequency);
          it.appendChild(name);it.appendChild(hz);
          it.addEventListener('click',function(){
            freqInput.value=String(x.frequency);
            startTone(Number(x.frequency));
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

  if('serviceWorker' in navigator){
    window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){})});
  }

  renderList('');
  updateUI();
})();
