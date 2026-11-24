/* One detail overlay; the existing player controls move with their event handlers. */
(function(){
"use strict";
var main=document.querySelector("main"),panels=main.querySelectorAll("section"),active="",source,trigger,latest,fan="",cursor=null,coverKey="";
var palette=["#63dfd0","#c691ea","#efbb63","#72b5f4","#d18f9a","#a8cf74"];
var dialog=document.createElement("div");dialog.id="detail";dialog.hidden=true;dialog.setAttribute("role","dialog");dialog.setAttribute("aria-modal","true");dialog.setAttribute("aria-labelledby","detailTitle");
dialog.innerHTML='<header><h1 id="detailTitle"></h1><button id="closeDetail">↙　Back to dashboard</button></header><div class="inside"><div id="mediaSlot"></div><div id="detailRanges"></div><div id="detailValues"></div><div id="fanList"></div><div id="detailCharts"></div></div>';
document.body.appendChild(dialog);
function el(tag,text){var n=document.createElement(tag);n.textContent=text;return n;}
function show(node,on){node.hidden=!on;}
function selectWindow(n){
 minutes=n;
 Array.prototype.forEach.call(document.querySelectorAll("[data-min]"),function(b){b.setAttribute("aria-pressed",String(Number(b.getAttribute("data-min"))===n));});
 plots();cursor=null;refresh();
}
[1,5,15].forEach(function(n){var b=el("button",n+" min");b.setAttribute("data-min",n);b.onclick=function(){selectWindow(n);};$("detailRanges").appendChild(b);});
var player=document.querySelector(".player"),anchor=document.createComment("player");
player.parentNode.insertBefore(anchor,player);
var art=document.createElement("img");art.id="albumArt";art.alt="Album artwork";art.hidden=true;art.onerror=function(){art.hidden=true;};player.querySelector(".record").insertBefore(art,player.querySelector(".disc"));
var extra=el("small","");extra.id="mediaTimes";player.appendChild(extra);
window.panelMedia=function(s){
 if(active!=="player"){return;}
 var url=s.art||"";if(url!==coverKey){coverKey=url;if(url){art.hidden=false;art.src=url;}else{art.hidden=true;art.removeAttribute("src");}}
 $("mediaTimes").textContent="PC volume "+num(s.volume,0,"%")+(s.muted?" · Muted":"")+(s.duration?"　·　"+Math.ceil(Math.max(0,s.duration-s.position)/60)+" min remaining":"");
};
var titles={cpu:"Processor",gpu:"Graphics",ram:"Memory",power:"CPU + GPU power",storage:"Storage",net:"Network",activity:"System activity",cool:"Cooling",player:"Now playing",temps:"Temperatures",clocks:"Clock speeds",sys:"System"};
function close(){
 if(!active){return;}if(active==="player"){anchor.parentNode.insertBefore(player,anchor.nextSibling);}
 dialog.hidden=true;main.removeAttribute("aria-hidden");main.removeAttribute("inert");main.style.visibility="";active="";cursor=null;trigger.focus();plots();
}
function open(k,section,btn){
 if(active){return;}active=k;source=section;trigger=btn;fan="";cursor=null;
 if(k==="player"){$("mediaSlot").appendChild(player);window.panelMedia(window.currentMedia||{});}
 main.setAttribute("aria-hidden","true");main.setAttribute("inert","");main.style.visibility="hidden";
 dialog.hidden=false;dialog.querySelector(".inside").scrollTop=0;put("detailTitle",titles[k]);show($("mediaSlot"),k==="player");show($("detailValues"),k!=="player");show($("fanList"),k==="cool");
 show($("detailRanges"),["player","sys","storage"].indexOf(k)<0);$("detailCharts").textContent="";$("detailValues").textContent="";$("fanList").textContent="";$("fanList").removeAttribute("data-names");
 selectWindow(minutes);$("closeDetail").focus();
}
Array.prototype.forEach.call(panels,function(section){
 var k=Object.keys(titles).filter(function(x){return section.classList.contains(x);})[0];if(!k){return;}
 var h=section.querySelector("h2"),b=el("button","⤢");b.className="expand";b.setAttribute("aria-label","Expand "+titles[k]);b.setAttribute("aria-haspopup","dialog");h.appendChild(b);
 section.addEventListener("click",function(e){if(active||e.target.closest("input,label,nav")||(e.target.closest("button")&&e.target!==b)){return;}open(k,section,b);});
});
$("closeDetail").onclick=close;document.addEventListener("keydown",function(e){
 if(!active){return;}if(e.key==="Escape"){close();return;}
 if(e.key==="Tab"){var nodes=Array.prototype.filter.call(dialog.querySelectorAll("button:not(:disabled),input:not(:disabled)"),function(n){return n.offsetWidth>0;});var first=nodes[0],last=nodes[nodes.length-1];
 if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
});
function dataFields(d){
 var c=d.cpu,g=d.gpu,f={cpu:c.load,gpu:g.load,cpuTemp:c.temp,ccd:c.ccd_temp,gpuTemp:g.temp,hot:g.hotspot,memTemp:g.mem_temp,
 cpuW:c.watts,gpuW:g.watts,power:d.watts,ram:d.ram.percent,cClock:c.clock,peak:c.max_clock,gClock:g.core_clock,mClock:g.mem_clock,
 tx:typeof d.io.up==="number"?d.io.up/1048576:null,rx:typeof d.io.down==="number"?d.io.down/1048576:null};
 d.fans.forEach(function(x){f["fan:"+x.name]=x.rpm;});return f;
}
window.panelSample=function(d){latest=d;var point=historyData[historyData.length-1];if(point&&point.t===d.timestamp){var fields=dataFields(d);Object.keys(fields).forEach(function(k){point[k]=fields[k];});}if(active){refresh();}};
var tempKeys=[["CPU package","cpuTemp"],["CPU CCD","ccd"],["GPU core","gpuTemp"],["GPU hotspot","hot"],["GPU memory","memTemp"]];
var clockKeys=[["CPU","cClock"],["CPU peak","peak"],["GPU core","gClock"],["GPU memory","mClock"]];
function metrics(items){var box=$("detailValues");box.textContent="";items.forEach(function(m){var n=el("div","");n.appendChild(el("small",m[0]));n.appendChild(el("b",m[1]));box.appendChild(n);});}
function table(series,unit,pts){
 var box=$("detailValues");box.textContent="";var t=el("table",""),r=el("tr","");["Sensor","Now","Min","Max"].forEach(function(h){r.appendChild(el("th",h));});t.appendChild(r);
 series.forEach(function(s){var values=pts.map(function(p){return p[s[1]];}).filter(function(x){return typeof x==="number";});r=el("tr","");[s[0],num(dataFields(latest)[s[1]],0,unit),num(values.length?Math.min.apply(null,values):null,0,unit),num(values.length?Math.max.apply(null,values):null,0,unit)].forEach(function(v){r.appendChild(el("td",v));});t.appendChild(r);});box.appendChild(t);
}
function fanButtons(fans){var box=$("fanList"),names=fans.map(function(f){return f.name;}),key=JSON.stringify(names);if(box.getAttribute("data-names")!==key){box.textContent="";box.setAttribute("data-names",key);[""].concat(names).forEach(function(n){var b=el("button",n||"All fans");b.onclick=function(){fan=n;cursor=null;refresh();};box.appendChild(b);});}
 Array.prototype.forEach.call(box.children,function(b,i){b.setAttribute("aria-pressed",String((names[i-1]||"")===fan));});}
function graph(container,title,series,unit,points,limit){
 var header=container.querySelector("h3"),canvas=container.querySelector("canvas"),legend=container.querySelector("p");
 header.textContent=title+" · "+unit;var w=canvas.clientWidth,h=canvas.clientHeight,ratio=Math.min(window.devicePixelRatio||1,2);if(!w||!h){return;}
 if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);}
 var ctx=canvas.getContext("2d");ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
 var l=44,end=w-12,top=12,bt=h-22,max=limit||1;
 if(!limit){points.forEach(function(p){series.forEach(function(s){if(typeof p[s[1]]==="number"){max=Math.max(max,p[s[1]]*1.08);}});});}
 var until=latest.timestamp,since=Math.max(until-minutes*60,Math.min(until-5,points.length?points[0].t:until-5));
 function x(t){return l+(t-since)/(until-since)*(end-l);}
 ctx.font="11px monospace";ctx.fillStyle="#a1b4bb";ctx.strokeStyle="#26383e";ctx.lineWidth=1;
 for(var i=0;i<=4;i++){var y=bt-(bt-top)*i/4;ctx.fillText(num(max*i/4,max<5?1:0),1,y+3);ctx.beginPath();ctx.moveTo(l,y);ctx.lineTo(end,y);ctx.stroke();}
 var stamp=function(t){return new Date(t*1000).toTimeString().slice(0,8);};
 ctx.fillText(stamp(since),l,h-3);ctx.textAlign="right";ctx.fillText(stamp(until),end,h-3);ctx.textAlign="left";
 series.forEach(function(s,j){ctx.strokeStyle=palette[j%palette.length];ctx.lineWidth=2;ctx.beginPath();var last=null;points.forEach(function(p){var v=p[s[1]];if(typeof v!=="number"){last=null;return;}var y=bt-(bt-top)*v/max;if(last===null||p.t-last>3){ctx.moveTo(x(p.t),y);}else{ctx.lineTo(x(p.t),y);}last=p.t;});ctx.stroke();});
 var picked=points[points.length-1];if(cursor!==null&&points.length){picked=points.reduce(function(a,b){return Math.abs(a.t-cursor)<Math.abs(b.t-cursor)?a:b;});ctx.strokeStyle="#b1c6c9";ctx.beginPath();ctx.moveTo(x(picked.t),top);ctx.lineTo(x(picked.t),bt);ctx.stroke();}
 legend.textContent="";if(cursor!==null&&picked){legend.appendChild(el("small",stamp(picked.t)+"　"));}series.forEach(function(s,j){var v=el("span",s[0]+" "+num(picked&&picked[s[1]],unit==="MiB/s"?2:0," "+unit));v.style.color=palette[j%palette.length];legend.appendChild(v);});
 function inspect(e){var pos=e.touches?e.touches[0].clientX:e.clientX;cursor=since+Math.min(1,Math.max(0,(pos-canvas.getBoundingClientRect().left-l)/(end-l)))*(until-since);refresh();}
 canvas.onmousedown=inspect;canvas.onmousemove=function(e){if(e.buttons===1){inspect(e);}};canvas.ontouchstart=canvas.ontouchmove=function(e){e.preventDefault();inspect(e);};canvas.ondblclick=function(){cursor=null;refresh();};
}
function refresh(){
 if(!active||active==="player"||!latest){return;}var d=latest,c=d.cpu,g=d.gpu,f=dataFields(d),charts=[],items=[],pts=historyData.filter(function(p){return p.t>=d.timestamp-minutes*60;});
 function add(title,series,unit,max){charts.push([title,series,unit,max]);}
 switch(active){
 case "cpu":case "gpu":
 var cpu=active==="cpu";items=[[cpu?c.name:g.name,num(cpu?c.load:g.load,0,"%")],["Power",num(cpu?c.watts:g.watts,1," W")],["Core clock",num(cpu?c.clock:g.core_clock,0," MHz")]];
 if(cpu){c.cores.forEach(function(v,i){items.push(["Thread "+(i+1),num(v,0,"%")]);});}else{items.push(["Hotspot",num(g.hotspot,0," °C")],["VRAM",num(g.vram_used,1)+" / "+num(g.vram_total,1," GiB")],["Fan",num(g.fan,0,"%")+" · "+num(g.rpm,0," RPM")]);}
 add("Load",[["Load",active]],"%",100);add("Temperature",[["Temperature",cpu?"cpuTemp":"gpuTemp"]],"°C");break;
 case "activity":add("Utilization",[["CPU","cpu"],["GPU","gpu"]],"%",100);break;
 case "power":add("Power draw",[["Combined","power"],["CPU package","cpuW"],["GPU","gpuW"]],"W");break;
 case "net":add("Network throughput",[["Upload","tx"],["Download","rx"]],"MiB/s");break;
 case "ram":items=[["Used",num(d.ram.used,1," GiB")],["Total",num(d.ram.total,1," GiB")],["Speed",num(d.ram.speed_mt_s,0," MT/s")]];add("Memory usage",[["RAM","ram"]],"%",100);break;
 case "storage":d.disks.forEach(function(v){var total=v.total_gib;items.push([v.name,num(v.percent,0,"% used")+" · "+num(typeof total==="number"?total-v.free_gib:null,1," GiB used")+" · "+num(v.free_gib,1," GiB free")]);});break;
 case "cool":fanButtons(d.fans);var selected=d.fans.filter(function(v){return !fan||v.name===fan;});selected.forEach(function(v){items.push([v.name,num(v.rpm,0," RPM")]);});add("Fan speed",selected.map(function(v){return [v.name,"fan:"+v.name];}),"RPM");break;
 case "temps":case "clocks":var temps=active==="temps",keys=temps?tempKeys:clockKeys,u=temps?"°C":"MHz";table(keys," "+u,pts);add(temps?"Sensor temperatures":"Clock frequencies",keys,u);break;
 case "sys":items=[["Computer",d.host],["Operating system",d.os||"--"],["Uptime",num(d.uptime/3600,1," hours")],["Processes",num(d.processes,0)],["Processor",c.name],["Graphics",g.name]];break;
 }
 if(active!=="temps"&&active!=="clocks"){metrics(items);}
 var box=$("detailCharts");while(box.children.length>charts.length){box.removeChild(box.lastChild);}charts.forEach(function(a,i){if(!box.children[i]){var n=document.createElement("article");n.innerHTML="<h3></h3><canvas></canvas><p></p>";box.appendChild(n);}graph(box.children[i],a[0],a[1],a[2],pts,a[3]);});
}
window.addEventListener("resize",refresh);
})();
