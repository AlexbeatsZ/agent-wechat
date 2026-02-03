import dbus from "dbus-next";

// Cache of DBus connections by address
const busConnections = new Map<string, dbus.MessageBus>();

/**
 * Get or create a DBus session bus connection for the given address.
 * If no address is provided, uses the DBUS_SESSION_BUS_ADDRESS environment variable.
 */
export function getSessionBus(dbusAddress?: string): dbus.MessageBus {
  // Use provided address or fall back to environment variable
  const address = dbusAddress || process.env.DBUS_SESSION_BUS_ADDRESS;

  if (!address) {
    throw new Error("No DBus address provided and DBUS_SESSION_BUS_ADDRESS not set");
  }

  // Check cache first
  if (busConnections.has(address)) {
    return busConnections.get(address)!;
  }

  // Create new connection
  const bus = dbus.sessionBus({ busAddress: address });
  busConnections.set(address, bus);

  return bus;
}

/**
 * Close a specific DBus session bus connection.
 */
export function closeSessionBus(dbusAddress?: string): void {
  const address = dbusAddress || process.env.DBUS_SESSION_BUS_ADDRESS;

  if (address && busConnections.has(address)) {
    const bus = busConnections.get(address)!;
    bus.disconnect();
    busConnections.delete(address);
  }
}

/**
 * Close all DBus session bus connections.
 */
export function closeAllSessionBuses(): void {
  for (const [address, bus] of busConnections) {
    bus.disconnect();
    busConnections.delete(address);
  }
}
