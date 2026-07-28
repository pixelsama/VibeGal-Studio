function canonicalValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalJson(value) {
  const serialized = canonicalValue(value);
  if (serialized === undefined) {
    throw new TypeError("Canonical JSON cannot serialize undefined");
  }
  return serialized;
}

export function updateSignaturePayload(manifest) {
  return Buffer.from(canonicalJson({
    schemaVersion: manifest.schemaVersion,
    version: manifest.version,
    channel: manifest.channel,
    publishedAt: manifest.publishedAt,
    platforms: manifest.platforms,
  }));
}
