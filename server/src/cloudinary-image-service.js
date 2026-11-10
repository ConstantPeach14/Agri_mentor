const { randomUUID } = require('node:crypto');
const { HttpError } = require('./http-error');

function createCloudinaryImageService(env = process.env, cloudinary = require('cloudinary').v2) {
  const credentials = {
    cloud_name: env.CLOUDINARY_CLOUD_NAME?.trim(),
    api_key: env.CLOUDINARY_API_KEY?.trim(),
    api_secret: env.CLOUDINARY_API_SECRET?.trim(),
  };
  const configured = Object.values(credentials).filter(Boolean).length;
  if (configured === 0) return null;
  if (configured !== 3) {
    throw new Error('All Cloudinary environment variables must be configured together.');
  }

  cloudinary.config({ ...credentials, secure: true });

  return {
    upload(buffer, { userId, category }) {
      if (!['profile', 'agricultural'].includes(category)) {
        throw new HttpError(400, 'INVALID_IMAGE_CATEGORY', 'The image category is not supported.');
      }
      const publicId = `agrimentor/${category}/${userId}/${randomUUID()}`;
      return new Promise((resolve, reject) => {
        const upload = cloudinary.uploader.upload_stream({
          public_id: publicId,
          resource_type: 'image',
          overwrite: false,
          unique_filename: false,
          allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        }, (error, result) => {
          if (error || !result) {
            reject(new HttpError(502, 'IMAGE_UPLOAD_FAILED', 'The image could not be uploaded.'));
            return;
          }
          if (typeof result.secure_url !== 'string'
            || !result.secure_url.startsWith('https://')
            || result.public_id !== publicId) {
            reject(new HttpError(502, 'IMAGE_UPLOAD_INVALID_RESPONSE', 'The image service returned an invalid result.'));
            return;
          }
          resolve({ publicId: result.public_id, secureUrl: result.secure_url });
        });
        upload.end(buffer);
      });
    },

    destroy(publicId) {
      return new Promise((resolve, reject) => {
        cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true }, (error, result) => {
          if (error || !result || !['ok', 'not found'].includes(result.result)) {
            reject(new HttpError(502, 'IMAGE_DELETE_FAILED', 'The previous image could not be removed.'));
            return;
          }
          resolve();
        });
      });
    },
  };
}

module.exports = { createCloudinaryImageService };
