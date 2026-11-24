(function(){
"use strict";
var state={},pending=false,mediaBusy=false;
function clock(s){return typeof s==="number"&&isFinite(s)?Math.floor(s/60)+":"+("0"+Math.floor(s%60)).slice(-2):"--";}
function display(s){
 window.currentMedia=s;state=s;var c=s.controls||{};
 put("title",s.title||"Waiting for PC playback");put("artist",s.artist||(s.title?"Windows media":"Play audio on your PC"));
 var playing=!!s.playing;document.querySelector(".player").classList.toggle("playing",playing);
 put("play",playing?"Ⅱ":"▶");$("play").setAttribute("aria-label",playing?"Pause":"Play");
 ["prev","next","shuffle","repeat"].forEach(function(k){$(k).disabled=!c[k];});
 $("play").disabled=!c[playing?"pause":"play"];$("seek").disabled=!c.seek||!s.duration;
 if(document.activeElement!==$("seek")){$("seek").value=s.duration?1000*s.position/s.duration:0;}
 put("time",(s.duration?clock(s.position)+" / "+clock(s.duration):"—"));
 $("volume").disabled=$("mute").disabled=typeof s.volume!=="number";
 if(document.activeElement!==$("volume")){$("volume").value=s.volume||0;}
 $("volume").title="PC volume "+(s.volume||0)+"%";$("mute").textContent=s.muted?"×":"◖))";
 ["shuffle","repeat"].forEach(function(k){$(k).setAttribute("aria-pressed",String(!!s[k]));});
 if(window.panelMedia){window.panelMedia(s);}
}
function update(){if(mediaBusy||pending||document.hidden){return;}mediaBusy=true;var r=new XMLHttpRequest();r.open("GET","/api/media");r.timeout=3500;r.onload=function(){if(r.status===200){display(JSON.parse(r.responseText));}};r.onloadend=function(){mediaBusy=false;};r.send();}
function send(action,value){if(pending){return;}pending=true;var r=new XMLHttpRequest();r.open("POST","/api/media");r.setRequestHeader("Content-Type","application/json");r.timeout=4500;r.onloadend=function(){pending=false;if(r.status!==204){put("artist","Control unavailable in this session");}setTimeout(update,450);};r.send(JSON.stringify({action:action,value:value}));}
["shuffle","prev","next","repeat","mute"].forEach(function(k){$(k).onclick=function(){send(k);};});
$("play").onclick=function(){send(state.playing?"pause":"play");};
$("seek").onchange=function(){send("seek",this.value*state.duration/1000);this.blur();};
$("volume").onchange=function(){send("volume",Number(this.value));this.blur();};
display({});update();setInterval(update,1200);
})();

