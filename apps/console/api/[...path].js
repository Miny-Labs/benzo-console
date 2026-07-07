const DEFAULT_API_BASE_URL = "http://localhost:8790";

function apiBaseUrl() {
  return (process.env.BENZO_API_BASE_URL || process.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

export default async function handler(req, res) {
  const rawPath = Array.isArray(req.query.path) ? req.query.path.join("/") : req.query.path || "";
  const search = new URLSearchParams(req.query);
  search.delete("path");
  const qs = search.toString();
  const upstream = `${apiBaseUrl()}/api/${rawPath}${qs ? `?${qs}` : ""}`;
  const headers = { ...req.headers };
  delete headers.host;

  const response = await fetch(upstream, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body ?? {}),
  });

  res.status(response.status);
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "content-encoding") res.setHeader(key, value);
  });
  res.send(Buffer.from(await response.arrayBuffer()));
}
