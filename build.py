"""Build an offline, self-contained HTML cartridge. Python standard library only.

The simulation modules are embedded as text and started inside a Blob Web Worker;
math, renderers and the app run on the main thread.
"""
from pathlib import Path
import argparse

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'src'

# Order matters: each module attaches globals the next ones read.
SIMULATION = ['math.js', 'weather.js', 'field.js', 'physics.js', 'agents.js',
              'observer.js', 'state.js', 'evaluation.js', 'runtime.js']
RENDERER = ['renderer.js', 'renderer-atelier.js']


def read(name):
    # Explicit UTF-8: the Windows default code page would otherwise corrupt or reject source.
    return (SRC / name).read_text(encoding='utf-8')


def join(names):
    return '\n'.join(read(n) for n in names)


def build():
    template = read('index.template.html').replace('/*__ATELIERCSS__*/', read('atelier.css'))
    app = read('app.js')
    for token, code in [('SIMULATION', join(SIMULATION)), ('MATH', read('math.js')),
                        ('RENDERER', join(RENDERER)), ('APP', app)]:
        if '</script' in code.lower():
            raise ValueError('Unexpected closing script tag in ' + token)
        template = template.replace('/*__' + token + '__*/', code)
    return template


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'index.html')
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # newline='\n' keeps the output byte-identical across Windows and Unix.
    args.output.write_text(build(), encoding='utf-8', newline='\n')
    print(f'{args.output}: {args.output.stat().st_size} bytes')


if __name__ == '__main__':
    main()
