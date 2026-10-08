#!/usr/bin/python3
import sys, os, json, time, subprocess
from pathlib import Path
root = Path(os.environ['CLAUDE_CONFIG_DIR']).parent
scenario = (root / 'scenario').read_text()
args = sys.argv[1:]
def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)
if args[:2] == ['auth', 'status']:
    emit({'loggedIn': scenario != 'signed-out', 'authMethod': 'api_key' if scenario == 'api' else 'claude.ai', 'subscriptionType': 'pro'})
    sys.exit(0)
if args[:2] == ['auth', 'login']:
    assert '--claudeai' in args
    url = 'https://claude.com/cai/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A43210%2Fcallback&state=test'
    if scenario == 'bad-login-url': url = url.replace('claude.com', 'evil.test')
    subprocess.run([os.environ['BROWSER'], url], check=True)
    (root/'login-pid').write_text(str(os.getpid()))
    time.sleep(3)
    sys.exit(0)
if args[:2] == ['auth', 'logout']:
    (root / 'scenario').write_text('signed-out')
    sys.exit(0)
assert args[args.index('--tools')+1] == ''
assert args[args.index('--disallowedTools')+1] == '*'
assert '--safe-mode' in args and '--no-session-persistence' in args
assert args[args.index('--permission-mode')+1] == 'dontAsk'
assert args[args.index('--setting-sources')+1] == ''
assert json.loads(args[args.index('--mcp-config')+1]) == {'mcpServers': {}}
assert not any(k.startswith('ANTHROPIC_') or k.startswith('CLAUDE_CODE_OAUTH') for k in os.environ)
assert Path.cwd() == root / 'work'
(root/'launch.json').write_text(json.dumps(args))
models = [ {'value': 'default', 'displayName': 'Default', 'supportedEffortLevels': ['low','medium','high']}, {'value': 'sonnet', 'displayName': 'Sonnet', 'supportedEffortLevels': ['low','medium','high']}, {'value':'opus[1m]', 'displayName':'Opus', 'supportedEffortLevels':['high','max']}, {'value':'haiku','displayName':'Haiku'} ]
for line in sys.stdin:
    value = json.loads(line)
    if value['type'] == 'control_request':
        if value['request']['subtype'] == 'get_usage':
            (root/'usage-requested').write_text('read-only')
            if scenario == 'quota-error':
                emit({'type':'control_response','response':{'subtype':'error','request_id':value['request_id'],'error':'unsupported'}})
            else:
                available = scenario not in ['signed-out','api']
                emit({'type':'control_response','response':{'subtype':'success','request_id':value['request_id'],'response':{'rate_limits_available':available,'subscription_type':'pro' if available else None,'rate_limits': None if not available else {'five_hour':{'utilization':23.5,'resets_at':'2026-10-08T12:00:00Z'},'seven_day':{'utilization':40,'resets_at':'2026-10-14T12:00:00+00:00'},'seven_day_sonnet':{'utilization':0,'resets_at':None},'seven_day_opus':{'utilization':None,'resets_at':None},'seven_day_oauth_apps':{'utilization':-1,'resets_at':'invalid'},'model_scoped':[{'display_name':'Test model','utilization':100,'resets_at':'2026-10-08T21:00:00+09:00'}]}}}})
            continue
        emit({'type':'control_response','response':{'subtype':'success','request_id':value['request_id'],'response':{'models':models}}})
        continue
    with (root/'requests.jsonl').open('a') as out: out.write(json.dumps(value)+'\n')
    emit({'type':'system','subtype':'init','model':'claude-sonnet-test','tools':['Bash'] if scenario == 'tools' else []})
    if scenario == 'error':
        emit({'type':'result','subtype':'error_during_execution','is_error':True,'errors':['rate_limit']})
        continue
    if scenario == 'tool_request':
        emit({'type':'control_request','request_id':'bad','request':{'subtype':'can_use_tool','tool_name':'Bash'}})
        continue
    emit({'type':'stream_event','event':{'type':'content_block_delta','delta':{'type':'thinking_delta','thinking':'private'}}})
    answer = '{"sentences":[{"id":0,"translation":"문장 번역"}]}' if scenario == 'translation' else '한국어 답변 [p. 1]'
    for chunk in [answer[:3],answer[3:]]:
        emit({'type':'stream_event','event':{'type':'content_block_delta','delta':{'type':'text_delta','text':chunk}}})
    emit({'type':'assistant','message':{'model':'claude-sonnet-test','content':[{'type':'text','text':answer}]}})
    time.sleep(0.3 if scenario in ['queue','stop'] else 0.01)
    if scenario == 'disconnect': sys.exit(1)
    emit({'type':'result','subtype':'success','is_error':False,'result':answer,'usage':{'input_tokens':10,'cache_read_input_tokens':20,'cache_creation_input_tokens':30,'output_tokens':8}})
