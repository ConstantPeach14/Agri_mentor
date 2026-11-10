const assert = require('node:assert/strict');
const { test } = require('node:test');

const { MAX_IMAGE_BYTES, validateImage } = require('../src/image-validation');

const images = [
  ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00])],
  ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ['image/webp', Buffer.from('RIFF0000WEBP')],
];

test('image validation accepts only matching JPEG, PNG, and WebP signatures', () => {
  for (const [type, image] of images) {
    assert.deepEqual(validateImage(image, type), { contentType: type, sizeBytes: image.length });
  }
  assert.throws(() => validateImage(images[1][1], 'image/jpeg'), { code: 'INVALID_IMAGE_CONTENT' });
  assert.throws(() => validateImage(Buffer.from('not an image'), 'image/svg+xml'), { code: 'UNSUPPORTED_IMAGE_TYPE' });
});

test('image validation rejects empty input and files over the 5 MiB limit', () => {
  assert.throws(() => validateImage(Buffer.alloc(0), 'image/png'), { code: 'INVALID_IMAGE' });
  assert.throws(() => validateImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image/png'), { code: 'IMAGE_TOO_LARGE' });
});
