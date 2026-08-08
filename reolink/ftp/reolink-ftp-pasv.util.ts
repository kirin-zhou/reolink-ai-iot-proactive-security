import * as os from "os";

export function resolveFtpPasvUrl(configured?: string): string {
  const text = configured?.trim() || process.env.REOLINK_FTP_PASV_URL?.trim();
  if (text) {
    return text;
  }

  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }

  throw new Error(
    "The FTP pasvUrl is not configured and cannot automatically detect the local network IP. Please pass the local IP address that the camera can reach in the ftp.pasvUrl file of pipeline/start (which should be consistent with ftpServer.address in device/ftp/configure), or set the environment variable REOLINK_FTP_PASV_URL.",
  );
}
