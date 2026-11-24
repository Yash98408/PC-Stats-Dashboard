"""Read and control the interactive Windows user's current media session."""
import hashlib
import asyncio
import threading
import ctypes

import sys
from queue import Queue, Empty
from concurrent.futures import Future
import time

from flask import Response, jsonify, request

EMPTY = {"title": "", "artist": "", "playing": False, "controls": {},
         "position": None, "duration": None, "volume": None, "muted": False}


def music_priority(source):
    source = (source or "").lower()
    if "youtube" in source:
        return 3
    if any(name in source for name in ("chrome", "msedge", "microsoftedge", "firefox", "brave", "vivaldi", "opera", "chromium", "arc.exe")):
        return 2
    if any(name in source for name in ("spotify", "tidal", "applemusic", "musicbee", "foobar", "aimp")):
        return 1
    return 0


def choose_session(sessions, current, previous):
    """A browser music session keeps its place while a foreground game plays."""
    ranked = []
    for session in sessions:
        try:
            source = session.source_app_user_model_id
            status = session.get_playback_info().playback_status.name
            if status in ("CLOSED", "STOPPED"):
                continue
            score = (music_priority(source), status == "PLAYING",
                     source == previous, session == current)
            ranked.append((score, session))
        except Exception:
            continue  # Session closed between enumeration and reading its status.
    return max(ranked, key=lambda item: item[0])[1] if ranked else None


class MediaBridge:
    def __init__(self):
        self.state = EMPTY.copy()
        self.loop = None
        self.manager = None
        self.endpoint = None
        self.cover_key = None
        self.cover = None
        self.selected = None
        self.previous_source = None
        self.audio = {}
        self.audio_jobs = Queue()
        self.updated = 0

    async def artwork(self, key, thumbnail):
        if key != self.cover_key:
            self.cover_key, self.cover = key, None
            if thumbnail:
                from winrt.windows.storage.streams import DataReader
                stream = await thumbnail.open_read_async()
                try:
                    if 0 < stream.size <= 4 * 1024 * 1024:
                        reader = DataReader(stream)
                        try:
                            length = await reader.load_async(stream.size)
                            data = bytearray(length)
                            reader.read_bytes(data)
                            kind = "image/png" if data.startswith(b"\x89PNG") else "image/jpeg" if data.startswith(b"\xff\xd8") else None
                            if kind:
                                self.cover = (hashlib.sha256(data).hexdigest()[:20], bytes(data), kind)
                        finally:
                            reader.detach_stream()
                            reader.close()
                finally:
                    stream.close()
        return "/api/art/" + self.cover[0] if self.cover else None

    def worker(self):
        # WinRT completion handlers need a multithreaded apartment in a headless worker.
        sys.coinit_flags = 0
        threading.Thread(target=self.mixer, daemon=True).start()
        ctypes.windll.ole32.CoInitializeEx(None, 0)
        try:
            self.loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self.loop)
            self.loop.run_until_complete(self.watch())
        finally:
            ctypes.windll.ole32.CoUninitialize()

    def mixer(self):
        from pycaw.pycaw import AudioUtilities, AudioSession
        from pycaw.api.audiopolicy import IAudioSessionControl2
        from pycaw.api.endpointvolume import IAudioMeterInformation
        ctypes.windll.ole32.CoInitializeEx(None, 0)
        last_heard = {}
        try:
            while True:
                endpoint = None
                audio = {"volume": None, "muted": False}
                try:
                    endpoint = AudioUtilities.GetSpeakers().EndpointVolume
                    audio.update(volume=round(endpoint.GetMasterVolumeLevelScalar()*100),
                                 muted=bool(endpoint.GetMute()))
                    for device in AudioUtilities.GetAllDevices(data_flow=0, device_state=1):
                        try:
                            sessions = device.AudioSessionManager.GetSessionEnumerator()
                            for index in range(sessions.GetCount()):
                                ctl = sessions.GetSession(index)
                                try:
                                    peak = ctl.QueryInterface(IAudioMeterInformation).GetPeakValue()
                                    if peak > 0.0001:
                                        proc = AudioSession(ctl.QueryInterface(IAudioSessionControl2)).Process
                                        if proc:
                                            last_heard[proc.name().removesuffix(".exe")] = (time.monotonic(),peak)
                                except Exception:
                                    continue
                        except Exception:
                            continue
                except Exception:
                    pass
                last_heard = {k:v for k,v in last_heard.items() if time.monotonic()-v[0]<4}
                audio["apps"] = sorted(last_heard,key=lambda k:(k.lower() in ("fxsound","audiodg"),-last_heard[k][1]))
                self.audio = audio
                try:
                    action, value, result = self.audio_jobs.get(timeout=0.55)
                except Empty:
                    continue
                try:
                    if endpoint is None:
                        raise RuntimeError("No default audio output")
                    if action == "volume":
                        endpoint.SetMasterVolumeLevelScalar(value/100,None)
                    else:
                        endpoint.SetMute(not endpoint.GetMute(),None)
                    result.set_result(True)
                except Exception:
                    result.set_result(False)
        finally:
            ctypes.windll.ole32.CoUninitialize()

    def snapshot(self):
        state = dict(self.state if time.monotonic()-self.updated < 6 else EMPTY)
        state.update(self.audio)
        apps = state.get("apps", [])
        if apps and not (state.get("title") and (state.get("playing") or music_priority(state.get("source")))):
            apps = sorted(apps, key=music_priority, reverse=True)
            state.update(title=apps[0],artist="PC audio · "+", ".join(apps), playing=True,
                         controls={}, duration=None,position=None,art=None,mode="audio")
        return state

    async def watch(self):
        from winrt.windows.media.control import GlobalSystemMediaTransportControlsSessionManager
        from pycaw.pycaw import AudioUtilities
        while True:
            state = EMPTY.copy()
            try:
                if self.manager is None:
                    self.manager = await GlobalSystemMediaTransportControlsSessionManager.request_async()
                session = choose_session(self.manager.get_sessions(),
                                         self.manager.get_current_session(), self.previous_source)
                self.selected = session
                if session:
                    self.previous_source = session.source_app_user_model_id
                    state["source"] = self.previous_source
                    meta = await asyncio.wait_for(session.try_get_media_properties_async(), 2)
                    try:
                        state["art"] = await asyncio.wait_for(self.artwork(
                            (session.source_app_user_model_id, meta.title, meta.artist, bool(meta.thumbnail)), meta.thumbnail), 2)
                    except Exception:
                        pass
                    info = session.get_playback_info()
                    controls = info.controls
                    tl = session.get_timeline_properties()
                    duration = tl.end_time.total_seconds()
                    position = tl.position.total_seconds()
                    playing = info.playback_status.name == "PLAYING"
                    if playing:
                        position += max(0, time.time()-tl.last_updated_time.timestamp()) * (info.playback_rate or 1)
                    state.update(title=meta.title, artist=meta.artist, playing=playing,
                                 duration=duration, position=min(duration,max(0,position)),
                                 controls={k:getattr(controls,attr) for k,attr in {
                                   "play":"is_play_enabled","pause":"is_pause_enabled",
                                   "prev":"is_previous_enabled","next":"is_next_enabled",
                                   "seek":"is_playback_position_enabled",
                                   "shuffle":"is_shuffle_enabled","repeat":"is_repeat_enabled"}.items()},
                                 shuffle=bool(info.is_shuffle_active),
                                 repeat=bool(info.auto_repeat_mode and int(info.auto_repeat_mode)))
            except Exception:
                self.manager = None
            self.updated = time.monotonic()
            self.state = state
            await asyncio.sleep(1)

    async def command(self, action, value):
        session = self.selected
        if not session or not self.state["controls"].get(action):
            return False
        if action == "seek":
            return await session.try_change_playback_position_async(int(min(value,self.state["duration"])*1e7))
        if action == "shuffle":
            return await session.try_change_shuffle_active_async(not self.state.get("shuffle"))
        if action == "repeat":
            from winrt.windows.media import MediaPlaybackAutoRepeatMode as Repeat
            return await session.try_change_auto_repeat_mode_async(Repeat.NONE if self.state.get("repeat") else Repeat.TRACK)
        method = {"next":"try_skip_next_async","prev":"try_skip_previous_async",
                  "play":"try_play_async","pause":"try_pause_async"}[action]
        return await getattr(session,method)()


def register(app):
    bridge = MediaBridge()
    @app.get("/api/art/<key>")
    def artwork(key):
        cover = bridge.cover
        if not cover or key != cover[0]:
            return "", 404
        return Response(cover[1], mimetype=cover[2], headers={"Cache-Control":"private, max-age=3600"})

    @app.get("/api/media")
    def media_state():
        return jsonify(bridge.snapshot()), {"Cache-Control":"no-store"}

    @app.post("/api/media")
    def media_command():
        if request.headers.get("Origin") != request.host_url.rstrip("/") or not request.is_json:
            return "",403
        body = request.get_json(silent=True) or {}
        if not isinstance(body,dict):
            return "",400
        action,value = body.get("action"),body.get("value")
        if action not in ("play","pause","prev","next","seek","volume","mute","shuffle","repeat"):
            return "",400
        if action in ("seek","volume") and (type(value) not in (float,int) or not 0<=value<=(100 if action=="volume" else 864000)):
            return "",400
        if action in ("volume","mute"):
            future = Future()
            bridge.audio_jobs.put((action,value,future))
            try:
                return ("",204) if future.result(2) else ("",409)
            except TimeoutError:
                return "",503
        if not bridge.snapshot()["controls"].get(action):
            return "",409
        if bridge.loop is None:
            return "",503
        try:
            result=asyncio.run_coroutine_threadsafe(bridge.command(action,value),bridge.loop).result(3)
        except Exception:
            result=False
        return ("",204) if result else ("",409)
    return bridge

