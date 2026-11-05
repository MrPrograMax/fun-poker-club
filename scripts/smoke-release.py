#!/usr/bin/env python3
"""Exercise a macOS/Linux release launcher from an unrelated working directory."""
import json
import os
from pathlib import Path
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
        env = {**os.environ, 'LISTEN_ADDR': f'127.0.0.1:{port}', 'DATA_DIR': '', 'PATH': '/usr/bin:/bin'}
        state = {'version': 1, 'config': {'name': 'Release smoke test'}, 'seats': [], 'library': [], 'step': 'settings'}
        launcher = app / ('start.command' if sys.platform == 'darwin' else 'start.sh')
        for iteration in range(2):
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
        print('PASS: binary launcher, embedded UI, paths with spaces, saved data and restart without Go')


if __name__ == '__main__':
    main()
