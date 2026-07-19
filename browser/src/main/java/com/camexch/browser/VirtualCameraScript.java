package com.camexch.browser;

final class VirtualCameraScript {
    static final String SCRIPT =
            "(function(){"
                    + "if(window.__camexchInstalled)return;window.__camexchInstalled=true;"
                    + "const src='http://127.0.0.1:8765/frame.jpg';"
                    + "const originalGet=navigator.mediaDevices&&navigator.mediaDevices.getUserMedia?navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices):null;"
                    + "const originalEnum=navigator.mediaDevices&&navigator.mediaDevices.enumerateDevices?navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices):null;"
                    + "function isVirtualRequest(c){"
                    + " if(!c||!c.video)return false;"
                    + " const v=c.video;"
                    + " if(v===true)return false;"
                    + " const fm=v.facingMode;"
                    + " const id=v.deviceId;"
                    + " function hasUser(x){return x==='user'||(x&&x.exact==='user')||(x&&x.ideal==='user')||(Array.isArray(x)&&x.indexOf('user')>=0);}"
                    + " function hasVirtual(x){return x==='camexch-virtual-front'||(x&&x.exact==='camexch-virtual-front')||(x&&x.ideal==='camexch-virtual-front');}"
                    + " return hasUser(fm)||hasVirtual(id);"
                    + "}"
                    + "async function virtualStream(c){"
                    + " const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;"
                    + " const ctx=canvas.getContext('2d');"
                    + " const img=new Image();img.crossOrigin='anonymous';let alive=true;"
                    + " function draw(){try{if(img.complete&&img.naturalWidth){ctx.drawImage(img,0,0,canvas.width,canvas.height);}}catch(e){} if(alive)setTimeout(draw,66);}"
                    + " function refresh(){img.src=src+'?t='+Date.now();if(alive)setTimeout(refresh,66);}"
                    + " refresh();draw();"
                    + " const stream=canvas.captureStream(15);"
                    + " stream.getVideoTracks().forEach(t=>{const stop=t.stop.bind(t);t.stop=function(){alive=false;stop();};});"
                    + " if(c&&c.audio&&originalGet){try{const audio=await originalGet({audio:c.audio,video:false});audio.getAudioTracks().forEach(t=>stream.addTrack(t));}catch(e){}}"
                    + " return stream;"
                    + "}"
                    + "if(navigator.mediaDevices&&originalGet){navigator.mediaDevices.getUserMedia=function(c){return isVirtualRequest(c)?virtualStream(c):originalGet(c);};}"
                    + "if(navigator.mediaDevices&&originalEnum){navigator.mediaDevices.enumerateDevices=async function(){"
                    + " const list=await originalEnum();"
                    + " const virtual={deviceId:'camexch-virtual-front',kind:'videoinput',label:'CamExch Virtual Front Camera',groupId:'camexch'};"
                    + " return [virtual].concat(list);"
                    + "};}"
                    + "})();";

    private VirtualCameraScript() {
    }
}
