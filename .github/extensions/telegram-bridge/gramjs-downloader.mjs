/**
 * GramJS-powered large file downloader for Telegram Bridge.
 *
 * Uses the MTProto protocol (via GramJS) to bypass the Bot API's 20MB
 * getFile limit. Authenticates as a bot using the same bot token.
 *
 * Requires TELEGRAM_API_ID and TELEGRAM_API_HASH in .env
 * (free from https://my.telegram.org/apps).
 */
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import bigInt from "big-integer";
import { createWriteStream } from "node:fs";

const WEB_LOCATION_FLAG = 1 << 24;
const FILE_REFERENCE_FLAG = 1 << 25;

const FileType = {
  THUMBNAIL: 0, CHAT_PHOTO: 1, PHOTO: 2, VOICE: 3, VIDEO: 4,
  DOCUMENT: 5, ENCRYPTED: 6, TEMP: 7, STICKER: 8, AUDIO: 9,
  ANIMATION: 10, ENCRYPTED_THUMBNAIL: 11, WALLPAPER: 12,
  VIDEO_NOTE: 13, SECURE_RAW: 14, SECURE: 15, BACKGROUND: 16,
  DOCUMENT_AS_FILE: 17,
};

const PHOTO_TYPES = new Set([
  FileType.THUMBNAIL, FileType.CHAT_PHOTO, FileType.PHOTO,
  FileType.WALLPAPER, FileType.ENCRYPTED_THUMBNAIL,
]);

function mod(n, m) {
  return ((n % m) + m) % m;
}

function b64Decode(s) {
  const padded = s + "=".repeat(mod(-s.length, 4));
  return Buffer.from(padded, "base64");
}

function rleDecode(s) {
  const r = [];
  let z = false;
  for (let i = 0; i < s.length; i++) {
    const b = s[i];
    if (!b) {
      z = true;
      continue;
    }
    if (z) {
      r.push(...Array(b).fill(0));
      z = false;
    } else {
      r.push(b);
    }
  }
  return Buffer.from(r);
}

function readBytes(buffer, position) {
  let length = buffer.readUInt8(position);
  position += 1;
  let padding = 0;
  if (length > 253) {
    length = buffer.readUIntLE(position, 3);
    position += 3;
    padding = mod(-length, 4);
  } else {
    padding = mod(-(length + 1), 4);
  }
  const result = buffer.slice(position, position + length);
  position += length + padding;
  return { result, newPosition: position };
}

export function botFileIdToMedia(fileId, fileSize) {
  const decoded = rleDecode(b64Decode(fileId));
  const major = decoded[decoded.length - 1];
  const buffer = major < 4 ? decoded.slice(0, -1) : decoded.slice(0, -2);

  let pos = 0;
  let fileType = buffer.readInt32LE(pos);
  pos += 4;
  const dcId = buffer.readInt32LE(pos);
  pos += 4;

  const hasWebLocation = Boolean(fileType & WEB_LOCATION_FLAG);
  const hasFileReference = Boolean(fileType & FILE_REFERENCE_FLAG);

  fileType &= ~WEB_LOCATION_FLAG;
  fileType &= ~FILE_REFERENCE_FLAG;

  if (hasWebLocation) {
    throw new Error("Web location file_ids are not supported for MTProto download");
  }

  let fileReference = Buffer.alloc(0);
  if (hasFileReference) {
    const { result, newPosition } = readBytes(buffer, pos);
    fileReference = result;
    pos = newPosition;
  }

  const mediaId = BigInt(buffer.readBigInt64LE(pos).toString());
  pos += 8;
  const accessHash = BigInt(buffer.readBigInt64LE(pos).toString());
  pos += 8;

  if (PHOTO_TYPES.has(fileType)) {
    return new Api.MessageMediaPhoto({
      photo: new Api.Photo({
        id: bigInt(mediaId),
        accessHash: bigInt(accessHash),
        fileReference,
        dcId,
        date: 0,
        sizes: [],
      }),
    });
  }

  return new Api.MessageMediaDocument({
    document: new Api.Document({
      id: bigInt(mediaId),
      accessHash: bigInt(accessHash),
      mimeType: "",
      date: 0,
      size: bigInt(fileSize),
      dcId,
      fileReference,
      attributes: [],
    }),
  });
}

let gramClient = null;
let gramClientReady = false;
let initPromise = null;

export async function getGramClient(botToken, apiId, apiHash, logger) {
  if (gramClientReady && gramClient) return gramClient;
  if (initPromise) return initPromise;

  if (!apiId || !apiHash) {
    if (logger) await logger("GramJS: api_id/api_hash not configured — MTProto downloads disabled");
    return null;
  }

  initPromise = (async () => {
    try {
      const session = new StringSession("");
      gramClient = new TelegramClient(session, Number(apiId), apiHash, {
        connectionRetries: 3,
        baseLogger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
      });

      await gramClient.start({ botAuthToken: botToken });
      gramClientReady = true;
      if (logger) await logger("GramJS: MTProto client connected (bot mode) — large file downloads enabled");
      return gramClient;
    } catch (err) {
      if (logger) await logger(`GramJS: Failed to connect — ${err.message}`);
      gramClient = null;
      gramClientReady = false;
      initPromise = null;
      return null;
    }
  })();

  return initPromise;
}

export async function downloadLargeFile({
  fileId, fileSize, outputPath, botToken, apiId, apiHash, logger, onProgress,
}) {
  const client = await getGramClient(botToken, apiId, apiHash, logger);
  if (!client) {
    throw new Error(
      "MTProto download unavailable — set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env " +
      "(get them free at https://my.telegram.org/apps)"
    );
  }

  const media = botFileIdToMedia(fileId, fileSize);
  if (logger) await logger(`GramJS: Starting MTProto download (${(fileSize / 1024 / 1024).toFixed(1)}MB)...`);

  const writeStream = createWriteStream(outputPath);
  let received = 0;

  try {
    for await (const chunk of client.iterDownload({
      file: media,
      requestSize: 1024 * 1024,
      fileSize,
    })) {
      const canWrite = writeStream.write(chunk);
      received += chunk.length;

      if (onProgress) onProgress(received, fileSize);

      if (!canWrite) {
        await new Promise((resolve) => writeStream.once("drain", resolve));
      }
    }
  } finally {
    writeStream.end();
    await new Promise((resolve) => writeStream.on("finish", resolve));
  }

  if (logger) await logger(`GramJS: Download complete — ${outputPath} (${(received / 1024 / 1024).toFixed(1)}MB)`);
  return outputPath;
}
