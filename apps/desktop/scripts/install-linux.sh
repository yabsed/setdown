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
  echo "Could not build the Setdown executable: $source_dir/setdown" >&2
  exit 1
fi

mkdir -p "$app_dir" "$applications_dir" "$icons_dir"
# 실행 중인 ELF 파일은 제자리 overwrite할 수 없다(ETXTBSY). 나머지 묶음을
# 갱신한 뒤 실행 파일은 새 inode에 복사하고 rename하여 원자적으로 교체한다.
for source_item in "$source_dir"/*; do
  if [[ "${source_item##*/}" == "setdown" ]]; then
    continue
  fi
  cp -a "$source_item" "$app_dir/"
done
install -m 0755 "$source_dir/setdown" "$app_dir/.setdown-update"
mv -f "$app_dir/.setdown-update" "$app_dir/setdown"
install -m 0644 "$project_dir/build/icon.png" "$icons_dir/setdown.png"

escaped_app_dir="${app_dir//&/\\&}"
sed "s|@APP_DIR@|$escaped_app_dir|g" \
  "$project_dir/build/setdown.desktop.in" \
  > "$applications_dir/setdown.desktop"
chmod 0755 "$applications_dir/setdown.desktop"

update-desktop-database "$applications_dir"
xdg-mime default setdown.desktop text/markdown
xdg-mime default setdown.desktop text/x-markdown
xdg-mime default setdown.desktop text/plain
xdg-mime default setdown.desktop application/pdf

echo "Setdown was installed successfully."
echo "Application directory: $app_dir"
echo "GNOME application ID: setdown.desktop"
