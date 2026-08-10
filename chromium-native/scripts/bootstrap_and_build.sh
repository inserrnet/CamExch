#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <persistent-work-root> <camexch-repository>" >&2
  exit 2
fi

mkdir -p "$1"
work_root="$(realpath "$1")"
repo_root="$(realpath "$2")"
version="$(tr -d '\r\n' < "$repo_root/chromium-native/VERSION")"
depot_tools="$work_root/depot_tools"
chromium_root="$work_root/chromium"
src="$chromium_root/src"
out_dir="$src/out/CamExchNative"

if [[ ! -d "$depot_tools/.git" ]]; then
  git clone --depth 1 https://chromium.googlesource.com/chromium/tools/depot_tools.git "$depot_tools"
else
  git -C "$depot_tools" fetch --depth 1 origin main
  git -C "$depot_tools" reset --hard origin/main
fi
export PATH="$depot_tools:$PATH"

if [[ ! -d "$src/.git" ]]; then
  mkdir -p "$chromium_root"
  (
    cd "$chromium_root"
    fetch --nohooks android
  )
fi

git -C "$src" fetch --depth 1 origin "refs/tags/$version:refs/tags/$version"
git -C "$src" reset --hard "$version"
git -C "$src" clean -ffd

(
  cd "$chromium_root"
  gclient sync --delete_unversioned_trees --nohooks
)
(
  cd "$src"
  gclient runhooks
)

python3 "$repo_root/chromium-native/scripts/apply_overlay.py" --checkout "$src"

mkdir -p "$out_dir"
cp "$repo_root/chromium-native/args.gn" "$out_dir/args.gn"
gn gen "$out_dir"
autoninja -C "$out_dir" chrome_public_apk

apk="$out_dir/apks/ChromePublic.apk"
test -f "$apk"
mkdir -p "$repo_root/chromium-native/artifacts"
cp "$apk" "$repo_root/chromium-native/artifacts/CamExch-Native-${version}-arm64.apk"
sha256sum "$repo_root/chromium-native/artifacts/CamExch-Native-${version}-arm64.apk" \
  > "$repo_root/chromium-native/artifacts/SHA256SUMS.txt"
