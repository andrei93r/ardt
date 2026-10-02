#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Host-side helper: enumerate the installed GUI applications and hint each one's
# toolkit, flagging Electron (the apps that silently run on XWayland and are the
# primary target of the Wayland-flag feature). Powers the app-compatibility
# matrix and the "pass the Wayland flag to the correct apps" auto-detection.
#
# Usage:
#   scripts/detect-app-toolkits.sh          # human summary + TSV table
#   scripts/detect-app-toolkits.sh --json   # JSON array, one object per app
set -u

JSON=0
ALL=0
for arg in "$@"; do
  case "$arg" in
    --json) JSON=1;;
    --all)  ALL=1;;
  esac
done

DIRS=(
  /usr/share/applications
  /usr/local/share/applications
  "$HOME/.local/share/applications"
  /var/lib/flatpak/exports/share/applications
  "$HOME/.local/share/flatpak/exports/share/applications"
  /var/lib/snapd/desktop/applications
)

# --- value readers -----------------------------------------------------------
field() { # file key
  sed -n "s/^$2=//p" "$1" 2>/dev/null | head -1
}

# --- evidence scanners -------------------------------------------------------
# The Electron-only markers. `chrome_*.pak`, `icudtl.dat` and
# `v8_context_snapshot.bin` are shared with Chromium/Chrome and must NOT be used,
# or every Chromium-family app is misread as Electron.
marker_in() { # dir
  local d="$1"
  [ -d "$d" ] || return 1
  # -L: snap/flatpak expose the revision through a symlinked `current`, and
  # find does not follow a symlink *starting point* without it.
  find -L "$d" -maxdepth 6 \( -name '*.asar' -o -name 'LICENSE.electron*' -o -name 'electron.asar' \) \
    -print -quit 2>/dev/null | grep -q .
}

# A library (substring) present anywhere in a directory tree.
lib_in() { # dir libsubstr
  local d="$1"
  [ -d "$d" ] || return 1
  find -L "$d" -maxdepth 6 -name "lib${2}*.so*" -print -quit 2>/dev/null | grep -q .
}

# Toolkit from an ELF binary via ldd.
toolkit_bin() { # path
  local b="$1" out
  [ -x "$b" ] || { echo unknown; return; }
  out="$(ldd "$b" 2>/dev/null)"
  grep -qi 'libgtk-4' <<<"$out" && { echo gtk4; return; }
  grep -qi 'libgtk-3' <<<"$out" && { echo gtk3; return; }
  grep -qi 'libQt6'   <<<"$out" && { echo qt6;  return; }
  grep -qi 'libQt5'   <<<"$out" && { echo qt5;  return; }
  grep -qi 'libcef'   <<<"$out" && { echo cef;  return; }
  grep -qi 'libwebkit2gtk' <<<"$out" && { echo webkitgtk; return; }
  grep -qi 'libflutter_linux_gtk' <<<"$out" && { echo flutter; return; }
  echo unknown
}

toolkit_dir() { # dir
  local d="$1"
  [ -d "$d" ] || { echo unknown; return; }
  # gtk-4 is unambiguous; then Qt before gtk-3, because a Qt app commonly
  # bundles GTK3 for platform integration (OnlyOffice, CEF apps).
  lib_in "$d" gtk-4 && { echo gtk4; return; }
  lib_in "$d" Qt6    && { echo qt6;  return; }
  lib_in "$d" Qt5    && { echo qt5;  return; }
  lib_in "$d" gtk-3 && { echo gtk3; return; }
  lib_in "$d" cef    && { echo cef;  return; }
  lib_in "$d" webkit2gtk && { echo webkitgtk; return; }
  lib_in "$d" flutter_linux_gtk && { echo flutter; return; }
  echo unknown
}

# --- one application ---------------------------------------------------------
json_escape() { sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' <<<"$1"; }

emit() { # id name kind exec toolkit electron evidence
  if [ "$JSON" = 1 ]; then
    printf '{"id":"%s","name":"%s","kind":"%s","exec":"%s","toolkit":"%s","electron":%s,"evidence":"%s"}\n' \
      "$(json_escape "$1")" "$(json_escape "$2")" "$3" "$(json_escape "$4")" "$5" \
      "$( [ "$6" = yes ] && echo true || echo false )" "$(json_escape "$7")"
  else
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$5" "$6" "$7"
  fi
}

scan() { # desktop-file
  local f="$1" id name exec_line kind appdir bin binpath dir toolkit electron evidence
  if [ "$ALL" = 0 ] && [ "$(field "$f" NoDisplay)" = true ]; then return 0; fi
  id="$(basename "$f" .desktop)"
  name="$(field "$f" 'Name[en]')"; [ -n "$name" ] || name="$(field "$f" Name)"
  exec_line="$(field "$f" Exec)"
  [ -n "$exec_line" ] || return 0
  # strip field codes and a leading env wrapper
  exec_line="$(sed 's/%[fFuUdDnNickvm]//g' <<<"$exec_line")"
  read -ra toks <<<"$exec_line"
  local i=0
  [ "${toks[0]:-}" = env ] && { i=1; while [ $i -lt ${#toks[@]} ] && [[ "${toks[$i]}" == *=* ]]; do i=$((i+1)); done; }
  bin="${toks[$i]:-}"
  [ -n "$bin" ] || return 0

  kind=deb
  appdir=""
  local flatpak_id snap_name flatpak_meta
  flatpak_id="$(field "$f" X-Flatpak)"
  if [ -n "$flatpak_id" ]; then
    kind=flatpak
    for base in /var/lib/flatpak/app "$HOME/.local/share/flatpak/app"; do
      [ -d "$base/$flatpak_id/current/active/files" ] && appdir="$base/$flatpak_id/current/active/files" && break
    done
    flatpak_meta=""
    for base in /var/lib/flatpak/app "$HOME/.local/share/flatpak/app"; do
      [ -f "$base/$flatpak_id/current/active/metadata" ] && flatpak_meta="$base/$flatpak_id/current/active/metadata" && break
    done
  elif [[ "$f" == /var/lib/snapd/desktop/applications/* ]]; then
    kind=snap
    snap_name="${id%%_*}"
    [ -d "/snap/$snap_name/current" ] && appdir="/snap/$snap_name/current"
  elif [[ "$bin" == *.AppImage || "$bin" == *.appimage ]]; then
    kind=appimage
    appdir="$bin"
  fi

  if [ "$kind" = deb ]; then
    binpath="$(command -v "$bin" 2>/dev/null)"
    [ -n "$binpath" ] || binpath="$bin"
    binpath="$(readlink -f "$binpath" 2>/dev/null || echo "$binpath")"
    dir="$(dirname "$binpath")"
    toolkit="$(toolkit_bin "$binpath")"
    [ "$toolkit" = unknown ] && toolkit="$(toolkit_dir "$dir")"
    # Search only the binary's own directory, plus its parent when the binary
    # lives in a `bin` subdirectory (e.g. /opt/App/bin/App) — never a broad
    # system root, which would find another app's markers.
    if marker_in "$dir"; then
      electron=yes; evidence="marker in $dir"
    else
      parent="$(dirname "$dir")"
      case "$dir" in
        */bin) case "$parent" in /|/usr|/opt|/home|/usr/*|/var/*|/snap) ;; *)
                 marker_in "$parent" && { electron=yes; evidence="marker in $parent"; };; esac;;
      esac
      # `Electron/<major>` (the user agent) is Electron-only; a bare "Electron"
      # matches GNOME Calculator's "Electron Mass"/"electronvolt" constants.
      if [ "${electron:-}" != yes ] && head -c 4000000 "$binpath" 2>/dev/null | strings 2>/dev/null | grep -qE 'Electron/[0-9]|electron\.asar'; then
        electron=yes; evidence="strings($binpath)"
      fi
    fi
    [ "${electron:-}" = yes ] || { electron=no; evidence=""; }
  elif [ "$kind" = appimage ]; then
    # Best-effort: `unsquashfs` only reads a type-2 AppImage it can find the
    # squashfs in. When it cannot, the row is `unknown` and the matrix skips it
    # (an AppImage can be inspected by hand with `--appimage-extract`).
    listing="$(unsquashfs -l "$bin" 2>/dev/null || true)"
    if   grep -qi 'libgtk-4' <<<"$listing"; then toolkit=gtk4
    elif grep -qi 'libgtk-3' <<<"$listing"; then toolkit=gtk3
    elif grep -qi 'libQt6'   <<<"$listing"; then toolkit=qt6
    elif grep -qi 'libQt5'   <<<"$listing"; then toolkit=qt5
    elif grep -qi 'libwebkit2gtk' <<<"$listing"; then toolkit=webkitgtk
    else toolkit=unknown; fi
    if grep -qiE '\.asar|LICENSE\.electron|electron\.asar' <<<"$listing"; then
      electron=yes; evidence="appimage contents"
    else
      electron=no; evidence=""
    fi
  else
    # A flatpak's own files/ holds only app-private libs; the toolkit comes from
    # the runtime it is built on.
    if [ "$kind" = flatpak ] && [ -n "${flatpak_meta:-}" ]; then
      case "$(sed -n 's/^runtime=//p' "$flatpak_meta" | head -1)" in
        org.gnome.Platform*)       toolkit=gtk4;;
        org.kde.Platform*6*)       toolkit=qt6;;
        org.kde.Platform*)         toolkit=qt5;;
        *)                         toolkit="$(toolkit_dir "$appdir")";;
      esac
    else
      toolkit="$(toolkit_dir "$appdir")"
    fi
    if marker_in "$appdir"; then
      electron=yes; evidence="marker in $appdir"
    else
      electron=no; evidence=""
    fi
  fi

  emit "$id" "$name" "$kind" "$exec_line" "$toolkit" "$electron" "$evidence"
}

# --- run ---------------------------------------------------------------------
rows="$(mktemp)"
for d in "${DIRS[@]}"; do
  [ -d "$d" ] || continue
  for f in "$d"/*.desktop; do
    [ -f "$f" ] || continue
    case "$f" in */.git*|*__pycache__*) continue;; esac
    scan "$f" >>"$rows" 2>/dev/null
  done
done

if [ "$JSON" = 1 ]; then
  cat "$rows"
  rm -f "$rows"
  exit 0
fi

echo "== Electron apps =="
awk -F'\t' '$5=="yes"{printf "  %-42s %-26s %-9s %s\n",$1,$2,$3,$6}' "$rows" | sort -u
echo
echo "== Qt apps =="
awk -F'\t' '$4=="qt5"||$4=="qt6"{printf "  %-42s %-26s %-9s %s\n",$1,$2,$3,$4}' "$rows" | sort -u
echo
echo "== Toolkit / kind summary =="
awk -F'\t' '{print $4"\t"$3}' "$rows" | sort | uniq -c | sort -rn
rm -f "$rows"
