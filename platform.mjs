export function setupPlatform({canvas,active,onReturn,onFloat}) {
  const $=id=>document.getElementById(id);
  let installPrompt=null,pip=null,stream=null;
  const status=text=>{$('platformStatus').textContent=text;};
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;status('可以安装到桌面，从固定图标回来。');});
  $('installBtn').addEventListener('click',async()=>{
    if(installPrompt) {await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;}
    else status(matchMedia('(display-mode: standalone)').matches?'你已经在安装版中。':'在浏览器菜单选择「安装应用」或「添加到主屏幕」。Safari 可选择「添加到程序坞」；是否支持取决于浏览器。');
    navigator.storage?.persist?.().catch(()=>{});
  });
  $('updateBtn').addEventListener('click',async()=>{
    if(active()) {status('先结束或保存当前陪伴，再更新。');return;}
    const registration=await navigator.serviceWorker.getRegistration();registration?.waiting?.postMessage('ACTIVATE');
  });
  if('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(async registration=>{
      function waiting(){if(registration.waiting){$('updateBtn').hidden=false;status('新版本已准备好，可以在这次陪伴结束后更新。');}}
      waiting();registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',waiting));
      await navigator.serviceWorker.ready;
      status(registration.waiting?'新版本已准备好，结束陪伴后可更新。':'离线资源已准备好，可以断网后再次打开。');
    }).catch(()=>status('离线资源暂未准备好，请联网后重新打开。'));
    let refreshing=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(!refreshing && !$('updateBtn').hidden){refreshing=true;location.reload();}
    });
  } else status('这个浏览器不支持离线缓存，可继续在线使用。');
  $('windowBtn').addEventListener('click',()=>{
    const url=new URL(location.href);url.searchParams.set('compact','1');
    const child=window.open(url,'foxkin-companion','popup,width=460,height=760');
    if(!child){status('浏览器拦截了小窗，请允许本站打开弹窗。');return;}
    status('独立小窗已打开。已有陪伴请留在原窗口完成；小窗读取同一份本机存档。');
  });
  const pipButton=$('pipBtn');
  pipButton.disabled=!('documentPictureInPicture' in window) || !canvas.captureStream;
  $('pipSupport').textContent=pipButton.disabled?'当前浏览器可用独立小窗；悬浮模式需要支持 Document Picture-in-Picture 的浏览器。':'悬浮小窗会保持在其他窗口上方；关闭小窗不结束陪伴。';
  pipButton.addEventListener('click',async()=>{
    if(pip){pip.close();return;}
    try {
      pip=await window.documentPictureInPicture.requestWindow({width:360,height:420});
      const doc=pip.document;doc.title='狐伴 · 在这里';
      const style=doc.createElement('style');style.textContent='body{margin:0;background:#101830;color:#f3f5ff;font:14px system-ui;text-align:center}video{width:100%;height:290px;object-fit:contain}p{margin:8px}button{font:inherit;color:inherit;background:#293657;border:0;border-radius:12px;padding:9px 12px;margin:4px}button:focus-visible{outline:2px solid #f2a461}';doc.head.append(style);
      const video=doc.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;
      stream=canvas.captureStream(20);video.srcObject=stream;
      const label=doc.createElement('p'),clock=doc.createElement('p'),controls=doc.createElement('div');
      const buttons=[['pauseBtn','暂停／继续'],['endBtn','收工'],['greetBtn','打招呼']];
      for(const [id,text] of buttons){const button=doc.createElement('button');button.textContent=text;button.addEventListener('click',()=>$(id).click());button.dataset.target=id;controls.append(button);}
      const back=doc.createElement('button');back.textContent='回到完整页面';back.addEventListener('click',()=>{window.focus();pip.close();});
      doc.body.append(video,label,clock,controls,back);await video.play();
      const refresh=()=>{
        label.textContent=$('foxName').value;clock.textContent=active()?$('sessionClock').textContent:'我在这里。';
        for(const button of controls.children){const source=$(button.dataset.target);button.hidden=source.hidden || source.closest('[hidden]')!==null;button.disabled=source.disabled;}
        if(!$('closingPanel').hidden || !$('eventPanel').hidden) clock.textContent='回到完整页面，留下这段经历。';
      };
      refresh();const timer=setInterval(refresh,500);
      pip.addEventListener('pagehide',()=>{clearInterval(timer);stream?.getTracks().forEach(track=>track.stop());stream=null;pip=null;pipButton.textContent='悬浮陪伴';onReturn();},{once:true});
      pipButton.textContent='关闭悬浮陪伴';onFloat(pip);status('悬浮陪伴已打开。');
    }catch(error){pip?.close();pip=null;stream?.getTracks().forEach(track=>track.stop());stream=null;status('暂时无法打开悬浮陪伴，可以使用独立小窗。');}
  });
  return {get floating(){return !!pip && !pip.closed;}};
}
