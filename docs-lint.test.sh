#!/usr/bin/env bash
# docs-lint.py on small fixture trees: a clean one passes, and each check fails on its own bad fixture.
set -u
lint=$(cd "$(dirname "$0")" && pwd)/docs-lint.py
fails=0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# clean tree: a doc naming a script's flag, linking a file that exists, the rule only in its home
fixture() {
  rm -rf "$tmp/t" && mkdir -p "$tmp/t/plugins/p/skills/s"
  printf '#!/bin/sh\ncase $1 in --real) ;; esac\n' >"$tmp/t/plugins/p/tool"
  printf 'Run `tool --real`; see [b](skills/s/b.md). Gh: `gh pr merge --auto`.\nThe magic number is 1.35.\n' >"$tmp/t/plugins/p/a.md"
  printf 'Another doc.\n' >"$tmp/t/plugins/p/skills/s/b.md"
  printf 'plugins/p/a.md\t1\\.35\n' >"$tmp/t/docs-lint-rules.txt"
  : >"$tmp/t/docs-lint-allow.txt"
}
expect() { # expect NAME STATUS GREP: run the lint on $tmp/t, check its exit status and that its output has GREP
  out=$(python3 "$lint" "$tmp/t" 2>&1); st=$?
  if [ "$st" = "$2" ] && grep -qF -- "$3" <<<"$out"; then echo "ok   $1"; else echo "FAIL $1 (exit $st): $out"; fails=1; fi
}

fixture
expect clean 0 ok

fixture
printf 'Also 1.35 here.\n' >>"$tmp/t/plugins/p/skills/s/b.md"
expect rule-outside-home 1 $'rule\t1\\.35 stated in plugins/p/skills/s/b.md'

fixture
printf -- '-\t1\\.35\n' >"$tmp/t/docs-lint-rules.txt"
expect rule-scripts-only 1 $'rule\t1\\.35 stated in plugins/p/a.md (its home: -)'

fixture
sed -i.bak 's/1\.35/one/' "$tmp/t/plugins/p/a.md"
expect rule-gone-from-home 1 $'rule\t1\\.35 not in its home plugins/p/a.md'

fixture
printf 'Run `tool --gone`.\n```\ntool --also-gone\n```\n' >>"$tmp/t/plugins/p/skills/s/b.md"
expect flag-missing 1 $'flag\tplugins/p/skills/s/b.md: --gone'
expect flag-missing-in-block 1 $'flag\tplugins/p/skills/s/b.md: --also-gone'

fixture
printf 'See [x](../nowhere.md#top) and [web](https://example.com) and [here](#a).\n' >>"$tmp/t/plugins/p/skills/s/b.md"
expect link-broken 1 $'link\tplugins/p/skills/s/b.md: ../nowhere.md#top'

fixture
printf 'It prints more (from the release after the widget).\n' >>"$tmp/t/plugins/p/skills/s/b.md"
expect release-note 1 $'release\tplugins/p/skills/s/b.md: It prints more (from the release after the widget).'

fixture
printf '| m1 | the release after x | from the release after x |\n' >"$tmp/t/plugins/p/skills/s/migrations.md"
expect release-migrations-exempt 0 ok

fixture
dup='A session that ends its turn waiting on CI sends no report until the run is green or red again'
printf '%s.\n' "$dup" >>"$tmp/t/plugins/p/a.md"
printf 'Note: %s, always.\n' "$dup" >>"$tmp/t/plugins/p/skills/s/b.md"
expect dup-text 1 $'dup\tplugins/p/a.md | plugins/p/skills/s/b.md: a session that ends its turn'
# listed with a reason: passes
grep '^dup' <<<"$out" >"$tmp/t/docs-lint-allow.txt"
expect dup-allowed 0 ok

fixture
printf 'flag\tplugins/p/a.md: --never\n' >"$tmp/t/docs-lint-allow.txt"
expect allow-stale 1 $'stale docs-lint-allow.txt line: flag\tplugins/p/a.md: --never'

exit $fails
