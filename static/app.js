"use strict";
var $=function(id){return document.getElementById(id);},historyData=[],minutes=5,busy=false;
function put(id,text){if($(id).textContent!==text){$(id).textContent=text;}}
function num(v,n,u){return typeof v==="number"&&isFinite(v)?v.toFixed(n)+(u||""):"--";}
function rows(id,items){
  var box=$(id);box.textContent="";
  items.forEach(function(item){var r=document.createElement("div"),k=document.createElement("span"),v=document.createElement("b");
    r.className="row";k.textContent=item[0];v.textContent=item[1];r.appendChild(k);
    if(typeof item[2]==="number"){var bar=document.createElement("progress");bar.max=100;bar.value=item[2];r.appendChild(bar);}
    r.appendChild(v);if(item[3]){var free=document.createElement("small");free.textContent=item[3];r.appendChild(free);}box.appendChild(r);
  });
}
function chart(id,series,seconds,ceiling,grid){
  if(!$(id).clientWidth){return;}
  var el=$(id),w=el.clientWidth,h=el.clientHeight,d=Math.min(2,window.devicePixelRatio||1);
  if(!w||!h){return;}if(el.width!==Math.round(w*d)||el.height!==Math.round(h*d)){el.width=Math.round(w*d);el.height=Math.round(h*d);}
  var c=el.getContext("2d");c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,w,h);
  var now=Date.now()/1000,recent=historyData.filter(function(p){return p.t>=now-seconds;});
  var left=grid?33:0,top=grid?8:2,bottom=grid?h-15:h-2,scale=ceiling||1;
  if(!ceiling){recent.forEach(function(p){series.forEach(function(s){scale=Math.max(scale,(p[s[0]]||0)*1.12);});});}
  // Expand the visible axis as genuine samples arrive; never invent pre-start data.
  var span=recent.length?Math.min(seconds,Math.max(5,now-recent[0].t)):seconds;
  if(grid){c.font="10px Consolas,monospace";c.fillStyle="#a5b8be";
    for(var j=0;j<5;j++){var gy=bottom-(bottom-top)*j/4;c.fillText(j*25+"%",0,gy+2);c.setLineDash([2,4]);c.beginPath();c.moveTo(left,gy);c.lineTo(w,gy);c.strokeStyle="#254047";c.stroke();}
    c.setLineDash([]);for(var tick=0;tick<=5;tick++){var dt=new Date(1000*(now-span+span*tick/5)),stamp=dt.toTimeString().slice(0,span<90?8:5);c.textAlign=tick===5?"right":tick===0?"left":"center";c.fillText(stamp,left+(w-left)*tick/5,h-1);}c.textAlign="left";
  }
  series.forEach(function(s){
    var points=[],last=null;
    function paint(){if(!points.length){return;}c.beginPath();points.forEach(function(pt,i){if(i){c.lineTo(pt[0],pt[1]);}else{c.moveTo(pt[0],pt[1]);}});c.strokeStyle=s[1];c.lineWidth=1.5;c.stroke();
      c.lineTo(points[points.length-1][0],bottom);c.lineTo(points[0][0],bottom);c.closePath();c.fillStyle=s[1];c.globalAlpha=.10;c.fill();c.globalAlpha=1;
      if(points.length<95){points.forEach(function(pt){c.beginPath();c.arc(pt[0],pt[1],1.4,0,2*Math.PI);c.fill();});}points=[];}
    recent.forEach(function(p){if(typeof p[s[0]]!=="number"){paint();last=null;return;}if(last!==null&&p.t-last>3){paint();}points.push([w-(now-p.t)*(w-left)/span,bottom-p[s[0]]/scale*(bottom-top)]);last=p.t;});paint();
  });
}
function plots(){chart("cpuPlot",[["cpu","#53dbc8"]],60,100);chart("gpuPlot",[["gpu","#c28be4"]],60,100);chart("powerPlot",[["power","#e4b34e"]],60);chart("netPlot",[["down","#63dbce"],["up","#a891e5"]],60);chart("activityPlot",[["cpu","#55dbcb"],["gpu","#c488e3"]],minutes*60,100,true);}
function render(d){
 var c=d.cpu,g=d.gpu,r=d.ram;
 put("cpuName",c.name);put("gpuName",g.name);put("cpuLoad",num(c.load,0,"%"));put("gpuLoad",num(g.load,0,"%"));
 rows("cpuInfo",[["Temp",num(c.temp,0," °C")],["Package",num(c.watts,0," W")],["Clock",num(c.clock,0," MHz")]]);
 rows("gpuInfo",[["Temp",num(g.temp,0," °C")],["Power",num(g.watts,0," W")],["VRAM",num(g.vram_used,1)+" / "+num(g.vram_total,0," GiB")]]);
 put("ram",num(r.used,1)+" / "+num(r.total,1," GiB"));$("ramBar").value=r.percent||0;put("ramSpeed",num(r.percent,0,"%")+"　·　"+num(r.speed_mt_s,0," MT/s"));
 put("power",num(d.watts,0," W"));rows("breakdown",[["CPU",num(c.watts,0," W")],["GPU",num(g.watts,0," W")]]);rows("drives",d.disks.map(function(x){return [x.name,num(x.percent,0,"%"),x.percent,num(x.free_gib,0," GiB free")];}));
 function speed(v){return num(typeof v==="number"?v/1048576:null,2," MiB/s");}
 rows("net",[["↓ Download",speed(d.io.down)],["↑ Upload",speed(d.io.up)]]);
 rows("fans",d.fans.filter(function(f){return f.rpm>0;}).map(function(f){return [f.name,num(f.rpm,0," RPM"),Math.min(100,f.rpm/40)];}));
 rows("temps",[["CPU package",num(c.temp,0," °C"),c.temp],["CPU CCD",num(c.ccd_temp,0," °C"),c.ccd_temp],["GPU core",num(g.temp,0," °C"),g.temp],["GPU hotspot",num(g.hotspot,0," °C"),g.hotspot],["VRAM",num(g.mem_temp,0," °C"),g.mem_temp]]);
 rows("clocks",[["CPU",num(c.clock,0," MHz")],["CPU peak",num(c.max_clock,0," MHz")],["GPU core",num(g.core_clock,0," MHz")],["GPU memory",num(g.mem_clock,0," MHz")]]);
 rows("sys",[["Host",d.host],["Uptime",typeof d.uptime==="number"?Math.floor(d.uptime/3600)+"h "+Math.floor(d.uptime/60)%60+"m":"--"],["Processes",num(d.processes,0)]]);
 put("status",d.mock?"● Mock":"● Live");
 if(!historyData.length||historyData[historyData.length-1].t!==d.timestamp){historyData.push({t:d.timestamp,cpu:c.load,gpu:g.load,power:d.watts,up:d.io.up,down:d.io.down});}
 while(historyData.length&&historyData[0].t<Date.now()/1000-905){historyData.shift();}plots();if(window.panelSample){window.panelSample(d);}
}
function poll(){if(busy||document.hidden){return;}busy=true;var req=new XMLHttpRequest();req.open("GET","/api/stats",true);req.timeout=3000;
 function lost(){put("status","○ Reconnecting");}req.onload=function(){try{if(req.status!==200){throw Error();}render(JSON.parse(req.responseText));}catch(e){lost();}};req.onerror=req.ontimeout=lost;req.onloadend=function(){busy=false;};req.send();}
$("ranges").onclick=function(e){var b=e.target;if(!b.getAttribute("data-min")){return;}minutes=Number(b.getAttribute("data-min"));Array.prototype.forEach.call(this.children,function(x){x.setAttribute("aria-pressed",String(x===b));});plots();};
window.addEventListener("resize",plots);document.addEventListener("visibilitychange",poll);var seed=new XMLHttpRequest();seed.open("GET","/api/history");seed.timeout=2500;seed.onload=function(){if(seed.status===200){historyData=JSON.parse(seed.responseText);}};seed.onloadend=function(){poll();setInterval(poll,1000);};seed.send();
