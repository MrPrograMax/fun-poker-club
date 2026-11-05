#!/usr/bin/env python3
"""Build self-contained release archives without extra Python dependencies."""
import argparse
import hashlib
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
TARGETS = {
    'macos-arm64': ('darwin', 'arm64'),
    'macos-amd64': ('darwin', 'amd64'),
    'windows-amd64': ('windows', 'amd64'),
    'windows-arm64': ('windows', 'arm64'),
    'linux-amd64': ('linux', 'amd64'),
    'linux-arm64': ('linux', 'arm64'),
}
INSTRUCTIONS = '''Until Morning · Poker with friends

1. Распакуйте архив целиком в отдельную папку.
2. Запустите {launcher}.
3. Браузер откроется автоматически — можно настраивать игру.
   Если окно не открылось, перейдите на http://localhost:8080 вручную.

Go, Docker и Node.js не нужны. Интерфейс встроен в приложение.
Окно запуска должно оставаться открытым во время игры.
Для остановки нажмите Ctrl+C в этом окне.

Игра и сохранённые имена находятся в data/state.json рядом с запускатором.
Перед обновлением сделайте копию папки data и перенесите её в новую версию.
Если порт 8080 занят, завершите предыдущий экземпляр или задайте LISTEN_ADDR.
Сервер по умолчанию доступен только на этом компьютере.
Сборки пока без цифровой подписи. При первом запуске macOS или Windows
могут попросить разрешить открытие приложения от неизвестного разработчика.

Исходники и обновления: https://github.com/MrPrograMax/fun-poker-club
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('version', help='Release tag, e.g. v0.1.0')
    parser.add_argument('--target', choices=TARGETS, action='append', help='Default: all platforms')
    args = parser.parse_args()
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', args.version):
        parser.error('Use a version like v0.1.0 or v0.1.0-beta.1')
    output = ROOT / 'build' / 'releases' / args.version
    output.mkdir(parents=True, exist_ok=True)
    checksums = []
    for target in args.target or TARGETS:
        goos, goarch = TARGETS[target]
        name = f'until-morning-{args.version}-{target}'
        with tempfile.TemporaryDirectory(prefix='until-morning-release-') as scratch:
            folder = Path(scratch) / name
            folder.mkdir()
            binary = folder / ('until-morning.exe' if goos == 'windows' else 'until-morning')
            env = {**os.environ, 'GOOS': goos, 'GOARCH': goarch, 'CGO_ENABLED': '0'}
            print(f'Building {target}...', flush=True)
            subprocess.run(['go', 'build', '-trimpath', '-ldflags=-s -w', '-o', str(binary), '.'], cwd=ROOT, env=env, check=True)
            binary.chmod(0o755)
            launchers = ['start.cmd'] if goos == 'windows' else ['start.sh']
            if goos == 'darwin':
                launchers.append('start.command')
            for launcher in launchers:
                path = folder / launcher
                path.write_bytes((ROOT / launcher).read_bytes())
                path.chmod(0o644 if launcher.endswith('.cmd') else 0o755)
            launcher = 'start.cmd' if goos == 'windows' else 'start.command' if goos == 'darwin' else './start.sh'
            (folder / 'START-HERE.txt').write_text(INSTRUCTIONS.format(launcher=launcher), encoding='utf-8')
            archive = output / f'{name}.zip'
            with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as package:
                for path in sorted(folder.iterdir()):
                    package.write(path, f'{name}/{path.name}')
            checksums.append(f'{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}')
    (output / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n', encoding='utf-8')
    print(f'Release files: {output}')


if __name__ == '__main__':
    main()
