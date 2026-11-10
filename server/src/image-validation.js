const { HttpError } = require('./http-error');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function detectedImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function validateImage(buffer, declaredType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new HttpError(400, 'INVALID_IMAGE', 'Select a non-empty image file.');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new HttpError(413, 'IMAGE_TOO_LARGE', 'Images must be 5 MB or smaller.');
  }
  if (!allowedTypes.has(declaredType)) {
    throw new HttpError(415, 'UNSUPPORTED_IMAGE_TYPE', 'Use a JPEG, PNG, or WebP image.');
  }
  if (detectedImageType(buffer) !== declaredType) {
    throw new HttpError(415, 'INVALID_IMAGE_CONTENT', 'The image content does not match its file type.');
  }
  return { contentType: declaredType, sizeBytes: buffer.length };
}

module.exports = { MAX_IMAGE_BYTES, detectedImageType, validateImage };
