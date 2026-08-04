#!/usr/bin/env bash
# Clonebox installer (macOS / Linux)
#
#   chmod +x install.sh && ./install.sh
#   ./install.sh --dry-run
#
# --dry-run prints everything it WOULD do without changing anything.
# Commands needing sudo are collected into elevated-commands.sh rather than
# hanging on a password prompt this script cannot answer reliably.

set -u

DRY_RUN=false
FORCE_POLICY=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --yes-equivalents) FORCE_POLICY="always" ;;
    --no-equivalents) FORCE_POLICY="never" ;;
    -h|--help)
      echo "Usage: ./install.sh [--dry-run] [--yes-equivalents|--no-equivalents]"
      echo "  --dry-run           show what would happen, change nothing"
      echo "  --yes-equivalents   substitute cross-OS equivalents without asking"
      echo "  --no-equivalents    never substitute; skip anything needing one"
      exit 0 ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$HERE/manifest.json"
LOG="$HERE/install-log.txt"
ELEVATED="$HERE/elevated-commands.sh"

if [ ! -f "$MANIFEST" ]; then
  echo "manifest.json not found next to this script. Aborting."
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "This script needs 'jq' to read manifest.json:"
  echo "  macOS:  brew install jq"
  echo "  Ubuntu: sudo apt install jq"
  exit 1
fi

SOURCE_PLATFORM=$(jq -r '.sourcePlatform' "$MANIFEST")
HOST_PLATFORM="linux"
[ "$(uname)" = "Darwin" ] && HOST_PLATFORM="darwin"
SAME_PLATFORM=false
[ "$SOURCE_PLATFORM" = "$HOST_PLATFORM" ] && SAME_PLATFORM=true

case "$HOST_PLATFORM" in
  darwin) HOST_LABEL="macOS" ;;
  linux) HOST_LABEL="Linux" ;;
  *) HOST_LABEL="$HOST_PLATFORM" ;;
esac

EQUIV_POLICY=$(jq -r '.equivalentPolicy // "ask"' "$MANIFEST")
[ -n "$FORCE_POLICY" ] && EQUIV_POLICY="$FORCE_POLICY"

# Prompts are read from /dev/tty, not stdin: the item loops are fed by process
# substitution, so a plain `read` would swallow the next manifest entry.
INTERACTIVE=false
if [ "$EQUIV_POLICY" = "ask" ] && [ -t 1 ] && [ -r /dev/tty ]; then
  INTERACTIVE=true
elif [ "$EQUIV_POLICY" = "ask" ]; then
  # No terminal to ask on — default to the safe choice rather than assuming yes
  EQUIV_POLICY="never"
  echo "No interactive terminal available; not substituting equivalents."
  echo "Re-run with --yes-equivalents to allow substitutions."
fi

# Returns 0 (yes) or 1 (no). Remembers "all"/"none" for the rest of the run.
ask_equivalent() {
  local label="$1" cmd="$2" note="$3"

  case "$EQUIV_POLICY" in
    always) return 0 ;;
    never) return 1 ;;
  esac

  if [ "$INTERACTIVE" != true ]; then return 1; fi

  echo "" > /dev/tty
  echo "  $label is not available on $HOST_LABEL." > /dev/tty
  echo "  Verified equivalent: $cmd" > /dev/tty
  [ -n "$note" ] && echo "  Note: $note" > /dev/tty

  local reply
  printf "  Install this equivalent? [y]es / [n]o / [a]ll / [s]kip all: " > /dev/tty
  read -r reply < /dev/tty
  case "$reply" in
    y|Y|yes) return 0 ;;
    a|A|all) EQUIV_POLICY="always"; echo "  -> substituting all remaining equivalents." > /dev/tty; return 0 ;;
    s|S) EQUIV_POLICY="never"; echo "  -> skipping all remaining equivalents." > /dev/tty; return 1 ;;
    *) return 1 ;;
  esac
}

ITEM_COUNT=$(jq '.items | length' "$MANIFEST")
echo "Clonebox — restoring $ITEM_COUNT items captured on $SOURCE_PLATFORM at $(jq -r '.createdAt' "$MANIFEST")"
$DRY_RUN && echo "DRY RUN — nothing will actually be installed."

if [ "$SAME_PLATFORM" = false ]; then
  echo ""
  echo "This manifest came from $SOURCE_PLATFORM, not $HOST_PLATFORM."
  echo "Compiled SDK folders will NOT run here and are skipped."
  echo "See COMPATIBILITY.md for what does and does not carry over."
fi
echo ""

: > "$LOG"
: > "$ELEVATED"
log() { echo "$1" | tee -a "$LOG"; }

detect_profile() {
  if [ -n "${ZSH_VERSION:-}" ] || [ "$(basename "${SHELL:-}")" = "zsh" ]; then
    echo "$HOME/.zshrc"
  elif [ -f "$HOME/.bashrc" ]; then
    echo "$HOME/.bashrc"
  else
    echo "$HOME/.profile"
  fi
}
PROFILE_FILE=$(detect_profile)

add_to_path_permanently() {
  local new_path="$1"
  if grep -qF "$new_path" "$PROFILE_FILE" 2>/dev/null; then
    echo "  Already on PATH: $new_path"
    return
  fi
  if $DRY_RUN; then
    echo "  [dry run] would append to $PROFILE_FILE: $new_path"
    return
  fi
  printf '\nexport PATH="%s:$PATH"\n' "$new_path" >> "$PROFILE_FILE"
  export PATH="$new_path:$PATH"
  echo "  Added to PATH (in $PROFILE_FILE): $new_path"
}

# ---------- Portable SDK folders ----------
SDK_COUNT=$(jq '[.items[] | select(.type == "portable-folder")] | length' "$MANIFEST")

if [ "$SDK_COUNT" -gt 0 ] && [ "$SAME_PLATFORM" = true ]; then
  echo "Portable SDKs in this package:"
  jq -r '.items[] | select(.type == "portable-folder") | "  - " + .name' "$MANIFEST"

  if $DRY_RUN; then
    DEST_ROOT="$HOME/sdks"
  else
    read -rp "Extract these to which folder? (e.g. ~/sdks): " DEST_ROOT
    DEST_ROOT="${DEST_ROOT/#\~/$HOME}"
    mkdir -p "$DEST_ROOT"
  fi

  # Process substitution (not a pipe) so PATH edits happen in THIS shell,
  # not a subshell that would discard them.
  while IFS= read -r item; do
    NAME=$(echo "$item" | jq -r '.name')
    ZIP_FILE=$(echo "$item" | jq -r '.zipFile')
    BIN_SUBDIR=$(echo "$item" | jq -r '.binSubdir // empty')
    ID=$(echo "$item" | jq -r '.id' | sed 's/portable://')
    DEST_FOLDER="$DEST_ROOT/$ID"

    if [ ! -f "$HERE/$ZIP_FILE" ]; then
      log "[FAIL] $NAME: archive not found in package"
      continue
    fi

    echo "Extracting $NAME -> $DEST_FOLDER"
    if $DRY_RUN; then
      echo "  [dry run] would extract and add to PATH"
      continue
    fi

    mkdir -p "$DEST_FOLDER"
    if unzip -q -o "$HERE/$ZIP_FILE" -d "$DEST_FOLDER"; then
      BIN_PATH="$DEST_FOLDER"
      if [ -n "$BIN_SUBDIR" ] && [ -d "$DEST_FOLDER/$BIN_SUBDIR" ]; then
        BIN_PATH="$DEST_FOLDER/$BIN_SUBDIR"
      fi
      add_to_path_permanently "$BIN_PATH"
      log "[OK] $NAME -> $DEST_FOLDER"
    else
      log "[FAIL] $NAME: extraction failed"
    fi
  done < <(jq -c '.items[] | select(.type == "portable-folder")' "$MANIFEST")
  echo ""

elif [ "$SDK_COUNT" -gt 0 ]; then
  while IFS= read -r item; do
    NAME=$(echo "$item" | jq -r '.name')
    VERSION=$(echo "$item" | jq -r '.version')
    EQ=$(echo "$item" | jq -r --arg os "$HOST_PLATFORM" '.equivalents[$os].cmd // empty')
    EQ_ELEV=$(echo "$item" | jq -r --arg os "$HOST_PLATFORM" '.equivalents[$os].needsElevation // false')
    if [ -n "$EQ" ] && ! ask_equivalent "$NAME (compiled binary can't cross OS)" "$EQ" ""; then
      log "[DECLINED] $NAME: equivalent declined"
    elif [ -n "$EQ" ]; then
      if [ "$EQ_ELEV" = "true" ]; then
        echo "sudo $EQ" >> "$ELEVATED"
        log "[DEFERRED-EQUIV] $NAME -> $HOST_LABEL equivalent queued for sudo: $EQ"
      elif $DRY_RUN; then
        echo "  [dry run] $EQ"
      elif eval "$EQ" >/dev/null 2>&1; then
        log "[OK-EQUIV] $NAME -> installed the $HOST_LABEL equivalent: $EQ"
      else
        log "[FAIL-EQUIV] $NAME: $EQ failed"
      fi
    elif echo "$NAME" | grep -qi flutter && command -v fvm >/dev/null 2>&1; then
      echo "Flutter: installing via fvm (zipped binary is not usable cross-OS)"
      $DRY_RUN || fvm install "$VERSION"
      log "[OK] Flutter via fvm"
    elif echo "$NAME" | grep -qi node && command -v nvm >/dev/null 2>&1; then
      echo "Node: installing via nvm"
      $DRY_RUN || nvm install "$VERSION"
      log "[OK] Node via nvm"
    else
      log "[SKIP] $NAME — cross-OS binary, install fvm/nvm or set up manually"
    fi
  done < <(jq -c '.items[] | select(.type == "portable-folder")' "$MANIFEST")
  echo ""
fi

# ---------- Package manager items ----------
# For each item: try the original command if its package manager exists here.
# Otherwise (or if it fails) fall back to the verified equivalent recorded in
# the manifest for THIS OS, and say clearly that a substitution happened.
run_install() {
  local label="$1" cmd="$2" elev="$3" is_equiv="$4" equiv_note="$5"

  if [ "$elev" = "true" ]; then
    echo "sudo $cmd" >> "$ELEVATED"
    if [ "$is_equiv" = "true" ]; then
      log "[DEFERRED-EQUIV] $label -> $HOST_LABEL equivalent queued for sudo: $cmd"
    else
      log "[DEFERRED] $label: needs sudo"
    fi
    return 0
  fi

  if $DRY_RUN; then
    if [ "$is_equiv" = "true" ]; then
      echo "  [dry run] $HOST_LABEL equivalent: $cmd"
    else
      echo "  [dry run] $cmd"
    fi
    return 0
  fi

  if eval "$cmd" >/dev/null 2>&1; then
    if [ "$is_equiv" = "true" ]; then
      log "[OK-EQUIV] $label -> installed the $HOST_LABEL equivalent: $cmd"
      [ -n "$equiv_note" ] && log "           note: $equiv_note"
    else
      log "[OK] $label"
    fi
    return 0
  fi
  return 1
}

while IFS= read -r item; do
  NAME=$(echo "$item" | jq -r '.name')
  SOURCE=$(echo "$item" | jq -r '.source')
  CMD=$(echo "$item" | jq -r '.installCmd')
  NEEDS_ELEV=$(echo "$item" | jq -r '.needsElevation // false')
  PORTABLE=$(echo "$item" | jq -r '.portable // false')

  EQUIV_CMD=$(echo "$item" | jq -r --arg os "$HOST_PLATFORM" '.equivalents[$os].cmd // empty')
  EQUIV_ELEV=$(echo "$item" | jq -r --arg os "$HOST_PLATFORM" '.equivalents[$os].needsElevation // false')
  EQUIV_NOTE=$(echo "$item" | jq -r --arg os "$HOST_PLATFORM" '.equivalents[$os].note // empty')
  EQUIV_MGR=$(echo "$item" | jq -r --arg os "$HOST_PLATFORM" '.equivalents[$os].manager // empty')

  TOOL_BIN="$SOURCE"
  case "$SOURCE" in
    brew-cask) TOOL_BIN="brew" ;;
    pip) TOOL_BIN="pip3" ;;
    vscode) TOOL_BIN="code" ;;
  esac

  ORIGINAL_USABLE=true
  command -v "$TOOL_BIN" >/dev/null 2>&1 || ORIGINAL_USABLE=false
  # A Windows-only manager is never usable here even if a same-named binary exists
  [ "$PORTABLE" != "true" ] && [ "$SAME_PLATFORM" = false ] && ORIGINAL_USABLE=false

  if [ "$ORIGINAL_USABLE" = true ]; then
    echo "Installing $NAME via $SOURCE..."
    if run_install "$NAME" "$CMD" "$NEEDS_ELEV" false ""; then
      continue
    fi
    # Original failed — try the equivalent as a fallback before giving up
    if [ -n "$EQUIV_CMD" ]; then
      echo "  $SOURCE install failed."
      if ask_equivalent "$NAME" "$EQUIV_CMD" "$EQUIV_NOTE"; then
        if run_install "$NAME" "$EQUIV_CMD" "$EQUIV_ELEV" true "$EQUIV_NOTE"; then
          continue
        fi
      else
        log "[DECLINED] $NAME: equivalent available but not installed by your choice"
        continue
      fi
    fi
    log "[FAIL] $NAME"
    continue
  fi

  # Original package manager unavailable here
  if [ -n "$EQUIV_CMD" ]; then
    EQUIV_BIN="$EQUIV_MGR"
    case "$EQUIV_MGR" in
      script) EQUIV_BIN="curl" ;;
      manual|none) EQUIV_BIN="" ;;
    esac
    if [ -n "$EQUIV_BIN" ] && ! command -v "$EQUIV_BIN" >/dev/null 2>&1; then
      log "[SKIP] $NAME: $HOST_LABEL equivalent needs '$EQUIV_BIN', which isn't installed"
      continue
    fi
    if ! ask_equivalent "$NAME" "$EQUIV_CMD" "$EQUIV_NOTE"; then
      log "[DECLINED] $NAME: $HOST_LABEL equivalent available but declined"
      continue
    fi
    if run_install "$NAME" "$EQUIV_CMD" "$EQUIV_ELEV" true "$EQUIV_NOTE"; then
      continue
    fi
    log "[FAIL-EQUIV] $NAME: $HOST_LABEL equivalent failed"
    continue
  fi

  if [ -n "$EQUIV_NOTE" ]; then
    log "[NO-EQUIV] $NAME: $EQUIV_NOTE"
  else
    log "[NO-EQUIV] $NAME ($SOURCE): not in the equivalence table — install manually"
  fi
done < <(jq -c '.items[] | select(.type == "package" and .installCmd != null)' "$MANIFEST")

# ---------- Deferred sudo commands ----------
if [ -s "$ELEVATED" ]; then
  chmod +x "$ELEVATED"
  echo ""
  echo "$(wc -l < "$ELEVATED") item(s) need sudo. Review then run:"
  echo "  bash $ELEVATED"
fi

# ---------- Manual items ----------
MANUAL_COUNT=$(jq '[.items[] | select(.type == "manual-note")] | length' "$MANIFEST")
if [ "$MANUAL_COUNT" -gt 0 ]; then
  echo ""
  echo "Needs manual attention:"
  jq -r '.items[] | select(.type == "manual-note") | "  - " + .name + (if .note then "\n      " + .note else "" end)' "$MANIFEST"
fi

echo ""
echo "----- Summary -----"
cat "$LOG"
echo ""
$DRY_RUN || echo "Log written to $LOG. Open a NEW terminal so PATH changes take effect."
