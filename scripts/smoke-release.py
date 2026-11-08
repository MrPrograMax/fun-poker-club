#!/usr/bin/env python3
"""Exercise a macOS/Linux release launcher from an unrelated working directory."""
import json
import os
from pathlib import Path
import shlex
import signal
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import Request, urlopen
import zipfile


def main():
    archive = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory(prefix='until morning smoke ') as scratch:
        workspace = Path(scratch)
        with zipfile.ZipFile(archive) as package:
            package.extractall(workspace)
            for member in package.infolist():
                if not member.is_dir():
                    (workspace / member.filename).chmod((member.external_attr >> 16) & 0o777)
        app = next(workspace.glob('until-morning-*'))
        unrelated = workspace / 'other working directory'
        unrelated.mkdir()
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        url = f'http://127.0.0.1:{port}'
        browser_record = workspace / 'opened-urls.txt'
        browser_probe = workspace / 'browser-probe.py'
        browser_probe.write_text('''import json, os, sys
from urllib.request import urlopen
with urlopen(sys.argv[1] + 'api/health', timeout=5) as response:
    assert json.load(response)['status'] == 'ok'
with open(os.environ['BROWSER_RECORD'], 'a') as record:
    record.write(sys.argv[1] + '\\n')
''')
        fake_bin = workspace / 'bin'
        fake_bin.mkdir()
        browser_command = fake_bin / ('open' if sys.platform == 'darwin' else 'xdg-open')
        browser_command.write_text(f'#!/bin/sh\nexec {shlex.quote(sys.executable)} {shlex.quote(str(browser_probe))} "$@"\n')
        browser_command.chmod(0o755)
        env = {**os.environ, 'LISTEN_ADDR': f'127.0.0.1:{port}', 'DATA_DIR': '', 'PATH': f'{fake_bin}:/usr/bin:/bin', 'BROWSER_RECORD': str(browser_record)}
        state = {'version': 1, 'config': {'name': 'Release smoke test'}, 'seats': [], 'library': [], 'step': 'settings'}
        launcher = app / ('start.command' if sys.platform == 'darwin' else 'start.sh')
        for iteration in range(2):
            browser_record.unlink(missing_ok=True)
            with (workspace / 'server.log').open('w') as logs:
                process = subprocess.Popen([str(launcher)], cwd=unrelated, env=env, stdout=logs, stderr=logs, start_new_session=True)
                try:
                    deadline = time.monotonic() + 15
                    while True:
                        if process.poll() is not None:
                            raise RuntimeError((workspace / 'server.log').read_text())
                        try:
                            with urlopen(url + '/api/health', timeout=1) as response:
                                assert json.load(response)['status'] == 'ok'
                            break
                        except (URLError, TimeoutError):
                            if time.monotonic() >= deadline:
                                raise RuntimeError('Server did not become ready')
                            time.sleep(0.1)
                    with urlopen(url, timeout=3) as response:
                        assert 'Until Morning' in response.read().decode()
                    for name in ('app.js', 'engine.js', 'styles.css'):
                        with urlopen(url + '/' + name, timeout=3) as response:
                            assert response.read() == (Path(__file__).resolve().parent.parent / 'dist' / name).read_bytes(), f'Outdated embedded asset: {name}'
                    while not browser_record.exists() or not browser_record.read_text():
                        if time.monotonic() >= deadline:
                            raise RuntimeError('Browser opener was not called successfully')
                        time.sleep(0.1)
                    assert browser_record.read_text().splitlines() == [url + '/']
                    occupied = subprocess.run([str(launcher)], cwd=unrelated, env=env, input='\n', text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=10)
                    assert occupied.returncode != 0, 'Second server must reject the occupied port'
                    assert browser_record.read_text().splitlines() == [url + '/'], 'Failed launch opened a browser'
                    if iteration == 0:
                        payload = json.dumps({'revision': 0, 'state': state}).encode()
                        request = Request(url + '/api/state', data=payload, headers={'Content-Type': 'application/json'}, method='PUT')
                        with urlopen(request, timeout=3) as response:
                            assert json.load(response)['revision'] == 1
                    with urlopen(url + '/api/state', timeout=3) as response:
                        assert json.load(response)['state'] == state
                    assert json.loads((app / 'data' / 'state.json').read_text())['state'] == state
                    assert not (unrelated / 'data').exists()
                finally:
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait()
        print('PASS: launcher without Go, browser opening on the ready server, occupied port, current embedded assets, paths with spaces, saved data and restart')


if __name__ == '__main__':
    main()
