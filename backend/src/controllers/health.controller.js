export function getHealth(_req, res) {
  res.json({ status: 'ok', service: 'amar-doctor-api', timestamp: new Date().toISOString() });
}
