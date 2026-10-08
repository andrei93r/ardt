// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * D-Bus exposure on `org.adrt.Adrt` / `/org/adrt/Adrt` (§22). The handler
 * object is implemented by `extension.ts`; this file only exports it.
 *
 * The introspection XML is generated from the one trigger table
 * (`core/triggers.ts`, quality plan P6a) so the wire surface and the dispatch
 * map can never drift apart.
 */

import Gio from 'gi://Gio';
import type { DBusExportedObject } from 'gi://Gio';

import { TRIGGERS, buildInterfaceXml } from '../../core/triggers.js';
import type { DbusBackend, DbusHandlers } from '../../platform/dbus.js';

const DBUS_NAME = 'org.adrt.Adrt';
const DBUS_PATH = '/org/adrt/Adrt';

const INTERFACE_XML = buildInterfaceXml(DBUS_NAME, TRIGGERS);

export class GnomeDbus implements DbusBackend {
  private exported: DBusExportedObject | null = null;
  private ownerId = 0;

  expose(handlers: DbusHandlers): void {
    const exported: DBusExportedObject = Gio.DBusExportedObject.wrapJSObject(INTERFACE_XML, handlers);
    this.exported = exported;
    exported.export(Gio.DBus.session, DBUS_PATH);
    this.ownerId = Gio.bus_own_name(Gio.BusType.SESSION, DBUS_NAME, Gio.BusNameOwnerFlags.NONE, null, null, null);
  }

  unexpose(): void {
    if (this.exported === null) return;
    this.exported.unexport();
    this.exported = null;
    if (this.ownerId !== 0) {
      Gio.bus_unown_name(this.ownerId);
      this.ownerId = 0;
    }
  }
}
