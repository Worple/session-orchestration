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
FENCE = re.compile(r"^\s*(```|~~~)")


def code_of(text):
    fenced = False
    for n, line in enumerate(text.splitlines(), 1):
        if FENCE.match(line):
            fenced = not fenced
        elif fenced:
            yield n, line
        else:
            for m in re.finditer(r"(`+)(.+?)\1", line):
                yield n, m.group(2)


def prose_lines(text):
    """Lines outside fenced blocks, with their numbers."""
    fenced = False
    for n, line in enumerate(text.splitlines(), 1):
        if FENCE.match(line):
            fenced = not fenced
        elif not fenced:
            yield n, line


# rule
rules = []
if os.path.exists("docs-lint-rules.txt"):
    for line in open("docs-lint-rules.txt", encoding="utf-8"):
        if line.strip() and not line.startswith("#"):
            home, rx = line.rstrip("\n").split("\t", 1)
            rules.append((home, rx, re.compile(rx)))
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
    for _, span in code_of(text):
        first = re.sub(r"^[!$]\s*", "", span.strip()).split(" ", 1)[0]
        if os.path.basename(first) in EXTERNAL:
            continue
        for flag in FLAG.findall(span):
            if (p, flag) in seen:
                continue
            seen.add((p, flag))
            if not re.search(re.escape(flag) + r"(?![a-z0-9_-])", script_text):
                hits.append(("flag", f"{p}: {flag}"))

# link
LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
for p, text in docs.items():
    for n, line in prose_lines(text):
        for target in LINK.findall(re.sub(r"`[^`]*`", "", line)):
            if re.match(r"^[a-z][a-z0-9+.-]*:|^#", target):
                continue
            path = os.path.normpath(os.path.join(os.path.dirname(p), target.split("#")[0]))
            if not os.path.exists(path):
                hits.append(("link", f"{p}: {target}"))

# release
for p, text in docs.items():
    if os.path.basename(p) == "migrations.md":
        continue
    for n, line in enumerate(text.splitlines(), 1):
        if re.search(r"from the release after", line, re.I):
            hits.append(("release", f"{p}: {line.strip()}"))
    # the phrase split over a line break
    for m in re.finditer(r"from the release\s*\n\s*after", text, re.I):
        hits.append(("release", f"{p}: line {text.count(chr(10), 0, m.start()) + 1}"))

# dup: word runs shared by two docs, each run reported once per pair
words = {}
for p, text in docs.items():
    words[p] = re.findall(r"[a-z0-9]+(?:['._-][a-z0-9]+)*", text.lower())
where = {}
for p, ws in words.items():
    for i in range(len(ws) - DUP_WORDS + 1):
        where.setdefault(tuple(ws[i:i + DUP_WORDS]), set()).add(p)
for p, ws in sorted(words.items()):
    i = 0
    while i <= len(ws) - DUP_WORDS:
        others = sorted(o for o in where[tuple(ws[i:i + DUP_WORDS])] if o > p)
        if not others:
            i += 1
            continue
        j = i + 1  # extend the run while the same others share it
        while j <= len(ws) - DUP_WORDS and set(others) <= where[tuple(ws[j:j + DUP_WORDS])]:
            j += 1
        for o in others:
            hits.append(("dup", f"{p} | {o}: {' '.join(ws[i:i + DUP_WORDS])}"))
        i = j + DUP_WORDS - 1

# allow list
allowed = set()
if os.path.exists("docs-lint-allow.txt"):
    for line in open("docs-lint-allow.txt", encoding="utf-8"):
        line = line.rstrip("\n")
        if line.strip() and not line.startswith("#"):
            allowed.add(line)
found = {f"{c}\t{k}" for c, k in hits}
bad = 0
for h in sorted(found - allowed):
    print(h)
    bad = 1
for a in sorted(allowed - found):
    print(f"stale docs-lint-allow.txt line: {a}")
    bad = 1
if not bad:
    print("ok")
sys.exit(bad)
