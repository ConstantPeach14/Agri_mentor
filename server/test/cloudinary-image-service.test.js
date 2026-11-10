const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createCloudinaryImageService } = require('../src/cloudinary-image-service');

function createMockCloudinary(resultOverride = {}) {
  const calls = { config: null, upload: null, destroyed: null };
  return {
    calls,
    client: {
      config(options) {
        calls.config = options;
      },
      uploader: {
        upload_stream(options, callback) {
          calls.upload = options;
          return {
            end() {
              callback(null, {
                public_id: options.public_id,
                secure_url: `https://res.cloudinary.com/test/image/upload/${options.public_id}.png`,
                ...resultOverride,
              });
            },
          };
        },
        destroy(publicId, options, callback) {
          calls.destroyed = { publicId, options };
          callback(null, { result: 'ok' });
        },
      },
    },
  };
}

const credentials = {
  CLOUDINARY_CLOUD_NAME: 'test-cloud',
  CLOUDINARY_API_KEY: 'test-key',
  CLOUDINARY_API_SECRET: 'test-secret',
};

test('Cloudinary service requires credentials together and configures secure delivery', async () => {
  assert.equal(createCloudinaryImageService({}, createMockCloudinary().client), null);
  assert.throws(
    () => createCloudinaryImageService({ CLOUDINARY_CLOUD_NAME: 'test-cloud' }, createMockCloudinary().client),
    /must be configured together/,
  );

  const mock = createMockCloudinary();
  const service = createCloudinaryImageService(credentials, mock.client);
  const uploaded = await service.upload(Buffer.from('image'), { userId: 'user-1', category: 'profile' });
  assert.equal(mock.calls.config.secure, true);
  assert.equal(uploaded.publicId, mock.calls.upload.public_id);
  assert.match(uploaded.secureUrl, /^https:\/\//);
  assert.match(uploaded.publicId, /^agrimentor\/profile\/user-1\//);

  await service.destroy(uploaded.publicId);
  assert.equal(mock.calls.destroyed.publicId, uploaded.publicId);
  assert.equal(mock.calls.destroyed.options.invalidate, true);
});

test('Cloudinary service rejects unsafe URLs and provider failures', async () => {
  const insecure = createMockCloudinary({ secure_url: 'http://example.test/image.png' });
  const service = createCloudinaryImageService(credentials, insecure.client);
  await assert.rejects(
    service.upload(Buffer.from('image'), { userId: 'user-2', category: 'agricultural' }),
    { code: 'IMAGE_UPLOAD_INVALID_RESPONSE' },
  );

  const failingClient = {
    config() {},
    uploader: {
      upload_stream(_options, callback) {
        return { end() { callback(new Error('provider failure')); } };
      },
    },
  };
  await assert.rejects(
    createCloudinaryImageService(credentials, failingClient)
      .upload(Buffer.from('image'), { userId: 'user-2', category: 'profile' }),
    { code: 'IMAGE_UPLOAD_FAILED' },
  );
});
