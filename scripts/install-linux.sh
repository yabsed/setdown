#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
app_dir="$data_dir/setdown"
applications_dir="$data_dir/applications"
icons_dir="$data_dir/icons/hicolor/512x512/apps"

cd "$project_dir"
npm run build
npx electron-builder --linux dir

source_dir="$project_dir/release/linux-unpacked"
if [[ ! -x "$source_dir/setdown" ]]; then
  echo "Setdown 실행 파일을 만들지 못했습니다: $source_dir/setdown" >&2
  exit 1
fi

mkdir -p "$app_dir" "$applications_dir" "$icons_dir"
cp -a "$source_dir/." "$app_dir/"
install -m 0644 "$project_dir/build/icon.png" "$icons_dir/setdown.png"

escaped_app_dir="${app_dir//&/\\&}"
sed "s|@APP_DIR@|$escaped_app_dir|g" \
  "$project_dir/build/setdown.desktop.in" \
  > "$applications_dir/setdown.desktop"
chmod 0755 "$applications_dir/setdown.desktop"

update-desktop-database "$applications_dir"
xdg-mime default setdown.desktop text/markdown
xdg-mime default setdown.desktop text/x-markdown

echo "Setdown을 설치했습니다."
echo "앱 위치: $app_dir"
echo "GNOME 앱 ID: setdown.desktop"
