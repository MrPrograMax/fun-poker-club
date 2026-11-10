#!/usr/bin/env python3
"""Package existing macOS release archives into a universal native app installer."""
import argparse
import importlib.util
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('version')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('A macOS host with Xcode command-line tools is required')
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', args.version):
        parser.error('Invalid release version')
    output = ROOT / 'build' / 'releases' / args.version
    with tempfile.TemporaryDirectory(prefix='until-morning-pkg-') as scratch:
        temporary = Path(scratch)
        stage = temporary / 'applications'
        app = stage / 'Until Morning.app'
        macos = app / 'Contents' / 'MacOS'
        macos.mkdir(parents=True)
        launchers, servers = [], []
        for arch, swift_arch in [('arm64', 'arm64'), ('amd64', 'x86_64')]:
            name = f'until-morning-{args.version}-macos-{arch}'
            with zipfile.ZipFile(output / (name + '.zip')) as package:
                server = temporary / ('server-' + arch)
                server.write_bytes(package.read(name + '/until-morning'))
            servers.append(str(server))
            launcher = temporary / ('launcher-' + arch)
            subprocess.run(['xcrun', 'swiftc', '-O', '-target', swift_arch + '-apple-macosx11.0',
                            str(ROOT / 'packaging/macos/Launcher.swift'), '-o', str(launcher)], check=True)
            launchers.append(str(launcher))
        for inputs, name in [(servers, 'until-morning-server'), (launchers, 'UntilMorning')]:
            target = macos / name
            subprocess.run(['lipo', '-create', *inputs, '-output', str(target)], check=True)
            target.chmod(0o755)
            subprocess.run(['codesign', '--force', '--sign', '-', str(target)], check=True)
        info = {
            'CFBundleIdentifier': 'com.github.MrPrograMax.until-morning',
            'CFBundleName': 'Until Morning', 'CFBundleDisplayName': 'Until Morning',
            'CFBundleExecutable': 'UntilMorning', 'CFBundlePackageType': 'APPL',
            'CFBundleShortVersionString': args.version[1:].split('-')[0],
            'CFBundleVersion': args.version[1:].split('-')[0],
            'LSMinimumSystemVersion': '11.0', 'NSHighResolutionCapable': True,
            'LSApplicationCategoryType': 'public.app-category.games',
        }
        (app / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
        subprocess.run(['codesign', '--force', '--sign', '-', str(app)], check=True)
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
        package = output / f'until-morning-{args.version}-macos-universal.pkg'
        subprocess.run(['pkgbuild', '--component', str(app), '--install-location', '/Applications',
                        '--identifier', info['CFBundleIdentifier'], '--version', info['CFBundleVersion'],
                        str(package)], check=True)
    spec = importlib.util.spec_from_file_location('release_builder', ROOT / 'scripts/build-release.py')
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    builder.write_checksums(output)
    print('Created:', package)


if __name__ == '__main__':
    main()
