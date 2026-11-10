#!/usr/bin/env python3
"""Test direct desktop downloads using isolated data and a fake browser opener."""
import json
import os
from pathlib import Path
import plistlib
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent


def main():
    asset = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory(prefix='until morning desktop ') as scratch:
        workspace = Path(scratch)
        download = workspace / 'Downloads'
        download.mkdir()
        app = None
        if asset.suffix == '.pkg':
            expanded = workspace / 'expanded package'
            subprocess.run(['pkgutil', '--expand-full', str(asset), str(expanded)], check=True)
            candidates = list(expanded.rglob('Until Morning.app'))
            assert len(candidates) == 1, 'Installer must contain exactly one application'
            app = download / 'Until Morning.app'
            shutil.copytree(candidates[0], app, symlinks=True)
            info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
            executable = app / 'Contents/MacOS' / info['CFBundleExecutable']
            for name in (info['CFBundleExecutable'], 'until-morning-server'):
                archs = subprocess.check_output(['lipo', '-archs', str(app / 'Contents/MacOS' / name)], text=True).split()
                assert set(archs) == {'x86_64', 'arm64'}, archs
            subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
        else:
            executable = download / asset.name
            shutil.copy2(asset, executable)
            executable.chmod(0o755)
        other = workspace / 'unrelated working directory'
        other.mkdir()
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        url = f'http://127.0.0.1:{port}/'
        opened = workspace / 'opened-urls.txt'
        fake_bin = workspace / 'bin'
        fake_bin.mkdir()
        if sys.platform == 'win32':
            # A real executable shadows rundll32; a .cmd file cannot intercept exec.Command.
            probe = workspace / 'browser-probe.go'
            probe.write_text('''package main
import ("net/http"; "os")
func main() {
 u := os.Args[len(os.Args)-1]
 r,e := http.Get(u+"api/health"); if e!=nil || r.StatusCode!=200 { os.Exit(1) }; r.Body.Close()
 f,e := os.OpenFile(os.Getenv("BROWSER_RECORD"),os.O_APPEND|os.O_CREATE|os.O_WRONLY,0600); if e!=nil { os.Exit(1) }; defer f.Close(); f.WriteString(u+"\\n")
}
''')
            subprocess.run(['go', 'build', '-o', str(fake_bin / 'rundll32.exe'), str(probe)], check=True)
        else:
            probe = workspace / 'browser-probe.py'
            probe.write_text('''import os,sys
from urllib.request import urlopen
with urlopen(sys.argv[1]+'api/health',timeout=5) as r: assert r.status==200
with open(os.environ['BROWSER_RECORD'],'a') as f: f.write(sys.argv[1]+'\\n')
''')
            opener = fake_bin / ('open' if sys.platform == 'darwin' else 'xdg-open')
            opener.write_text(f'#!/bin/sh\nexec {shlex.quote(sys.executable)} {shlex.quote(str(probe))} "$@"\n')
            opener.chmod(0o755)
        env = {**os.environ, 'LISTEN_ADDR': f'127.0.0.1:{port}', 'BROWSER_RECORD': str(opened),
               'PATH': str(fake_bin) + os.pathsep + os.environ.get('PATH', '')}
        env.pop('DATA_DIR', None)
        if sys.platform == 'win32':
            env['LOCALAPPDATA'] = str(workspace / 'user data')
            storage = workspace / 'user data' / 'Until Morning'
        elif sys.platform == 'darwin':
            # Never redirect HOME or touch the actual user's application support directory.
            storage = workspace / 'user data' / 'Until Morning'
            env['DATA_DIR'] = str(storage)
        else:
            env['XDG_DATA_HOME'] = str(workspace / 'user data')
            storage = workspace / 'user data' / 'until-morning'
        state = {'version': 1, 'config': {'name': 'Desktop migration'}, 'seats': [], 'library': [], 'step': 'settings', 'game': None}
        legacy = download / 'data'
        legacy.mkdir()
        (legacy / 'archives').mkdir()
        legacy_snapshot = json.dumps({'revision': 7, 'state': state}).encode()
        (legacy / 'state.json').write_bytes(legacy_snapshot)
        archived = b'{"id":"old-game","finished":true,"game":{"id":"old-game"}}'
        (legacy / 'archives/old-game.json').write_bytes(archived)
        if sys.platform == 'darwin':
            shutil.copytree(legacy, storage)

        def get(path):
            with urlopen(url + path, timeout=3) as response:
                return response.read()

        for iteration in range(2):
            opened.unlink(missing_ok=True)
            with (workspace / 'server.log').open('w') as logs:
                process = subprocess.Popen([str(executable)], cwd=other, env=env, stdin=subprocess.DEVNULL,
                                           stdout=logs, stderr=logs, start_new_session=sys.platform != 'win32')
                try:
                    deadline = time.monotonic() + 20
                    while True:
                        if process.poll() is not None:
                            raise RuntimeError((workspace / 'server.log').read_text())
                        try:
                            assert json.loads(get('api/health'))['status'] == 'ok'
                            if opened.exists() and opened.read_text().splitlines() == [url]: break
                        except (URLError, TimeoutError):
                            pass
                        if time.monotonic() >= deadline: raise RuntimeError('App/browser did not become ready')
                        time.sleep(.1)
                    for name in ('engine.js', 'app.js', 'styles.css'):
                        assert get(name) == (ROOT / 'web/static' / name).read_bytes(), name
                    assert json.loads(get('api/state'))['state'] == state
                    assert (storage / 'archives/old-game.json').read_bytes() == archived
                    state['config']['name'] = 'Saved after moving the application'
                    snapshot = json.loads(get('api/state'))
                    payload = json.dumps({'revision': snapshot['revision'], 'state': state}).encode()
                    with urlopen(Request(url + 'api/state', data=payload, method='PUT', headers={'Content-Type':'application/json'})) as response:
                        assert response.status == 200
                    assert json.loads((storage / 'state.json').read_text())['state'] == state
                    assert (legacy / 'state.json').read_bytes() == legacy_snapshot
                    assert not (other / 'data').exists()
                finally:
                    process.terminate()
                    try: process.wait(timeout=12)
                    except subprocess.TimeoutExpired:
                        print((workspace / 'server.log').read_text(), file=sys.stderr)
                        if sys.platform == 'win32': process.kill()
                        else: os.killpg(process.pid, signal.SIGKILL)
                        process.wait()
                        raise RuntimeError('Desktop app did not stop its server')
                with socket.socket() as connection:
                    assert connection.connect_ex(('127.0.0.1', port)) != 0, 'Server survived quitting the desktop app'
            if iteration == 0:
                moved = workspace / 'Moved application'
                moved.mkdir()
                if app:
                    new_app = moved / app.name
                    shutil.move(app, new_app)
                    executable = new_app / executable.relative_to(app)
                    app = new_app
                else:
                    executable = Path(shutil.move(executable, moved / executable.name))
        print('PASS: direct launch, ready browser, current assets, persistent data after moving app, unchanged legacy save, clean shutdown')


if __name__ == '__main__':
    main()
