"""Private stdio bridge. Jupyter owns kernel launch, authentication and channels.

Started only by explicit Run. Notebook metadata cannot choose executable commands.
EOF/termination shuts down the kernel, including when the Electron owner dies.
"""
import asyncio
import json
import os
import signal
import sys
import tempfile
import threading


def emit(event):
    sys.stdout.write(json.dumps(event, ensure_ascii=True, allow_nan=False) + "\n")
    sys.stdout.flush()


async def main():
    from jupyter_client import AsyncKernelManager
    from jupyter_client.kernelspec import KernelSpec, KernelSpecManager

    class SelectedPython(KernelSpecManager):
        def get_kernel_spec(self, name):
            # Do not follow kernelspec argv or startup code from a notebook.
            return KernelSpec(argv=[sys.executable, "-E", "-m", "ipykernel_launcher",
                                    "-f", "{connection_file}"],
                              display_name="Python", language="python")

    loop = asyncio.get_running_loop()
    commands = asyncio.Queue(maxsize=32)
    closing = asyncio.Event()

    def put(command):
        if command.get("type") == "shutdown":
            closing.set()
        if not commands.full():
            commands.put_nowait(command)

    def read_commands():
        try:
            while True:
                line = sys.stdin.buffer.readline(20 * 1024 * 1024 + 1)
                if not line or len(line) > 20 * 1024 * 1024:
                    break
                loop.call_soon_threadsafe(put, json.loads(line))
        except (ValueError, RuntimeError):
            pass
        finally:
            try:
                loop.call_soon_threadsafe(put, {"type": "shutdown"})
            except RuntimeError:
                pass

    threading.Thread(target=read_commands, daemon=True).start()
    if os.name != "nt":
        for sig in (signal.SIGTERM, signal.SIGHUP):
            loop.add_signal_handler(sig, put, {"type": "shutdown"})
    with tempfile.TemporaryDirectory(prefix="setdown-kernel-") as runtime:
        km = AsyncKernelManager(kernel_spec_manager=SelectedPython(),
                                connection_file=os.path.join(runtime, "connection.json"))
        client = None
        running = None
        cancelled = False
        async def execute(cells):
            nonlocal cancelled
            try:
                for cell in cells:
                    if cancelled:
                        break
                    identity = {"cell": cell["id"], "version": cell["version"]}
                    if cell.get("runId"):
                        identity["runId"] = cell["runId"]
                    emit({"type": "cell-start", **identity})
                    size = 0
                    limited = False
                    def output(message):
                        nonlocal size, limited
                        kind, content = message["header"]["msg_type"], message["content"]
                        if kind not in ("stream", "display_data", "update_display_data", "execute_result",
                                        "error", "clear_output", "execute_input"):
                            return
                        event = {"type": "output", **identity, "kind": kind, "content": content}
                        size += len(json.dumps(event, ensure_ascii=True))
                        # Drain the channel even after the limit, so the kernel can finish.
                        if size <= 8 * 1024 * 1024:
                            emit(event)
                        elif not limited:
                            limited = True
                            emit({"type": "output", **identity, "kind": "stream", "content": {
                                "name": "stderr", "text": "\n[Setdown: live output exceeded 8 MiB; further output was omitted.]\n"}})
                    reply = await client.execute_interactive(cell["source"], allow_stdin=False,
                                                            stop_on_error=True, output_hook=output)
                    ok = reply["content"].get("status") == "ok"
                    emit({"type": "cell-done", **identity, "ok": ok,
                          "count": reply["content"].get("execution_count")})
                    if not ok:
                        break
            except asyncio.CancelledError:
                raise
            except Exception as error:
                emit({"type": "state", "state": "failed", "message": str(error)})
            finally:
                emit({"type": "state", "state": "idle"})
        async def initialize():
            nonlocal client
            # Start outside the notebook directory so local ipykernel.py cannot
            # shadow the installed package. User-site packages remain available.
            await asyncio.wait_for(km.start_kernel(cwd=runtime, stdout=sys.stderr, stderr=sys.stderr), 30)
            client = km.client()
            client.start_channels()
            await client.wait_for_ready(timeout=45)
            directory = json.dumps(sys.argv[1])
            reply = await client.execute_interactive(
                "__import__('os').chdir(" + directory + "); __import__('sys').path.insert(0, " + directory + ")",
                silent=True, store_history=False, allow_stdin=False, output_hook=lambda message: None, timeout=10)
            if reply["content"].get("status") != "ok":
                raise RuntimeError("Could not enter the notebook directory")
        startup = asyncio.create_task(initialize())
        cancelled_start = asyncio.create_task(closing.wait())
        try:
            done, _ = await asyncio.wait([startup, cancelled_start], return_when=asyncio.FIRST_COMPLETED)
            if cancelled_start in done:
                startup.cancel()
                await asyncio.gather(startup, return_exceptions=True)
                return
            await startup
            cancelled_start.cancel()
            emit({"type": "state", "state": "idle", "python": sys.executable})
            while True:
                try:
                    command = await asyncio.wait_for(commands.get(), 1)
                except asyncio.TimeoutError:
                    if not await km.is_alive():
                        raise RuntimeError("The Python kernel exited. Restart the kernel to continue.")
                    continue
                action = command.get("type")
                if action == "shutdown":
                    break
                if action == "interrupt":
                    cancelled = True
                    await km.interrupt_kernel()
                elif action == "execute" and (running is None or running.done()):
                    cancelled = False
                    emit({"type": "state", "state": "busy"})
                    running = asyncio.create_task(execute(command["cells"]))
        finally:
            cancelled_start.cancel()
            if not startup.done():
                startup.cancel()
                await asyncio.gather(startup, return_exceptions=True)
            if running and not running.done():
                running.cancel()
                try:
                    await running
                except asyncio.CancelledError:
                    pass
            try:
                if km.has_kernel:
                    await asyncio.wait_for(km.shutdown_kernel(now=True), 5)
            finally:
                if client:
                    client.stop_channels()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        emit({"type": "state", "state": "failed", "message": str(error) + (". Install ipykernel and jupyter_client in the chosen Python environment."
                            if isinstance(error, ModuleNotFoundError) else "")})
        sys.exit(1)
