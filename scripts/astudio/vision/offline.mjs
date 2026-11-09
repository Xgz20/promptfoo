import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';

// Guard the verification process, not live evaluations. Count blocked attempts
// so a swallowed telemetry/network error cannot silently pass the offline check.
export function blockNetwork() {
  const audit = { attempts: 0, stacks: [] };
  const blocked = () => {
    audit.attempts++;
    const error = Error('OFFLINE_REPLAY: network access is disabled');
    audit.stacks.push(error.stack);
    throw error;
  };
  globalThis.fetch = blocked;
  http.request = http.get = https.request = https.get = blocked;
  net.connect = net.createConnection = net.Socket.prototype.connect = blocked;
  syncBuiltinESMExports();
  return audit;
}
