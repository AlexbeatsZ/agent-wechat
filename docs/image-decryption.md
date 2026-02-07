# WeChat Image Decryption

WeChat Linux encrypts all stored images as `.dat` files on disk. This document describes the encryption scheme and how we decrypt them.

## Encryption Scheme

Each `.dat` file uses a two-layer scheme:

1. **AES-128-ECB** on the first 1024 bytes of the original image (produces 1040 bytes with PKCS7 padding)
2. **Single-byte XOR** on all remaining bytes

Both keys are **per-account** — different accounts use different AES keys and XOR bytes.

## .dat File Format

```
Offset  Size   Description
0x00    6      Magic: 07 08 56 32 08 07
0x06    4      enc_chunk_size (uint32 LE, always 1024 for files > 1KB)
0x0A    4      remaining_size (uint32 LE = original_file_size - enc_chunk_size)
0x0E    1      Flag byte (0x01)
0x0F    1040   AES-128-ECB ciphertext (enc_chunk_size + 16 PKCS7 padding)
0x41F   N      Remaining data XOR'd with xor_byte
```

**Total: dat_file_size = original_file_size + 31** (15 header + 16 AES padding)

## AES Key Format

The AES key is derived from a 32-character hex string stored in WeChat's process memory. The key is the **raw ASCII bytes of the first 16 hex characters** (NOT hex-decoded).

Example: hex string `2db48e820850a7cff445fb86ce85a4fa`
- **Correct**: key bytes = `32 64 62 34 38 65 38 32 30 38 35 30 61 37 63 66` (ASCII of `"2db48e820850a7cf"`)
- **Wrong**: `bytes.fromhex("2db48e820850a7cf")` = `2d b4 8e 82 08 50 a7 cf`

## Key Extraction

Keys exist only in WeChat's process memory at runtime (not on disk). They are **lazy-initialized** — only populated after the first image operation.

### How We Extract

During login key extraction (`wechat-extract-keys.py`), we read `/proc/pid/mem` directly (no Frida needed):

1. **AES key**: Regex-based memory scan of all RW regions. The key is stored XOR-obfuscated with a per-build 32-byte mask (`IMAGE_XOR_MASK`). Since the plaintext must be 32 hex characters (0-9, a-f), each byte position has only 16 valid obfuscated values out of 256. We build a regex matching the first 4 obfuscated bytes (C-level speed), then verify the remaining 28 in Python. False positive probability is (16/256)^32 ≈ 3e-39 — any match is the real key.
2. **XOR byte**: Derived lazily at image access time (not during key extraction). On first image decryption, the AES-decrypted head reveals the image format, and the XOR byte is recovered by XOR-ing the file's tail bytes against known trailers (JPEG `FF D9`, PNG IEND `AE 42 60 82`, GIF `00 3B`). The result is persisted for subsequent queries.

### Storage

Image keys are stored in the `wechat_keys` table alongside DB encryption keys, using reserved `dbName` values:
- `_image_aes` — 32-char hex string (written by `wechat-extract-keys.py`)
- `_image_xor` — 2-char hex byte (e.g. `"85"`) — derived lazily on first image access, not during extraction

## File Locations

```
Full images:   ~/Documents/xwechat_files/<account>/msg/attach/<md5(chatId)>/<YYYY-MM>/Img/<hash>.dat
Thumbnails:    Same dir with _t.dat suffix
Cached thumbs: ~/Documents/xwechat_files/<account>/cache/<YYYY-MM>/Message/<md5(chatId)>/Thumb/
```

## .dat File Resolution

To find the `.dat` file for a specific message:

1. **Primary**: Parse message XML for `md5` attribute → query `hardlink.db` `image_hardlink_info_v4` by `md5` → resolve `dir1`/`dir2` via `dir2id` table → construct path
2. **Fallback**: Scan `msg/attach/<md5(chatId)>/<YYYY-MM>/Img/` for `.dat` files by filesystem mtime

### hardlink.db Schema

- `dir2id`: maps directory name strings → rowid. Stores md5(chatId) hashes and YYYY-MM strings.
- `image_hardlink_info_v4`: `md5` (image content md5), `file_name`, `file_size`, `modify_time`, `dir1` (chat dir rowid), `dir2` (date dir rowid)

**Note**: `modify_time` in hardlink.db does NOT correspond to message `create_time` — images are downloaded asynchronously. Always use the `md5` column for lookups, not time-based correlation.

## WXGF Format

Some full-size images decrypt to `wxgf` (WeChat Graphics Format) instead of JPEG/PNG. This is a proprietary format that we cannot render directly. When a full-size `.dat` decrypts to WXGF, we fall back to the corresponding `_t.dat` thumbnail, which always decrypts to standard JPEG.

## Decryption Flow (in `wechat-media.ts`)

```
getImageDecrypted()
  1. Try cached thumbnail (fast path, no decryption)
  2. Find .dat via hardlink.db (extract md5 from message XML → lookup)
  3. Fallback: find .dat via filesystem mtime scan
  4. decryptDat() → AES-128-ECB decrypt head + XOR tail
  5. If format is WXGF → try _t.dat thumbnail instead
  6. detectImageFormat() → jpeg/png/gif/webp/wxgf
  7. Return base64 data
```

XOR byte is derived lazily from the first decrypted JPEG (via FFD9 trailer) and persisted for subsequent queries.

## Binary Version Dependency

The `IMAGE_XOR_MASK` is a compile-time constant that differs per binary build. Known masks are stored in `BUILD_PROFILES` in `wechat-extract-keys.py`, keyed by the first 8 hex chars of the ELF BuildID:

| BuildID prefix | Architecture | IMAGE_XOR_MASK |
|---------------|-------------|----------------|
| `71996acd` | aarch64 | `5e780583f2236b85...` |
| `20420b6d` | x86_64 | `5155035200510d06...` |

To add a new build: extract the mask by XOR-ing the known obfuscated bytes (from memory) with the known plaintext key (from a successful decryption). Only the `IMAGE_XOR_MASK` is needed — no other offsets required.

The decryption algorithm itself (AES-ECB + XOR) and the `.dat` file format are stable across versions.

## Verified Against

- JPEG, PNG, and WXGF images across multiple chats
- Both aarch64 and x86_64 (Rosetta 2) builds
- XOR byte derivation from JPEG trailer (0x85 confirmed for test account)
- WXGF → thumbnail fallback returns valid JPEG
