"""FrogeeCodeIDE notebook kernel: a persistent Python session driven by JSON lines on stdin/stdout.
Standard library only, so it runs in any venv. Requests: {"id", "op": "exec"|"vars", "code"}.
Replies are JSON lines: stream / display / result / error / done / vars / ready."""
import ast
import base64
import io
import json
import linecache
import os
import signal
import subprocess
import sys
import time
import traceback
import warnings

os.environ.setdefault('MPLBACKEND', 'Agg')
warnings.filterwarnings('ignore', message='.*non-GUI backend.*')
warnings.filterwarnings('ignore', message='.*FigureCanvasAgg is non-interactive.*')

_proto = os.fdopen(os.dup(1), 'w', encoding='utf-8', buffering=1)
os.dup2(2, 1)  # C-level prints must not corrupt the protocol
_CUR = {'id': None}
_WORKER_FILE = os.path.abspath(__file__)


def _send(obj):
    _proto.write(json.dumps(obj, ensure_ascii=True) + '\n')
    _proto.flush()


class _Stream(object):
    encoding = 'utf-8'

    def __init__(self, name):
        self.name = name

    def write(self, text):
        if text:
            _send({'id': _CUR['id'], 'type': 'stream', 'name': self.name, 'text': str(text)})
        return len(text) if text else 0

    def flush(self):
        pass

    def isatty(self):
        return False

    def writable(self):
        return True


def _bundle(obj):
    data = {}
    for attr, mime in (('_repr_html_', 'text/html'), ('_repr_markdown_', 'text/markdown'),
                       ('_repr_latex_', 'text/latex'), ('_repr_svg_', 'image/svg+xml'),
                       ('_repr_png_', 'image/png'), ('_repr_jpeg_', 'image/jpeg')):
        fn = getattr(obj, attr, None)
        if not callable(fn):
            continue
        try:
            value = fn()
        except Exception:
            continue
        if isinstance(value, tuple):
            value = value[0]
        if value is None:
            continue
        if isinstance(value, bytes):
            value = base64.b64encode(value).decode('ascii')
        data[mime] = value
    try:
        data['text/plain'] = repr(obj)
    except Exception:
        data['text/plain'] = '<unprintable %s>' % type(obj).__name__
    return data


def display(*objs):
    for obj in objs:
        _send({'id': _CUR['id'], 'type': 'display', 'data': _bundle(obj)})


def clear_output(wait=False):
    _send({'id': _CUR['id'], 'type': 'clear'})


def _shell(cmd):
    proc = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=os.getcwd())
    try:
        for raw in iter(proc.stdout.readline, b''):
            sys.stdout.write(raw.decode('utf-8', 'replace'))
        proc.wait()
    except KeyboardInterrupt:
        proc.kill()
        raise
    return proc.returncode


def _input(prompt=''):
    raise RuntimeError('input() is not supported in notebook cells')


def _magics(code):
    lines = code.split('\n')
    if lines and lines[0].strip().startswith('%%'):
        head = lines[0].strip()[2:].split()
        body = '\n'.join(lines[1:])
        if head and head[0] in ('bash', 'sh', 'shell'):
            return '_shell(%r)' % body
        lines = lines[1:]  # %%time, %%capture etc.: just run the body
    out = []
    for line in lines:
        s = line.strip()
        indent = line[:len(line) - len(line.lstrip())]
        if s.startswith('!'):
            out.append('%s_shell(%r)' % (indent, s[1:]))
        elif s.startswith('%pip ') or s.startswith('%conda '):
            out.append('%s_shell(%r)' % (indent, '"%s" -m pip %s' % (sys.executable, s.split(None, 1)[1])))
        elif s.startswith('%cd '):
            out.append('%simport os as _os; _os.chdir(_os.path.expanduser(%r))' % (indent, s[4:].strip()))
        elif s.startswith('%matplotlib') or s.startswith('%load_ext') or s.startswith('%autoreload') or s.startswith('%reload_ext'):
            out.append(indent + 'pass')
        else:
            out.append(line)
    return '\n'.join(out)


_G = {'__name__': '__main__', '__builtins__': __builtins__, 'display': display, 'clear_output': clear_output,
      '_shell': _shell}
if isinstance(__builtins__, dict):
    __builtins__['input'] = _input
else:
    __builtins__.input = _input


def _flush_figures():
    plt = sys.modules.get('matplotlib.pyplot')
    if plt is None:
        return
    try:
        for num in plt.get_fignums():
            buf = io.BytesIO()
            plt.figure(num).savefig(buf, format='png', dpi=110, bbox_inches='tight')
            _send({'id': _CUR['id'], 'type': 'display',
                   'data': {'image/png': base64.b64encode(buf.getvalue()).decode('ascii'), 'text/plain': '<Figure>'}})
        plt.close('all')
    except Exception:
        pass


def _error(exc_type, exc, tb):
    frames = [f for f in traceback.extract_tb(tb) if os.path.abspath(f.filename) != _WORKER_FILE]
    lines = []
    if frames:
        lines.append('Traceback (most recent call last):\n')
        lines.extend(traceback.format_list(frames))
    lines.extend(traceback.format_exception_only(exc_type, exc))
    _send({'id': _CUR['id'], 'type': 'error', 'ename': exc_type.__name__, 'evalue': str(exc),
           'traceback': [''.join(lines)]})


def _exec(code):
    quiet = code.rstrip().endswith(';')
    linecache.cache['<cell>'] = (len(code), None, code.splitlines(True), '<cell>')
    tree = ast.parse(_magics(code), '<cell>', 'exec')
    last = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last = ast.Expression(tree.body.pop().value)
    exec(compile(tree, '<cell>', 'exec'), _G)
    if last is not None:
        value = eval(compile(last, '<cell>', 'eval'), _G)
        if value is not None and not quiet:
            _G['_'] = value
            _send({'id': _CUR['id'], 'type': 'result', 'data': _bundle(value)})


def _inspect():
    items = []
    for name, value in list(_G.items()):
        if name.startswith('_') or name in ('display', 'clear_output'):
            continue
        if isinstance(value, type(sys)):
            kind = 'module'
        else:
            kind = type(value).__name__
        try:
            shape = getattr(value, 'shape', None)
            size = str(tuple(shape)) if shape is not None else (str(len(value)) if hasattr(value, '__len__') else '')
        except Exception:
            size = ''
        try:
            text = repr(value)
        except Exception:
            text = '<unprintable>'
        items.append({'name': name, 'type': kind, 'size': size, 'value': text[:120].replace('\n', ' ')})
    return items


def main():
    sys.stdout = _Stream('stdout')
    sys.stderr = _Stream('stderr')
    sys.path.insert(0, os.getcwd())
    _send({'type': 'ready', 'python': sys.version.split()[0], 'executable': sys.executable})
    stdin = sys.stdin
    while True:
        try:
            line = stdin.readline()
        except KeyboardInterrupt:
            continue
        if not line:
            break
        try:
            req = json.loads(line)
        except ValueError:
            continue
        _CUR['id'] = req.get('id')
        op = req.get('op', 'exec')
        if op == 'vars':
            _send({'id': req.get('id'), 'type': 'vars', 'items': _inspect()})
            continue
        started = time.time()
        try:
            _exec(req.get('code', ''))
        except KeyboardInterrupt:
            _send({'id': req.get('id'), 'type': 'error', 'ename': 'KeyboardInterrupt',
                   'evalue': 'Interrupted', 'traceback': ['KeyboardInterrupt: execution interrupted']})
        except SyntaxError as exc:
            _send({'id': req.get('id'), 'type': 'error', 'ename': 'SyntaxError', 'evalue': str(exc),
                   'traceback': [''.join(traceback.format_exception_only(type(exc), exc))]})
        except BaseException:
            _error(*sys.exc_info())
        _flush_figures()
        _send({'id': req.get('id'), 'type': 'done', 'duration': round(time.time() - started, 3)})


if __name__ == '__main__':
    signal.signal(signal.SIGINT, signal.default_int_handler)
    main()
