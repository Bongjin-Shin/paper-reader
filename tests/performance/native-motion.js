// Runs inside the real Tauri/WebKitGTK release app, against isolated SQLite data.
// The external driver supplies native X11 wheel events when an input message arrives.
(() => {
  const send = value => window.webkit.messageHandlers.readerProfile.postMessage(JSON.stringify(value));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async predicate => {
    const start = performance.now();
    while (!predicate()) {
      if (performance.now() - start > 20000) throw new Error('Timed out: ' + predicate);
      await wait(25);
    }
  };
  window.__readerProfile = { active: false, counts: {}, spans: {},
    hit(name) { if (this.active) this.counts[name] = (this.counts[name] || 0) + 1; },
    span(name, ms) { if(this.active) (this.spans[name] ??= []).push(ms); } };
  const measure = (name, run) => { const start=performance.now(); try { return run(); } finally {
    const ms=performance.now()-start; if(ms>=1)window.__readerProfile.span(name,ms);
  } };
  for(const name of ['offsetTop','offsetLeft','offsetWidth','offsetHeight']) {
    const descriptor=Object.getOwnPropertyDescriptor(HTMLElement.prototype,name);
    Object.defineProperty(HTMLElement.prototype,name,{...descriptor,get(){return measure('layoutRead',()=>descriptor.get.call(this));}});
  }
  const rect=Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect=function(){return measure('layoutRead',()=>rect.call(this));};
  (async () => {
    await until(() => [...document.querySelectorAll('button')].find(el => el.textContent === 'Library'));
    [...document.querySelectorAll('button')].find(el => el.textContent === 'Library').click();
    await until(() => document.querySelector('.library-open-paper'));
    [...document.querySelectorAll('.library-open-paper')].find(el => el.textContent === 'motion-qa').click();
    const ready = () => document.querySelector('.pdf-page')?.dataset.renderedScale === '1.25';
    await until(ready); await wait(500);
    const host = document.querySelector('.reader');
    const pages = [...document.querySelectorAll('.pdf-page')];
    for (const scenario of ['warm-scroll', 'cold-scroll', 'zoom']) {
      if (scenario === 'warm-scroll') {
        host.scrollTop = pages[2].offsetTop; await wait(700); host.scrollTop = 0; await wait(700);
      } else if (scenario === 'cold-scroll') {
        host.scrollTop = pages[8].offsetTop; await wait(700);
      } else { host.scrollTop = 0; await until(ready); await wait(700); }
      let running = true, last = performance.now(), lastInput = 0, inputs = 0;
      const frames = [], processing = [], wheels = [], topBefore = host.scrollTop;
      const profile = window.__readerProfile; profile.counts = {}; profile.spans = {}; profile.active = true;
      const wheel = e => { inputs++; lastInput = performance.now(); wheels.push([e.deltaY,e.deltaMode,e.ctrlKey]); if (e.timeStamp <= lastInput && lastInput-e.timeStamp < 5000) processing.push(lastInput-e.timeStamp); };
      host.addEventListener('wheel', wheel, { passive: true });
      const tick = now => { frames.push(now-last); last=now; if(running)requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      send({ kind:'input', scenario });
      await until(() => inputs >= (scenario === 'zoom' ? 20 : 40));
      const received = performance.now();
      if (scenario === 'zoom') await until(() => {
        const first = pages[0];
        return Number(first.dataset.renderedScale) === Number(document.querySelector('.reader').dataset.displayScale || getComputedStyle(first).getPropertyValue('--scale-factor'));
      });
      await wait(250);
      running = false; profile.active = false; host.removeEventListener('wheel', wheel);
      frames.sort((a,b)=>a-b); processing.sort((a,b)=>a-b);
      send({ kind:'sample', scenario, counts:profile.counts, spans:profile.spans, wheels, frames:frames.length,
        frameP95Ms:frames[Math.floor(frames.length*.95)], maxFrameMs:Math.max(...frames),
        framesOver25:frames.filter(t=>t>25).length, inputDelayP95Ms:processing[Math.floor(processing.length*.95)],
        readyTailMs:performance.now()-received-250, inputs, topBefore, topAfter:host.scrollTop,
        scale:document.querySelector('.zoom-controls span')?.textContent, dpr:devicePixelRatio });
      await wait(400);
    }
    // Native regression probe: retain a selected offscreen page and extend the
    // selection through several pages without an API request.
    host.scrollTop=0;
    const textNode = page => [...page.querySelectorAll('.textLayer span')].find(el=>el.firstChild?.nodeType===3 && el.textContent.length>3)?.firstChild;
    await until(()=>textNode(pages[0]));
    const start=textNode(pages[0]), range=document.createRange(); range.setStart(start,0); range.collapse(true);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    start.parentElement.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:300,clientY:150}));
    for(let i=1;i<3;i++) { host.scrollTop=pages[i].offsetTop; await until(()=>textNode(pages[i])); await wait(80); }
    const end=textNode(pages[2]); range.setEnd(end,Math.min(8,end.length));
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:450,clientY:400}));
    await until(()=>document.querySelector('.action-bubble'));
    if(!start.isConnected || window.getSelection().toString().length<=8) throw new Error('Offscreen selection was lost');
    send({kind:'selection-probe', length:window.getSelection().toString().length,
      retainedStart:start.isConnected, bubble:!!document.querySelector('.action-bubble')});
    document.querySelector('[aria-label="말풍선 닫기"]').click(); host.scrollTop=0;
    await until(()=>pages[0].dataset.pageVisible==='true'); await wait(100);
    let point;
    for(const span of pages[0].querySelectorAll('.textLayer span')) {
      const node=span.firstChild, word=span.textContent.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/);
      if(node?.nodeType!==3 || !word || word[0].length<4) continue;
      const range=document.createRange(); range.setStart(node,word.index); range.setEnd(node,word.index+word[0].length);
      const rect=range.getBoundingClientRect();
      if(rect.width>2 && rect.top>100 && rect.bottom<800) { point={x:rect.x+rect.width/2,y:rect.y+rect.height/2}; break; }
    }
    if(!point) throw new Error('No visible native double-click target');
    send({kind:'input',scenario:'doubleclick',...point});
    await until(()=>document.querySelector('.action-bubble'));
    const selected=window.getSelection().toString().trim();
    if(!/^[A-Za-z]+(?:['’\-][A-Za-z]+)*$/.test(selected)) throw new Error('Native double-click did not select a word');
    send({kind:'doubleclick-probe',singleWord:true,bubble:true});
    send({kind:'complete'});
  })().catch(error => send({kind:'error', error:String(error), stack:error.stack}));
})();
