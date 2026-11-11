#!/usr/bin/python3
"""org.freedesktop.FileManager1 for Setdown.

Other applications call this interface for "Show in folder". The helper owns
the well-known name on the session bus (queued behind an existing owner, never
stealing it) and prints one JSON object per call on stdout for the main process.
Interface: https://www.freedesktop.org/wiki/Specifications/file-manager-interface/
"""
import json
import sys

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

XML = """
<node>
  <interface name="org.freedesktop.FileManager1">
    <method name="ShowFolders"><arg type="as" name="URIs" direction="in"/><arg type="s" name="StartupId" direction="in"/></method>
    <method name="ShowItems"><arg type="as" name="URIs" direction="in"/><arg type="s" name="StartupId" direction="in"/></method>
    <method name="ShowItemProperties"><arg type="as" name="URIs" direction="in"/><arg type="s" name="StartupId" direction="in"/></method>
  </interface>
</node>
"""


def emit(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def on_call(_connection, _sender, _path, _interface, method, parameters, invocation):
    uris, _startup = parameters.unpack()
    paths = [path for path in (Gio.File.new_for_uri(uri).get_path() for uri in uris[:64]) if path]
    emit({"method": method, "paths": paths})
    invocation.return_value(None)


def on_bus(connection, _name):
    connection.register_object("/org/freedesktop/FileManager1", Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0], on_call, None, None)


loop = GLib.MainLoop()
Gio.bus_own_name(Gio.BusType.SESSION, "org.freedesktop.FileManager1", Gio.BusNameOwnerFlags.NONE, on_bus,
                 lambda _c, _n: emit({"owner": True}), lambda _c, _n: emit({"owner": False}))
# Exit with the parent: stdin closes when Setdown quits.
GLib.io_add_watch(GLib.IOChannel.unix_new(sys.stdin.fileno()), GLib.PRIORITY_DEFAULT, GLib.IOCondition.HUP | GLib.IOCondition.ERR,
                  lambda *_: loop.quit() or False)
loop.run()
