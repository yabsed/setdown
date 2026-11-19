#!/usr/bin/env bash
# Runs VS Code with a separate profile on an isolated display and records memory.
# usage: run.sh <folder holding bridge/, also receives bridge.jsonl and mem.log> <Setdown repository>
# Needs ~/.cache/setdown-vscode-experiment with user-data/, extensions/ (redhat.java installed) and project/.
# Not run yet: see section 7 of ../report.md.
set -u
X=$HOME/.cache/setdown-vscode-experiment; S=$1; REPO=$2
CG=/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)
: > "$S/mem.log"; rm -f "$S/bridge.jsonl"
( while sleep 10; do
    echo "== $(date +%H:%M:%S) cgroup current=$(( $(cat "$CG/memory.current") / 1048576 )) MB" >> "$S/mem.log"
    ps -eo rss,args | grep -F -e "$X" -e "gradle" | grep -v -e grep -e "run.sh" | awk '{printf "%6d MB  %s\n",$1/1024,substr($0,index($0,$2),120)}' | sort -rn | head -10 >> "$S/mem.log"
  done ) &
SAMPLER=$!
BRIDGE_OUT="$S/bridge.jsonl" BRIDGE_FILE="$X/project/src/main/java/com/opensurvey/surveys/SurveysApplication.java" \
  timeout 480 "$REPO/apps/desktop/scripts/with-isolated-display.sh" /usr/share/code/code \
    --user-data-dir="$X/user-data" --extensions-dir="$X/extensions" --extensionDevelopmentPath="$S/bridge" \
    --disable-workspace-trust --logExtensionHostCommunication --enable-logging=stderr --disable-gpu --new-window "$X/project" \
    > "$X/code.log" 2>&1
echo "== exit=$? peak=$(( $(cat "$CG/memory.peak") / 1048576 )) MB" >> "$S/mem.log"
kill $SAMPLER 2>/dev/null
# A Gradle daemon started here would outlive the editor; end what is left in this group.
for p in $(cat "$CG/cgroup.procs"); do [ "$p" != "$$" ] && kill "$p" 2>/dev/null; done
exit 0
