#!/usr/bin/env python3
"""docs-lint.py [ROOT]: checks the plugins' docs (plugins/*/**.md and .txt) against each other and the scripts beside
them, so drift the docs review found can't come back. ROOT defaults to the repo's top; CI runs it.

Checks, each printing one line per problem, in the form docs-lint-allow.txt takes (`check<TAB>key`):
- rule:    a rule in docs-lint-rules.txt (`home<TAB>regex`) is stated outside its home doc, or is gone from its home.
           Home `-`: a rule the scripts enforce and print, which no doc states.
- flag:    a `--flag` in a doc's code (a code span or block) that no plugin script, hook or module has. A span or block
           line starting with another tool's command (gh, git, claude, ...) is that tool's, and isn't checked.
- link:    a relative markdown link whose file doesn't exist.
- release: a "from the release after X" note. A plugin doc ships with its code, so the feature it names is in the same
           release: the note is dead text once on main. migrations.md's From column is the record and is exempt.
- dup:     the same run of DUP_WORDS+ words in two docs (one rule, one home: point to the other doc instead).
A known hit is listed in docs-lint-allow.txt with a `#` line saying why; an allow line nothing matches fails too.
Prints "ok" or the problems; exits 1 on any.
"""
import os
import re
import subprocess
import sys
from urllib.parse import unquote

DUP_WORDS = 14
EXTERNAL = {"gh", "git", "claude", "jq", "curl", "npm", "npx", "node", "tsc", "python3", "pip3", "brew", "crontab",
            "ssh", "az", "acli", "ls", "grep", "sed", "find", "osascript", "open", "defaults", "launchctl", "tmux",
            "wezterm"}

root = sys.argv[1] if len(sys.argv) > 1 else subprocess.run(
    ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
os.chdir(root)


def walk(top):
    for d, dirs, files in os.walk(top):
        dirs[:] = sorted(x for x in dirs if not x.startswith(".") and x != "node_modules")
        for f in sorted(files):
            if not f.startswith("."):
                yield os.path.join(d, f)


docs, scripts = {}, []
for p in walk("plugins"):
    if p.endswith((".md", ".txt")):
        with open(p, encoding="utf-8") as fh:
            docs[p] = fh.read()
    elif ".test." not in os.path.basename(p) and not p.endswith(("LICENSE", ".html")):
        try:
            with open(p, encoding="utf-8") as fh:
                scripts.append(fh.read())
        except UnicodeDecodeError:
            pass
script_text = "\n".join(scripts)
hits = []  # (check, key)

# code: each fenced block line and each inline span, as (line number, text)
FENCE = re.compile(r"^\s*(`{3,}|~{3,})")


def lines_of(text):
    """(number, line, fenced) per line; a fence closes only on its own character, at least as long."""
    opener = None
    for n, line in enumerate(text.splitlines(), 1):
        m = FENCE.match(line)
        if m and opener is None:
            opener = m.group(1)
        elif m and m.group(1)[0] == opener[0] and len(m.group(1)) >= len(opener):
            opener = None
        else:
            yield n, line, opener is not None


def code_of(text):
    for n, line, fenced in lines_of(text):
        if fenced:
            yield n, line
        else:
            for m in re.finditer(r"(`+)(.+?)\1", line):
                yield n, m.group(2)


def prose_lines(text):
    return ((n, line) for n, line, fenced in lines_of(text) if not fenced)


# rule
rules = []
if os.path.exists("docs-lint-rules.txt"):
    for i, line in enumerate(open("docs-lint-rules.txt", encoding="utf-8"), 1):
        if line.strip() and not line.startswith("#"):
            try:
                home, rx = line.rstrip("\n").split("\t", 1)
                rules.append((home, rx, re.compile(rx)))
            except (ValueError, re.error) as e:
                sys.exit(f"bad docs-lint-rules.txt line {i} (want home<TAB>regex): {line.strip()} ({e})")
for home, rx, r in rules:
    if home != "-" and not r.search(docs.get(home, "")):
        hits.append(("rule", f"{rx} not in its home {home}"))
    for p, text in docs.items():
        if p != home and r.search(text):
            hits.append(("rule", f"{rx} stated in {p} (its home: {home})"))

# flag
FLAG = re.compile(r"(?<![\w-])--[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*")
seen = set()
for p, text in docs.items():
    # each command of a chain or pipe by its own first word, past `!`, `$` and VAR=value words
    spans = (s for _, code in code_of(text) for s in re.split(r"&&|\|\||[;|(]", code))
    for span in spans:
        first = (re.sub(r"^\s*[!$]?\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*", "", span).split() or [""])[0]
        if os.path.basename(first) in EXTERNAL:
            continue
        for flag in FLAG.findall(span):
            if (p, flag) in seen:
                continue
            seen.add((p, flag))
            if not re.search(re.escape(flag) + r"(?![a-z0-9_-])", script_text):
                hits.append(("flag", f"{p}: {flag}"))

# link
# inline links (an optional <…> and "title") and reference definitions `[ref]: target`
LINK = re.compile(r"\[[^\]]*\]\(<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\)|^\s*\[[^\]]+\]:\s*<?([^\s>]+)")
for p, text in docs.items():
    for n, line in prose_lines(text):
        for target in (a or b for a, b in LINK.findall(re.sub(r"`[^`]*`", "", line))):
            if re.match(r"^[a-z][a-z0-9+.-]*:|^#", target):
                continue
            path = os.path.normpath(os.path.join(os.path.dirname(p), unquote(target.split("#")[0])))
            if not os.path.exists(path):
                hits.append(("link", f"{p}: {target}"))

# release
for p, text in docs.items():
    if os.path.basename(p) == "migrations.md":
        continue
    # the phrase may wrap at any of its words; the key is the line it starts on
    for m in re.finditer(r"from\s+the\s+release\s+after\b", text, re.I):
        start = text.rfind("\n", 0, m.start()) + 1
        end = text.find("\n", start)
        hits.append(("release", f"{p}: {text[start:end if end >= 0 else None].strip()}"))

# dup: word runs shared by two docs, each run reported once per pair
words = {}
for p, text in docs.items():
    words[p] = re.findall(r"[a-z0-9]+(?:['._-][a-z0-9]+)*", text.lower())
where = {}
for p, ws in words.items():
    for i in range(len(ws) - DUP_WORDS + 1):
        where.setdefault(tuple(ws[i:i + DUP_WORDS]), set()).add(p)
for p, ws in sorted(words.items()):
    prev = set()
    for i in range(len(ws) - DUP_WORDS + 1):
        cur = {o for o in where[tuple(ws[i:i + DUP_WORDS])] if o > p}
        for o in sorted(cur - prev):  # a run with o starts here
            hits.append(("dup", f"{p} | {o}: {' '.join(ws[i:i + DUP_WORDS])}"))
        prev = cur

# allow list
allowed = set()
bad = 0
if os.path.exists("docs-lint-allow.txt"):
    reason = False  # a `#` line above, in the same blank-line-separated group
    for i, line in enumerate(open("docs-lint-allow.txt", encoding="utf-8"), 1):
        line = line.rstrip("\n")
        if not line.strip():
            reason = False
        elif line.startswith("#"):
            reason = True
        else:
            allowed.add(line)
            if not reason:
                print(f"docs-lint-allow.txt line {i} has no # line saying why above it: {line}")
                bad = 1
found = {f"{c}\t{k}" for c, k in hits}
for h in sorted(found - allowed):
    print(h)
    bad = 1
for a in sorted(allowed - found):
    print(f"stale docs-lint-allow.txt line: {a}")
    bad = 1
if not bad:
    print("ok")
sys.exit(bad)
