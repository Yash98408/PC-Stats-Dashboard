"""Local telemetry console. Start with python server.py --mock."""
import argparse
import json
import math
import os
import platform
import re
import socket
import subprocess
import threading
import time
from urllib.request import urlopen

from flask import Flask, jsonify
import psutil

from collections import deque
from media_bridge import register

app = Flask(__name__)
media = register(app)
history = deque(maxlen=901)
history_lock = threading.Lock()
GIB = 1024 ** 3
GPU_FIELDS = "load temp watts fan rpm core_clock mem_clock vram_used vram_total".split()
HOST = socket.gethostname()


def attempt(fn, *args):
    # Sensor drivers can disappear between samples.
    try:
        return fn(*args)
    except Exception:
        return None


def blank():
    return dict(host=HOST, mock=False, timestamp=time.time(), uptime=None, processes=None,
                cpu=dict(name=platform.processor() or "CPU", load=None, cores=[], temp=None,
                         clock=None, watts=None, rpm=None),
                gpu=dict(name="GPU", **dict.fromkeys(GPU_FIELDS)), fans=[], board=[],
                ram=dict.fromkeys(["used", "total", "percent", "speed_mt_s"]), swap=dict.fromkeys(["used","total","percent"]),
                disks=[], io=dict.fromkeys(["read","write","up","down"]), watts=None)


def mock_sample():
    s = blank()
    t = time.time()
    def wave(mid, amp, period):
        return mid + amp * math.sin(t / period) + amp * .18 * math.cos(t / 1.9)
    cores = [wave(40, 27, 6+i*.4) for i in range(12)]
    s.update(mock=True, host="DEMO-PC", uptime=154200+t%3600, processes=189,
             ram=dict(used=12.4,total=32,percent=38.75,speed_mt_s=5200),swap=dict(used=1,total=8,percent=12.5),
             disks=[dict(name="C:",percent=62,total_gib=1000,free_gib=380)],io=dict(read=wave(22,12,4)*1048576,
             write=wave(6,3,5)*1048576,up=wave(2,1,3)*1048576,down=wave(9,6,7)*1048576))
    s["cpu"].update(name="Demo 6-core processor",load=sum(cores)/len(cores),cores=cores,
                    temp=wave(57,8,11),clock=wave(4650,160,6),watts=wave(60,15,8),rpm=wave(1250,230,9))
    s["gpu"].update(name="Demo graphics adapter",load=wave(65,22,8),temp=wave(63,7,12),
                    watts=wave(142,32,8),fan=wave(43,8,9),rpm=wave(1550,180,9),core_clock=2445,
                    mem_clock=10501,vram_used=wave(5,1,30),vram_total=12)
    s["fans"]=[dict(name=k.upper(),rpm=s[k]["rpm"]) for k in ("cpu","gpu")]
    s["watts"]=s["cpu"]["watts"]+s["gpu"]["watts"]
    return s


def configured_ram_speed():
    """Read the configured DDR transfer rate once per server start."""
    if os.name != "nt":
        return None
    output = subprocess.check_output(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
         "(Get-CimInstance Win32_PhysicalMemory).ConfiguredClockSpeed"],
        text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
    speeds = {int(line) for line in output.splitlines() if line.strip().isdigit()}
    return speeds.pop() if len(speeds) == 1 and 0 not in speeds else None


def windows_model(class_name):
    """Read the local adapter or processor name once during startup."""
    if os.name != "nt":
        return None
    name = subprocess.check_output(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
         f"(Get-CimInstance {class_name} | Select-Object -First 1).Name"],
        text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
    return name.strip() or None


class Sensors:
    def __init__(self):
        self.ram_speed = attempt(configured_ram_speed)
        self.previous = {}
        self.core_ready = False
        self.gpu_name = attempt(windows_model, "Win32_VideoController") or "GPU"
        self.cpu_name = attempt(windows_model, "Win32_Processor") or os.getenv("PROCESSOR_IDENTIFIER") or platform.processor() or "CPU"
        self.nv = None
        self.handle = None
        try:
            import pynvml as nv
            nv.nvmlInit()
            self.handle = nv.nvmlDeviceGetHandleByIndex(0)
            self.nv = nv
        except Exception:
            pass

    def rates(self, group, counters, fields, result):
        now = time.monotonic()
        if counters is None:
            self.previous.pop(group, None)
            return
        values = [getattr(counters,k) for k in fields]
        old = self.previous.get(group)
        self.previous[group] = now, values
        if old and now > old[0]:
            for name, a, b in zip(result, values, old[1]):
                if a >= b:
                    self.io[name] = (a-b)/(now-old[0])

    def nvidia(self,g):
        nv, h = self.nv, self.handle
        if nv is None:
            return
        def get(name,*args):
            return attempt(getattr(nv,"nvmlDeviceGet"+name),h,*args)
        name = get("Name")
        if name:
            g["name"] = name.decode(errors="replace") if isinstance(name,bytes) else name
        util, mem = get("UtilizationRates"), get("MemoryInfo")
        power = get("PowerUsage")
        g.update(load=getattr(util,"gpu",None),temp=get("Temperature",0),fan=get("FanSpeed"),
                 watts=power/1000 if power is not None else None,core_clock=get("ClockInfo",0),
                 mem_clock=get("ClockInfo",2))
        if mem:
            g.update(vram_used=mem.used/GIB,vram_total=mem.total/GIB)

    def sample(self):
        s=blank()
        c=s["cpu"]
        c["name"]=self.cpu_name
        cores=attempt(lambda: psutil.cpu_percent(percpu=True))
        if cores and self.core_ready:
            c.update(cores=cores,load=sum(cores)/len(cores))
        self.core_ready=bool(cores)
        c["clock"]=getattr(attempt(psutil.cpu_freq),"current",None)
        for key, fn in [("ram",psutil.virtual_memory),("swap",psutil.swap_memory)]:
            v=attempt(fn)
            if v:
                s[key]=dict(used=v.used/GIB,total=v.total/GIB,percent=v.percent)
        s["ram"]["speed_mt_s"] = self.ram_speed
        for p in attempt(psutil.disk_partitions) or []:
            if "cdrom" in p.opts or not p.fstype:
                continue
            usage=attempt(psutil.disk_usage,p.mountpoint)
            s["disks"].append(dict(name=p.mountpoint,total_gib=usage.total/GIB if usage else None,free_gib=usage.free/GIB if usage else None,percent=getattr(usage,"percent",None)))
        self.io=s["io"]
        self.rates("disk",attempt(psutil.disk_io_counters),["read_bytes","write_bytes"],["read","write"])
        self.rates("net",attempt(psutil.net_io_counters),["bytes_sent","bytes_recv"],["up","down"])
        s["uptime"]=attempt(lambda: time.time()-psutil.boot_time())
        s["processes"]=attempt(lambda: len(psutil.pids()))
        s["gpu"]["name"] = self.gpu_name
        self.nvidia(s["gpu"])
        attempt(read_lhm,s,self.handle is not None)
        if c["watts"] is not None and s["gpu"]["watts"] is not None:
            s["watts"]=c["watts"]+s["gpu"]["watts"]
        return s


def read_lhm(s,nvidia):
    with urlopen("http://127.0.0.1:8085/data.json",timeout=.65) as response:
        root=json.load(response)
    sensors=[]
    def walk(node,device=""):
        if node.get("HardwareId") or node.get("ImageURL","").endswith(("/cpu.png","/ati.png","/nvidia.png")):
            device=node.get("Text",device)
        sid=node.get("SensorId","").lower()
        if sid:
            label=node.get("Text","")
            value=node.get("RawValue")
            display=str(node.get("Value",""))
            formatted = isinstance(value, str) or "RawValue" not in node
            if formatted:
                match=re.search(r"[-+]?\d+(?:[.,]\d+)?",str(value) if isinstance(value,str) else display)
                value=float(match[0].replace(",",".")) if match else None
            if isinstance(value,(int,float)) and math.isfinite(value):
                if formatted and "°F" in str(node.get("RawValue",display)):
                    value=(value-32)*5/9
            else:
                value=None
            sensors.append((sid,label,value,device,display))
        for child in node.get("Children",[]):
            walk(child,device)
    walk(root)
    cpu=[r for r in sensors if "cpu/" in r[0]]
    family="nvidiagpu" if nvidia else "atigpu"
    gpu=[r for r in sensors if any(x in r[0] for x in ([family,"gpu-nvidia"] if nvidia else [family,"amdgpu","gpu-amd"]))]
    if gpu:
        prefix=gpu[0][0].split("/")[:3]
        gpu=[r for r in gpu if r[0].split("/")[:3]==prefix]
    def pick(rows,kind,*labels):
        for label in labels:
            for sid,name,value,_,display in rows:
                if "/"+kind+"/" in sid and name.lower()==label and value is not None:
                    return value
    c,g=s["cpu"],s["gpu"]
    if cpu and cpu[0][3]:
        c["name"]=cpu[0][3]
    c["temp"]=pick(cpu,"temperature","cpu package","core (tctl/tdie)","core (tdie)","core average","cpu cores")
    c["watts"]=pick(cpu,"power","cpu package","package","cpu cores + soc")
    if gpu and gpu[0][3]:
        g["name"]=gpu[0][3]
    for key,kind,labels in [
        ("temp","temperature",["gpu core"]),("load","load",["gpu core","d3d 3d"]),
        ("watts","power",["gpu package","gpu ppt","gpu board power","gpu power"]),
        ("core_clock","clock",["gpu core"]),("mem_clock","clock",["gpu memory"]),
        ("fan","control",["gpu fan","gpu fan 1"])]:
        if g[key] is None:
            g[key]=pick(gpu,kind,*labels)
    c["ccd_temp"]=pick(cpu,"temperature","ccd1 (tdie)","cpu ccd1 (tdie)")
    clocks=[r[2] for r in cpu if "/clock/" in r[0] and "core" in r[1].lower() and r[2] is not None]
    c["max_clock"]=max(clocks,default=None)
    g["hotspot"]=pick(gpu,"temperature","gpu hot spot","gpu hotspot")
    g["mem_temp"]=pick(gpu,"temperature","gpu memory junction","gpu memory")
    for key in ("used","total"):
        if g["vram_"+key] is None:
            mb=pick(gpu,"smalldata","gpu memory "+key,"gpu dedicated memory "+key)
            g["vram_"+key]=mb/1024 if mb is not None else None
    for sid,label,value,device,display in sensors:
        if "/fan/" in sid:
            s["fans"].append(dict(name=label,rpm=value))
            if "cpu" in label.lower() and c["rpm"] is None:
                c["rpm"]=value
            if any(row[0]==sid for row in gpu) and g["rpm"] is None:
                g["rpm"]=value
        elif any(x in sid for x in ("/lpc/","/motherboard/","/superio/")):
            s["board"].append(dict(name=label,device=device,value=value,display=display))


latest=blank()


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/stats")
def stats():
    response=jsonify(latest)
    response.headers["Cache-Control"]="no-store"
    return response


@app.get("/api/history")
def get_history():
    with history_lock:
        return jsonify(list(history)), {"Cache-Control":"no-store"}


def collect(mock):
    global latest
    sample=mock_sample if mock else Sensors().sample
    while True:
        start=time.monotonic()
        latest=attempt(sample) or blank()
        latest["os"] = "Windows (demo)" if mock else platform.platform()
        with history_lock:
            history.append(dict(t=latest["timestamp"],cpu=latest["cpu"]["load"],gpu=latest["gpu"]["load"],
                                power=latest["watts"],up=latest["io"]["up"],down=latest["io"]["down"]))
        time.sleep(max(.05,1-(time.monotonic()-start)))


def lan_ip():
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as sock:
        sock.connect(("192.0.2.1",9))
        return sock.getsockname()[0]


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--mock",action="store_true")
    parser.add_argument("--port",type=int,default=5000)
    parser.add_argument("--local-only", action="store_true", help="Only accept connections from this PC")
    args=parser.parse_args()
    if args.mock:
        latest=mock_sample()
    if not args.mock:
        threading.Thread(target=media.worker,daemon=True).start()
    threading.Thread(target=collect,args=(args.mock,),daemon=True).start()
    address = "127.0.0.1" if args.local_only else (attempt(lan_ip) or HOST)
    print(f"Dashboard URL  http://{address}:{args.port}",flush=True)
    app.run(host="127.0.0.1" if args.local_only else "0.0.0.0",port=args.port,debug=False,use_reloader=False)
