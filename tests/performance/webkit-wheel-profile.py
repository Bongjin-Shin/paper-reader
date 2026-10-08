"""Linux WebKitGTK wheel acceleration isolation, using actual X11 wheel input.

DISPLAY=:99 /usr/bin/python3 tests/performance/webkit-wheel-profile.py
Requires GTK3/WebKit2 4.1 introspection and xdotool. No PDF, API, or app data.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GLib

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / '.tools/scroll-profile/webkit-wheel.json'
XDOTOOL = shutil.which('xdotool') or str(ROOT / '.tools/native/usr/bin/xdotool')
env = {**os.environ, 'LD_LIBRARY_PATH': str(ROOT / '.tools/native/usr/lib/x86_64-linux-gnu')}
results = []
manager = WebKit2.UserContentManager()
manager.register_script_message_handler('profile')
view = WebKit2.WebView(user_content_manager=manager)
window = Gtk.Window(title='WebKit Wheel Profile')
window.set_default_size(1000, 850)
window.move(0, 0)
window.add(view)
window.show_all()

HTML = '''<!doctype html><style>
body{margin:0}#reader{height:800px;overflow:auto}.page{height:1000px;border-bottom:24px solid #ddd}
</style><div id="reader"></div><script>
const reader=document.querySelector('#reader');
reader.innerHTML=Array.from({length:24},(_,i)=>`<div class="page">Page ${i+1}</div>`).join('');
const wheels=[],scrolls=[];let start;
reader.addEventListener('wheel',e=>{
 if(e.ctrlKey)e.preventDefault();
 if(start===undefined){start=performance.now();setTimeout(finish,1800)}
 wheels.push({ms:performance.now()-start,delta:e.deltaY,top:reader.scrollTop});
},{passive:false});
reader.addEventListener('scroll',()=>scrolls.push({ms:performance.now()-start,top:reader.scrollTop}),{passive:true});
function finish(){window.webkit.messageHandlers.profile.postMessage(JSON.stringify({wheels,scrolls,top:reader.scrollTop}))}
</script>'''

def start_sample():
    smooth = len(results) < 3
    view.get_settings().set_enable_smooth_scrolling(smooth)
    view.load_html(HTML, 'http://localhost/')

def loaded(_view, event):
    if event != WebKit2.LoadEvent.FINISHED:
        return
    def wheel():
        # Separate process keeps GTK's UI loop running while hardware events arrive.
        subprocess.Popen([XDOTOOL, 'mousemove', '500', '400', 'click', '--repeat', '20', '--delay', '10', '5'], env=env)
        return False
    GLib.timeout_add(250, wheel)

def received(_manager, message):
    data = json.loads(message.get_js_value().to_string())
    data['smooth'] = view.get_settings().get_enable_smooth_scrolling()
    data['tailMs'] = data['scrolls'][-1]['ms'] - data['wheels'][-1]['ms']
    # The last wheel listener executes before its default scroll action.
    data['distanceAfterLastWheel'] = data['top'] - data['wheels'][-1]['top']
    results.append(data)
    print(json.dumps({k:v for k,v in data.items() if k not in ('wheels','scrolls')}) + f" events={len(data['wheels'])}", flush=True)
    if len(results) < 6:
        GLib.idle_add(start_sample)
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(results, indent=2))
        Gtk.main_quit()

manager.connect('script-message-received::profile', received)
view.connect('load-changed', loaded)
GLib.idle_add(start_sample)
GLib.timeout_add_seconds(30, Gtk.main_quit)
Gtk.main()
if len(results) != 6:
    raise SystemExit('Native wheel profiling did not complete')
