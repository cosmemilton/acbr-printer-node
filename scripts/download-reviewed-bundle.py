#!/usr/bin/env python3
"""Fetch immutable reviewed bytes from the release or its temporary Git transport."""
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request


def main():
    if len(sys.argv) != 3:
        raise ValueError('Use download-reviewed-bundle.py MANIFEST DIRECTORY')
    manifest = pathlib.Path(sys.argv[1])
    reviewed = json.loads(manifest.read_text())
    if (reviewed.get('repository') != 'cosmemilton/acbr-printer-node'
            or reviewed.get('name') != 'cosmemilton-acbr-printer-node'
            or not re.fullmatch(r'\d+\.\d+\.\d+', reviewed.get('version', ''))
            or reviewed.get('tag') != 'v' + reviewed['version']
            or reviewed.get('file') != reviewed['name'] + '-' + reviewed['version'] + '.tgz'
            or not re.fullmatch(r'[a-f0-9]{40}', reviewed.get('transportCommit', ''))
            or reviewed.get('transportRef') != 'refs/heads/npm-reviewed-' + reviewed['version']
            or not re.fullmatch(r'[a-f0-9]{64}', reviewed.get('sha256', ''))
            or not isinstance(reviewed.get('bytes'), int) or not 0 < reviewed['bytes'] < 100 * 1024 * 1024):
        raise ValueError('Invalid reviewed transport manifest')
    directory = pathlib.Path(sys.argv[2]).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / reviewed['file']
    url = 'https://github.com/{repository}/releases/download/{tag}/{file}'.format(**reviewed)
    try:
        with urllib.request.urlopen(url, timeout=120) as response, target.open('wb') as output:
            count = 0
            for chunk in iter(lambda: response.read(1024 * 1024), b''):
                count += len(chunk)
                if count > reviewed['bytes']:
                    raise ValueError('Release asset exceeds reviewed bytes')
                output.write(chunk)
        source = 'GitHub Release'
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        subprocess.run(['git', 'fetch', '--no-tags', '--depth=1',
                        'https://github.com/' + reviewed['repository'] + '.git', reviewed['transportRef']], check=True)
        fetched = subprocess.check_output(['git', 'rev-parse', 'FETCH_HEAD'], text=True).strip()
        if fetched != reviewed['transportCommit']:
            raise ValueError('Transport reference changed after review')
        with target.open('wb') as output:
            subprocess.run(['git', 'show', fetched + ':' + reviewed['file']], stdout=output, check=True)
        source = 'temporary Git transport'
    with target.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    if target.stat().st_size != reviewed['bytes'] or actual != reviewed['sha256']:
        raise ValueError('Downloaded bytes differ from reviewed package')
    (directory / 'REVIEWED_BUNDLE.json').write_text(json.dumps(reviewed, indent=2) + '\n')
    (directory / (reviewed['file'] + '.sha256')).write_text(reviewed['sha256'] + '  ' + reviewed['file'] + '\n')
    print('Reviewed tarball verified from ' + source + ': ' + reviewed['sha256'])


if __name__ == '__main__':
    main()
