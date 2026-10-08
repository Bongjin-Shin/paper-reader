#!/usr/bin/python3
"""Protocol fixture: no network, credentials, or model calls."""
import json
import os
from pathlib import Path
import sys

root = Path(os.environ['CODEX_HOME'])
scenario = (root / 'scenario').read_text() if (root / 'scenario').exists() else 'ok'
(root / 'process.json').write_text(json.dumps({
    'apiKeyInherited': bool(os.environ.get('OPENAI_API_KEY')),
    'accessTokenInherited': bool(os.environ.get('CODEX_ACCESS_TOKEN')),
    'args': sys.argv[1:], 'cwd': os.getcwd(),
}))

def send(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)

def notify(method, params):
    send({'method': method, 'params': params})

for line in sys.stdin:
    request = json.loads(line)
    with (root / 'requests.jsonl').open('a') as log:
        log.write(json.dumps(request, ensure_ascii=False) + '\n')
    method = request['method']
    params = request.get('params', {})
    if method == 'initialized':
        continue
    result = {}
    if method == 'initialize':
        result = {'userAgent': 'fixture'}
    elif method == 'account/read':
        result = {'account': {'type': 'chatgpt', 'planType': 'plus', 'email': 'private@example.test'}
                  if (root / 'signed-in').exists() else None, 'requiresOpenaiAuth': True}
    elif method == 'account/rateLimits/read':
        result = {'rateLimits': {'limitId':'codex', 'primary': {'usedPercent':25, 'windowDurationMins':300, 'resetsAt':1800000000}, 'secondary': {'usedPercent':40, 'windowDurationMins':10080, 'resetsAt':1800500000}}}
    elif method == 'account/login/start':
        result = {'type': 'chatgpt', 'loginId': 'login-1', 'authUrl': 'https://auth.openai.com/oauth/authorize?state=private'}
    elif method == 'account/login/cancel':
        result = {'status': 'canceled'}
    elif method == 'account/logout':
        (root / 'signed-in').unlink(missing_ok=True)
    elif method == 'model/list':
        result = {'data': [{'model': 'gpt-5.6-luna' if scenario != 'no-model' else 'other-model',
                           'defaultReasoningEffort': 'low', 'supportedReasoningEfforts': [{'reasoningEffort': 'none'}]}],
                  'nextCursor': None}
        if scenario == 'models' or scenario.startswith('chat-'):
            result['data'].append({'model': 'test-reasoner', 'displayName': 'Test Reasoner', 'isDefault': True,
                'defaultReasoningEffort': 'medium', 'supportedReasoningEfforts': [{'reasoningEffort': 'medium'}, {'reasoningEffort': 'high'}]})
    elif method == 'thread/start':
        result = {'thread': {'id': 'thread-1'}}
    elif method == 'turn/start':
        if scenario.startswith('chat-'):
            send({'id': request['id'], 'result': {'turn': {'id':'turn-1','status':'inProgress','items':[]}}})
            notify('item/started', {'threadId':'thread-1','turnId':'turn-1','item':{'id':'reasoning','type':'reasoning'}})
            notify('item/started', {'threadId':'thread-1','turnId':'turn-1','item':{'id':'answer','type':'agentMessage','phase':'final_answer'}})
            for thread, turn, item in [('other','turn-1','answer'),('thread-1','other','answer'),('thread-1','turn-1','other')]:
                notify('item/agentMessage/delta', {'threadId':thread,'turnId':turn,'itemId':item,'delta':'wrong input'})
            notify('item/agentMessage/delta', {'threadId':'thread-1','turnId':'turn-1','itemId':'answer','delta':'**잔차** $r_i^s$의 의미입니다. [p. 1]'})
            notify('account/rateLimits/updated', {'rateLimits':{'limitId':'codex','primary':{'usedPercent':31,'windowDurationMins':300,'resetsAt':1800000000}}})
            continue
        if scenario == 'crash':
            sys.exit(0)
        if scenario == 'slow':
            import time
            time.sleep(120)
        if scenario == 'tool':
            send({'id': 'approval', 'method': 'item/commandExecution/requestApproval', 'params': {}})
            continue
        result = {'turn': {'id': 'turn-1', 'status': 'inProgress', 'items': []}}
        # Deliberately send notifications before the turn/start acknowledgement.
        notify('item/completed', {'threadId': 'thread-other', 'turnId': 'turn-1',
                                 'item': {'type': 'agentMessage', 'text': '{"text":"wrong thread"}'}})
        notify('item/completed', {'threadId': 'thread-1', 'turnId': 'turn-1',
                                 'item': {'type': 'agentMessage', 'phase': 'commentary', 'text': 'thinking'}})
        if scenario == 'quota':
            notify('turn/completed', {'threadId': 'thread-1', 'turn': {'id': 'turn-1', 'status': 'failed',
                   'error': {'message': 'usage limit exceeded: private-provider-detail'}, 'items': []}})
        else:
            text = 'invalid' if scenario == 'malformed' else json.dumps({'text': '점근적인'}, ensure_ascii=False)
            if scenario == 'page' or scenario.startswith('page-stream'):
                source = json.loads(params['input'][0]['text'])
                answer = {'sentences': [{'id': s['id'], 'translation': '문장 ' + str(s['id']) + ' 번역' + ''.join(' ' + m['token'] for m in s.get('equations', []))} for s in source['sentences']]}
                text = json.dumps(answer, ensure_ascii=False)
            streamed = scenario.startswith('page-stream')
            if streamed:
                import time
                send({'id': request['id'], 'result': result})
                notify('item/started', {'threadId': 'thread-1', 'turnId': 'turn-1', 'item': {'id': 'thinking', 'type': 'agentMessage', 'phase': 'commentary'}})
                notify('item/agentMessage/delta', {'threadId': 'thread-1', 'turnId': 'turn-1', 'itemId': 'thinking', 'delta': 'ignore commentary'})
                notify('item/started', {'threadId': 'thread-1', 'turnId': 'turn-1', 'item': {'id': 'answer', 'type': 'agentMessage', 'phase': 'final_answer'}})
                for thread, turn, item in [('other', 'turn-1', 'answer'), ('thread-1', 'other', 'answer'), ('thread-1', 'turn-1', 'other')]:
                    notify('item/agentMessage/delta', {'threadId': thread, 'turnId': turn, 'itemId': item, 'delta': 'ignore unrelated'})
                for i, row in enumerate(answer['sentences']):
                    chunk = ('{"sentences":[' if i == 0 else ',') + json.dumps(row, ensure_ascii=False)
                    notify('item/agentMessage/delta', {'threadId': 'thread-1', 'turnId': 'turn-1', 'itemId': 'answer', 'delta': chunk})
                    if i == 0 and scenario == 'page-stream-gated':
                        deadline = time.monotonic() + 3
                        while not (root / 'preview-seen').exists():
                            if time.monotonic() > deadline:
                                sys.exit(1)
                            time.sleep(.005)
                    elif scenario == 'page-stream':
                        time.sleep(.15)
                notify('item/agentMessage/delta', {'threadId': 'thread-1', 'turnId': 'turn-1', 'itemId': 'answer', 'delta': ']}'})
                (root / 'final-sent').write_text('yes')
                if scenario == 'page-stream-fail':
                    notify('turn/completed', {'threadId': 'thread-1', 'turn': {'id': 'turn-1', 'status': 'failed', 'error': {'message': 'usage limit exceeded'}, 'items': []}})
                    continue
            notify('item/completed', {'threadId': 'thread-1', 'turnId': 'turn-1',
                                     'item': {'type': 'agentMessage', 'phase': 'final_answer', 'text': text}})
            notify('turn/completed', {'threadId': 'thread-1', 'turn': {'id': 'turn-1', 'status': 'completed', 'items': []}})
            if streamed:
                continue
    elif method == 'turn/steer':
        if scenario == 'chat-steer-fail':
            send({'id':request['id'],'error':{'code':-32600,'message':'turn already completing'}})
            continue
        result = {'turnId':'turn-1'}
        notify('item/completed', {'threadId':'thread-1','turnId':'turn-1','item':{'id':'answer','type':'agentMessage','phase':'final_answer','text':'**잔차** $r_i^s$의 의미입니다. 추가 질문도 반영했습니다. [p. 1]'}})
        notify('turn/completed', {'threadId':'thread-1','turn':{'id':'turn-1','status':'completed','items':[]}})
    elif method == 'turn/interrupt':
        notify('turn/completed', {'threadId':'thread-1','turn':{'id':'turn-1','status':'interrupted','items':[]}})
    elif method != 'thread/unsubscribe':
        send({'id': request['id'], 'error': {'code': -32601, 'message': 'unexpected method'}})
        continue
    send({'id': request['id'], 'result': result})
