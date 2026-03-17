---
name: setup
description: One-command setup — authenticate via browser and configure Awareness Memory credentials.
user-invocable: true
disable-model-invocation: false
---

One-command Awareness Memory setup: authenticate via browser, select a memory, and write credentials to settings.json.

API base URL: https://awareness.market/api/v1

## Step 1 — Check existing credentials

First determine if the user already has working credentials. Check **two** sources:

### 1a. Check environment variables (from settings.json)

Read the current environment variables `AWARENESS_API_KEY` and `AWARENESS_MEMORY_ID`.
If both exist AND `AWARENESS_API_KEY` starts with `aw_` AND is NOT the placeholder `aw_your-api-key-here`,
and `AWARENESS_MEMORY_ID` is NOT `your-memory-id-here`:
  - Tell the user credentials are already configured.
  - Ask: "Do you want to re-configure? (yes/no)"
  - If no → stop here. Suggest running `/awareness-memory:session-start` instead.
  - If yes → continue to Step 2.

### 1b. Check ~/.awareness/credentials.json (left by npx @awareness-sdk/setup)

Run:
```bash
cat ~/.awareness/credentials.json 2>/dev/null
```

If the file exists and contains a valid `api_key` (starts with `aw_`):
  - Tell the user: "Found existing Awareness credentials (from a previous setup). Reusing them."
  - Extract the `api_key` and `api_base` values.
  - Skip Step 2 and Step 3 — jump directly to Step 4 (Memory selection) using this api_key.

If neither source has valid credentials → proceed to Step 2.

---

## Step 2 — Device Code Auth (browser login)

Run the entire auth flow in a **single Bash command**. This is critical — do NOT poll in a loop with separate Bash calls.

Run this exact script (substituting nothing — it is self-contained):

```bash
python3 -c "
import urllib.request, json, subprocess, sys, time, platform

API = 'https://awareness.market/api/v1'

# --- init ---
req = urllib.request.Request(API + '/auth/device/init', data=b'{}',
      headers={'Content-Type':'application/json'}, method='POST')
try:
    resp = json.load(urllib.request.urlopen(req, timeout=15))
except Exception as e:
    print('ERROR:NETWORK:' + str(e)); sys.exit(1)

dc   = resp['device_code']
uc   = resp['user_code']
intv = resp.get('interval', 5)

print('USER_CODE:' + uc)
sys.stdout.flush()

# --- open browser ---
url = 'https://awareness.market/cli-auth?code=' + uc
try:
    if platform.system() == 'Darwin':
        subprocess.run(['open', url], check=True, capture_output=True)
    elif platform.system() == 'Windows':
        subprocess.run(['start', '', url], shell=True, check=True, capture_output=True)
    else:
        subprocess.run(['xdg-open', url], check=True, capture_output=True)
    print('BROWSER:OPENED')
except Exception:
    print('BROWSER:FAILED:' + url)
sys.stdout.flush()

# --- poll (up to 200s) ---
for i in range(1, 41):
    time.sleep(intv)
    try:
        preq = urllib.request.Request(API + '/auth/device/poll',
               data=json.dumps({'device_code': dc}).encode(),
               headers={'Content-Type':'application/json'}, method='POST')
        pr = json.load(urllib.request.urlopen(preq, timeout=15))
    except Exception:
        if i % 4 == 0: print('POLL_ERROR:' + str(i))
        continue
    st = pr.get('status','')
    if st == 'approved':
        print('APPROVED:' + pr['api_key'])
        sys.exit(0)
    elif st == 'expired':
        print('EXPIRED'); sys.exit(1)
    if i % 4 == 0:
        print('WAITING:' + str(i) + '/40')
    sys.stdout.flush()

print('TIMEOUT'); sys.exit(1)
"
```

**Timeout for this Bash call: 300000 ms (5 minutes).**

### Parse the output

The script prints structured lines. Parse them:

| Output prefix | Meaning | Action |
|---------------|---------|--------|
| `USER_CODE:{code}` | The human-readable auth code | Show to user (see message below) |
| `BROWSER:OPENED` | Browser opened successfully | No action needed |
| `BROWSER:FAILED:{url}` | Could not open browser | Tell user to open the URL manually |
| `WAITING:{n}/40` | Still polling | Silently continue waiting |
| `POLL_ERROR:{n}` | Network blip during poll | Ignore unless many in a row |
| `APPROVED:{api_key}` | Success! | Extract the api_key, proceed to Step 3 |
| `EXPIRED` | Device code expired (10 min) | Tell user to run `/awareness-memory:setup` again |
| `TIMEOUT` | 40 polls exhausted, still pending | Ask user: keep waiting / start over / cancel |
| `ERROR:NETWORK:{msg}` | Cannot reach server at all | Tell user to check network connection |

### Show this message to the user IMMEDIATELY after launching the script

As soon as you see the `USER_CODE:` line in the output, tell the user:

```
Your authorization code is: {user_code}

A browser window should open. Please:
1. Sign in (or create an account) in the browser
2. Confirm the code matches: {user_code}
3. Click "Authorize CLI"

Waiting for authorization...
```

If you see `BROWSER:FAILED:{url}`, also add:
```
Could not open browser automatically. Please open this URL:
{url}
```

### Handle TIMEOUT (user still hasn't authorized after ~200 seconds)

Ask the user:
- "Keep waiting" → run the same script again (new device code, fresh 200s window)
- "Cancel" → stop setup

### Save credentials to ~/.awareness/ (for future reuse by npx @awareness-sdk/setup)

After getting the api_key:
```bash
mkdir -p ~/.awareness && printf '{"api_key":"%s","api_base":"https://awareness.market/api/v1"}\n' '{api_key}' > ~/.awareness/credentials.json && chmod 600 ~/.awareness/credentials.json
```

---

## Step 3 — Verify API Key

Verify the obtained API key works. Run:
```bash
curl -s -w "\nHTTP_STATUS:%{http_code}" https://awareness.market/api/v1/memories -H "Authorization: Bearer {api_key}"
```

Parse the output:
- Look at the `HTTP_STATUS:` line at the end.
- HTTP 200 → key is valid. The JSON body before it is the memory list — **save it** for Step 4 (no need to fetch again).
- HTTP 401/403 → tell user: "API key appears invalid. Run `/awareness-memory:setup` again."
- Network error → warn but continue (might be transient).

---

## Step 4 — Memory selection

### 4a. Parse memory list

Use the JSON response from Step 3 (already fetched). Parse it as a JSON array. Each memory object has at least `id` and `name`.

If Step 3 was skipped (reusing credentials from 1b), fetch the list now:
```bash
curl -s https://awareness.market/api/v1/memories -H "Authorization: Bearer {api_key}"
```

### 4b. Present choices

**If user has 0 memories:**
  - Tell user: "You don't have any memories yet. Let's create one!"
  - Jump to Step 4c.

**If user has 1+ memories:**
  - Display a numbered list:
    ```
    Your memories:
      1. {name_1}
      2. {name_2}
      ...
      N+1. Create new memory

    Select a memory (1-{N+1}) [1]:
    ```
  - Wait for user input.

**Handle user's choice:**
  - Valid number 1-N → use that memory's `id` and `name`
  - Number N+1 → jump to Step 4c
  - Empty/blank → default to 1 (first memory)
  - Invalid input → tell user valid range, ask again (max 3 retries, then default to 1)

### 4c. Create new memory (if selected)

Ask the user: "Describe what this memory is for (e.g. 'My startup project backend development'):"

If user gives empty input, use: "General-purpose memory for development workflow".

Create via wizard — run as a **single Bash command**:

```bash
python3 -c "
import urllib.request, json, sys

API  = 'https://awareness.market/api/v1'
KEY  = '{api_key}'
DESC = '''USER_DESCRIPTION_HERE'''

headers = {'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'}

# Step 1: wizard
wiz_body = json.dumps({'owner_id':'','locale':'en','messages':[{'role':'user','content': DESC}],'draft':{}}).encode()
wiz_req  = urllib.request.Request(API + '/wizard/memory_designer', data=wiz_body, headers=headers, method='POST')
try:
    wiz_resp = json.load(urllib.request.urlopen(wiz_req, timeout=30))
except Exception as e:
    print('ERROR:WIZARD:' + str(e)); sys.exit(1)

payload = wiz_resp.get('plan',{}).get('create_payload')
if not payload:
    print('ERROR:NO_PAYLOAD'); sys.exit(1)

# Step 2: create memory
create_req = urllib.request.Request(API + '/memories', data=json.dumps(payload).encode(), headers=headers, method='POST')
try:
    mem = json.load(urllib.request.urlopen(create_req, timeout=15))
except Exception as e:
    print('ERROR:CREATE:' + str(e)); sys.exit(1)

print('CREATED:' + mem['id'] + ':' + mem.get('name','New Memory'))
"
```

**Replace `USER_DESCRIPTION_HERE` with the user's description** (escape any single quotes by replacing `'` with `'\''`).

Parse output:
- `CREATED:{id}:{name}` → success, use these values
- `ERROR:WIZARD:...` or `ERROR:CREATE:...` → tell user: "Could not create memory automatically. Create one at https://awareness.market/dashboard, then run `/awareness-memory:setup` again."

---

## Step 5 — Write settings.json

### 5a. Find the settings.json file

The skill variable `${CLAUDE_SKILL_DIR}` points to this skill's directory (`skills/setup/`).
The plugin's `settings.json` is two levels up:

```
SETTINGS_PATH="${CLAUDE_SKILL_DIR}/../../settings.json"
```

Verify it exists:
```bash
[ -f "${CLAUDE_SKILL_DIR}/../../settings.json" ] && echo "SETTINGS_PATH:${CLAUDE_SKILL_DIR}/../../settings.json" || echo "SETTINGS_PATH:NOT_FOUND"
```

- If `SETTINGS_PATH:NOT_FOUND` → tell user: "Could not find plugin settings. Make sure the plugin is installed: `/plugin marketplace add edwin-hao-ai/Awareness-SDK` then `/plugin install awareness-memory@awareness`". Stop here.
- Otherwise → use the returned path.

### 5b. Write credentials

Use the Write tool (NOT Bash) to write the settings.json file. Content:

```json
{
  "env": {
    "AWARENESS_MCP_URL": "https://awareness.market/mcp",
    "AWARENESS_MEMORY_ID": "{memory_id}",
    "AWARENESS_API_KEY": "{api_key}",
    "AWARENESS_AGENT_ROLE": "builder_agent"
  }
}
```

---

## Step 6 — Final summary

Tell the user:

```
Setup complete!

  API Key:   {first 10 chars of api_key}...
  Memory:    {memory_name} ({memory_id})
  MCP URL:   https://awareness.market/mcp

To activate, restart Claude Code and then run:
  /awareness-memory:session-start
```

Clearly explain: a restart is needed because MCP connections are established at session start using the env vars from settings.json. The new credentials won't take effect until the next session.

---

## Error handling summary

| Scenario | Action |
|----------|--------|
| Network unreachable (init fails) | Stop with clear message, suggest checking connection |
| Browser won't open | Show manual URL from `BROWSER:FAILED` output |
| User never authorizes (TIMEOUT) | Ask: keep waiting (re-run script) or cancel |
| Device code expired (EXPIRED) | Tell user to re-run `/awareness-memory:setup` |
| API key invalid (401 on verify) | Tell user to re-run setup |
| No memories + wizard fails | Direct user to web dashboard |
| settings.json not found | Tell user to install plugin first |
| User gives invalid memory choice | Re-ask up to 3 times, then default to first |

## Rules

- Run the auth polling as a **single Bash call** using the Python script — NEVER poll with separate Bash calls in a loop
- All JSON parsing must use `python3 -c` for consistency (do NOT use `jq` or other tools)
- Never show the raw `device_code` to the user — only show `user_code`
- Never dump raw JSON responses — always summarize in plain language
- Always mask API keys in output (show only first 10 characters + "...")
- If $ARGUMENTS contains "force" or "--force", skip the "already configured" check in Step 1
- Be concise but friendly — this is the user's first experience with Awareness
