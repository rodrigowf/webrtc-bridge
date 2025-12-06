import os from 'os';
import qrcode from 'qrcode-terminal';

/**
 * Get the local IP address for the current machine on the local network.
 * Returns the first non-internal IPv4 address found.
 */
export function getLocalIpAddress(): string | null {
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    const netInterface = interfaces[name];
    if (!netInterface) continue;

    for (const info of netInterface) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (info.internal || info.family !== 'IPv4') continue;

      return info.address;
    }
  }

  return null;
}

/**
 * Display the server URL and QR code in the console.
 */
export function displayServerInfo(port: number, isHttps: boolean): void {
  const localIp = getLocalIpAddress();
  const protocol = isHttps ? 'https' : 'http';

  console.log('');
  console.log('═'.repeat(60));
  console.log('[SERVER] Server is running!');
  console.log('');
  console.log(`  Local:   ${protocol}://localhost:${port}`);

  if (localIp) {
    const networkUrl = `${protocol}://${localIp}:${port}`;
    console.log(`  Network: ${networkUrl}`);
    console.log('');
    console.log('[SERVER] Scan QR code to open on mobile:');
    console.log('');

    // Generate QR code (small size for terminal)
    qrcode.generate(networkUrl, { small: true }, (qr) => {
      console.log(qr);
      console.log('═'.repeat(60));
      console.log('');
    });
  } else {
    console.log('  Network: Unable to determine local IP address');
    console.log('═'.repeat(60));
    console.log('');
  }
}
