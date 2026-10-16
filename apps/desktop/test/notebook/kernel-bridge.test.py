"""Real IPython integration, no GUI. Requires ipykernel, pandas and NumPy."""
import json
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import time
import unittest

BRIDGE = Path(__file__).resolve().parents[2] / 'src/main/notebook/kernel-bridge.py'


class KernelBridgeTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='setdown-kernel-test-')
        self.errors = tempfile.TemporaryFile(mode='w+')
        self.process = subprocess.Popen([sys.executable, '-E', '-u', str(BRIDGE), self.directory.name],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.errors, text=True)
        self.events = queue.Queue()
        def read():
            for line in self.process.stdout:
                self.events.put(json.loads(line))
        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()
        self.addCleanup(self.cleanup)
        self.until(lambda event: event.get('state') == 'idle')

    def cleanup(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
                self.fail('Kernel bridge did not shut down on stdin EOF')
        self.reader.join(timeout=2)
        self.process.stdout.close()
        self.errors.close()
        self.directory.cleanup()

    def until(self, predicate, timeout=60):
        deadline = time.monotonic() + timeout
        events = []
        while time.monotonic() < deadline:
            try:
                event = self.events.get(timeout=min(1, max(.01, deadline-time.monotonic())))
            except queue.Empty:
                if self.process.poll() is not None:
                    self.errors.seek(0)
                    self.fail('Bridge exited: ' + self.errors.read())
                continue
            events.append(event)
            if event.get('state') == 'failed':
                self.fail(str(event))
            if predicate(event):
                return events
        self.fail('Timed out: ' + str(events[-5:]))

    def send(self, command):
        self.process.stdin.write(json.dumps(command) + '\n')
        self.process.stdin.flush()

    def run_cells(self, sources):
        self.send({'type': 'execute', 'cells': [{'id': str(i), 'version': 1, 'source': source} for i, source in enumerate(sources)]})
        return self.until(lambda event: event.get('state') == 'idle')

    def test_shared_state_outputs_and_error_stops_run_all(self):
        events = self.run_cells(['numbers = [1, 2, 3]', 'numbers.append(4)\nprint(sum(numbers))\nlen(numbers)'])
        outputs = [e for e in events if e['type'] == 'output']
        self.assertTrue(any(e['cell'] == '1' and e['kind'] == 'stream' and '10' in e['content']['text'] for e in outputs))
        self.assertTrue(any(e['kind'] == 'execute_result' and e['content']['data']['text/plain'] == '4' for e in outputs))
        self.assertEqual([e['count'] for e in events if e['type'] == 'cell-done'], [1, 2])
        events = self.run_cells(['print(numbers)', 'raise ValueError("stop here")', 'print("MUST_NOT_RUN")'])
        self.assertEqual([e['cell'] for e in events if e['type'] == 'cell-start'], ['0', '1'])
        self.assertTrue(any(e.get('kind') == 'error' and e['content']['ename'] == 'ValueError' for e in events))
        self.assertFalse([e for e in events if e['type'] == 'cell-done'][-1]['ok'])

    def test_ipython_display_clear_update_and_working_directory(self):
        events = self.run_cells(['from IPython.display import display, clear_output\n'
                                'h = display("first", display_id=True)\nh.update("updated")\nclear_output(wait=True)\nprint("last")',
                                'from pathlib import Path\nprint(Path.cwd())\n%who'])
        kinds = [e.get('kind') for e in events]
        self.assertIn('display_data', kinds)
        self.assertIn('update_display_data', kinds)
        self.assertIn('clear_output', kinds)
        self.assertIn(self.directory.name, json.dumps(events))

    def test_stdin_password_and_paged_variables(self):
        self.send({'type': 'execute', 'cells': [{'id': 'input', 'version': 3, 'runId': 'run-input', 'source': 'from getpass import getpass\nanswer = input("Name: ")\nsecret = getpass("Password: ")\nprint(answer, len(secret))'}]})
        request = self.until(lambda e: e['type'] == 'input')[-1]
        self.assertFalse(request['password'])
        self.assertEqual(request['runId'], 'run-input')
        self.send({'type': 'input', 'request': request['request'], 'value': '한글'})
        request = self.until(lambda e: e['type'] == 'input')[-1]
        self.assertTrue(request['password'])
        self.send({'type': 'input', 'request': request['request'], 'value': 'private-value'})
        events = self.until(lambda e: e.get('state') == 'idle')
        self.assertIn('한글 13', json.dumps(events, ensure_ascii=False))
        self.assertNotIn('private-value', json.dumps(events))
        self.run_cells(['import pandas as pd\nimport numpy as np\nnullable = list(range(250))\nframe = pd.DataFrame({"a": range(250)})\narray = np.arange(300).reshape(10, 30).T'])
        def inspect(name=None, offset=0):
            self.send({'type': 'inspect', 'request': 'inspect', 'name': name, 'offset': offset})
            event = self.until(lambda e: e['type'] == 'inspect')[-1]
            self.assertNotIn('error', event)
            return event['result']
        self.assertIn('frame', [v['name'] for v in inspect()['variables']])
        table = inspect('frame', 100)
        self.assertEqual(table['total'], 250)
        self.assertEqual(table['rows'][0], ['100', '100'])
        self.assertEqual(len(table['rows']), 100)
        self.assertEqual(inspect('nullable', 200)['rows'][0], ['200', '200'])
        self.assertEqual(inspect('array', 0)['rows'][:2], [['0', '0'], ['1', '30']])

    def test_interrupt_retains_kernel_and_stops_queue(self):
        self.send({'type': 'execute', 'cells': [{'id': 'loop', 'version': 2, 'source': 'import time\nwhile True: time.sleep(.05)'},
                                               {'id': 'never', 'version': 1, 'source': 'print("MUST_NOT_RUN")'}]})
        self.until(lambda e: e.get('kind') == 'execute_input')
        self.send({'type': 'interrupt'})
        events = self.until(lambda e: e.get('state') == 'idle', timeout=10)
        self.assertTrue(any(e.get('kind') == 'error' and e['content']['ename'] == 'KeyboardInterrupt' for e in events))
        self.assertFalse(any(e.get('cell') == 'never' for e in events))
        self.assertTrue(any(e.get('kind') == 'stream' and 'alive' in e['content']['text'] for e in self.run_cells(['print("alive")'])))


if __name__ == '__main__':
    unittest.main()
