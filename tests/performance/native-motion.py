"""Run an instrumented Tauri release with isolated data and real X11 wheel input.

python3 tests/performance/native-motion.py BINARY FIXTURE_PDF LABEL
Requires the explicit reader-profile Cargo feature and instrumented Vite build.
Uses Xvfb :98 by default; set READER_PROFILE_DISPLAY for a dedicated X11 display.
"""
import hashlib
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / '.tools/motion-verification'
BINARY, PDF, LABEL = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), sys.argv[3]
OUTPUT.mkdir(parents=True, exist_ok=True)
display = os.environ.get('READER_PROFILE_DISPLAY', ':98')
xvfb = None
if 'READER_PROFILE_DISPLAY' not in os.environ:
    xvfb = subprocess.Popen(['Xvfb', display, '-screen', '0', '1200x900x24', '-nolisten', 'tcp'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    time.sleep(.3)
xdotool = ROOT / '.tools/native/usr/bin/xdotool'
input_env = {**os.environ, 'DISPLAY': display, 'LD_LIBRARY_PATH': str(ROOT / '.tools/native/usr/lib/x86_64-linux-gnu')}
samples = []
try:
    for run in range(3):
        data = OUTPUT / f'{LABEL}-{run}-data'
        root = data / 'com.papervocabulary.reader/PaperVocabulary'
        (root / 'database').mkdir(parents=True, exist_ok=True)
        db_path = root / 'database/vocabulary.db'
        if db_path.exists():
            raise RuntimeError(f'Refusing to overwrite QA data: {db_path}')
        db = sqlite3.connect(db_path)
        for migration in sorted((ROOT / 'src-tauri/migrations').glob('*.sql')):
            db.executescript(migration.read_text())
        paper = hashlib.sha256(PDF.read_bytes()).hexdigest()
        db.execute('INSERT INTO papers(id,file_name,file_path,title,metadata_checked) VALUES(?,?,?,?,1)',
                   (paper, PDF.name, str(PDF), 'motion-qa'))
        db.execute('INSERT INTO library_papers(paper_id) VALUES(?)', (paper,))
        db.execute("INSERT INTO vocabulary_entries(id,word,translation) VALUES(1,'asymptotic','점근적인')")
        for page in range(1, 25):
            db.execute("INSERT INTO vocabulary_contexts(id,vocabulary_entry_id,paper_id,page_number,original_sentence,action_type,result) VALUES(?,1,?,?,'The model maintains asymptotic complexity.','translation','점근적인')", (page, paper, page))
            for line in range(48):
                position = json.dumps({'version': 1, 'rects': [[240,744-line*14,290,756-line*14]], 'startOffset': 0, 'endOffset': 10})
                db.execute("INSERT INTO highlights(paper_id,vocabulary_entry_id,context_id,page_number,selected_text,position_data) VALUES(?,1,?,?,'asymptotic',?)", (paper,page,page,position))
        db.commit(); db.close()
        events = OUTPUT / f'{LABEL}-{run}.jsonl'
        events.write_text('')
        env = {**os.environ, 'DISPLAY':display, 'XDG_DATA_HOME':str(data),
               'XDG_CONFIG_HOME':str(OUTPUT/f'{LABEL}-{run}-config'), 'XDG_CACHE_HOME':str(OUTPUT/f'{LABEL}-{run}-cache'),
               'OPENAI_API_KEY':'', 'READER_PROFILE_OUTPUT':str(events)}
        with (OUTPUT / f'{LABEL}-{run}.log').open('w') as log:
            app = subprocess.Popen([str(BINARY)], cwd=OUTPUT, env=env, stdin=subprocess.DEVNULL,
                                   stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        seen = 0
        deadline = time.monotonic()+100
        try:
            while time.monotonic() < deadline:
                if app.poll() is not None:
                    raise RuntimeError('Native app exited; inspect native log')
                rows = events.read_text().splitlines()
                done = False
                for line in rows[seen:]:
                    event = json.loads(line); seen += 1
                    if event['kind'] == 'error': raise RuntimeError(event)
                    if event['kind'] == 'sample':
                        event['run'] = run; samples.append(event); print(json.dumps(event), flush=True)
                    if event['kind'] == 'complete': done = True
                    if event['kind'] == 'input':
                        if event['scenario'] == 'doubleclick':
                            subprocess.run([str(xdotool),'mousemove',str(round(event['x'])),str(round(event['y'])),
                                            'click','--repeat','2','--delay','80','1'],env=input_env,check=True)
                            continue
                        args = [str(xdotool),'mousemove','600','400']
                        if event['scenario'] == 'zoom':
                            args += ['keydown','ctrl','click','--repeat','12','--delay','16','4','click','--repeat','8','--delay','16','5','keyup','ctrl']
                        elif event['scenario'] == 'warm-scroll':
                            args += ['click','--repeat','20','--delay','16','5','click','--repeat','20','--delay','16','4']
                        else: args += ['click','--repeat','40','--delay','16','5']
                        subprocess.run(args, env=input_env, check=True)
                if done: break
                time.sleep(.02)
            else: raise TimeoutError('Native profiling did not finish')
        finally:
            os.killpg(app.pid, signal.SIGTERM)
            app.wait(timeout=10)
    (OUTPUT / f'{LABEL}.json').write_text(json.dumps(samples,indent=2)+'\n')
finally:
    if xvfb:
        os.killpg(xvfb.pid, signal.SIGTERM); xvfb.wait(timeout=10)
