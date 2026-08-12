#!/usr/bin/env bash
# Watch what the background agents are doing, in plain English.
#   bash scripts/watch-agents.sh          # follow the most-recently-active agent live
#   bash scripts/watch-agents.sh --list   # list all agent transcripts, newest first
#   bash scripts/watch-agents.sh <id>     # follow a specific agent id
SUBS="$HOME/.claude/projects/-Users-sal-development-vorlac-llama-harness/02ee96d7-054d-4c9d-a7ac-c4dddd205471/subagents"

render() {  # reads a .jsonl on stdin, prints said:/did: lines
  /opt/homebrew/bin/python3 - <<'PY'
import sys,json
for line in sys.stdin:
    try: o=json.loads(line)
    except: continue
    m=o.get('message',o); c=m.get('content')
    if not isinstance(c,list): continue
    for b in c:
        if not isinstance(b,dict): continue
        if b.get('type')=='text' and b.get('text','').strip():
            print("  said:", b['text'].strip().replace(chr(10),' ')[:140])
        elif b.get('type')=='tool_use':
            i=b.get('input',{})
            what=i.get('file_path') or i.get('command') or i.get('description') or ''
            print("  did :", b.get('name'), "->", str(what)[:110])
PY
}

if [ "$1" = "--list" ]; then
  ls -lt "$SUBS"/agent-*.jsonl 2>/dev/null | awk '{print $6,$7,$8,"  ",$NF}'
  exit 0
fi
if [ -n "$1" ]; then FILE="$SUBS/agent-$1.jsonl"; else FILE=$(ls -t "$SUBS"/agent-*.jsonl 2>/dev/null | head -1); fi
[ -f "$FILE" ] || { echo "no agent transcript found"; exit 1; }
echo "watching: $(basename "$FILE")  (Ctrl-C to stop)"; echo
tail -n 40 -f "$FILE" | render
