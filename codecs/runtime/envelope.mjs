const MAGIC = Buffer.from("KBIN1", "ascii");

function packEnvelope({ typeName, types, payload }) {
  if (typeof typeName !== "string" || !typeName.startsWith("@")) {
    throw new Error("Envelope typeName must be a canonical name starting with '@'");
  }
  if (!types || typeof types !== "object") {
    throw new Error("Envelope types must be an object");
  }
  if (!Buffer.isBuffer(payload)) {
    throw new Error("Envelope payload must be a Buffer");
  }

  const meta = Buffer.from(JSON.stringify({ typeName, types }), "utf8");
  const header = Buffer.alloc(MAGIC.length + 4);
  MAGIC.copy(header, 0);
  header.writeUInt32BE(meta.length, MAGIC.length);
  return Buffer.concat([header, meta, payload]);
}

function unpackEnvelope(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("Envelope input must be a Buffer");
  }
  if (buffer.length < MAGIC.length + 4) {
    throw new Error("Buffer too short for envelope header");
  }

  const magic = buffer.subarray(0, MAGIC.length);
  if (!magic.equals(MAGIC)) {
    throw new Error("Invalid envelope magic. Expected KBIN1");
  }

  const metaLength = buffer.readUInt32BE(MAGIC.length);
  const metaStart = MAGIC.length + 4;
  const metaEnd = metaStart + metaLength;
  if (buffer.length < metaEnd) {
    throw new Error("Envelope metadata length exceeds buffer size");
  }

  const meta = JSON.parse(buffer.subarray(metaStart, metaEnd).toString("utf8"));
  const payload = buffer.subarray(metaEnd);
  return { ...meta, payload };
}

export { packEnvelope, unpackEnvelope };
export default { packEnvelope, unpackEnvelope };