const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');

const { HttpError } = require('./http-error');
const { MAX_IMAGE_BYTES } = require('./image-validation');

function createApp(config, {
  authService = null,
  checkDatabase = null,
  imageService = null,
  mentorshipService = null,
  programmeService = null,
} = {}) {
  const app = express();
  const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
    fileFilter: (_request, file, callback) => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
        callback(new HttpError(415, 'UNSUPPORTED_IMAGE_TYPE', 'Use a JPEG, PNG, or WebP image.'));
        return;
      }
      callback(null, true);
    },
  });

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (_request, response, next) => {
    let database = 'not_configured';
    if (checkDatabase) {
      try {
        await checkDatabase();
        database = 'available';
      } catch (error) {
        database = 'unavailable';
        console.error('Database health check failed:', error.message);
      }
    }
    response.json({
      application: 'agriMentor',
      status: 'ok',
      api: 'available',
      database,
      environment: config.nodeEnv,
    });
  });

  const requireAuthService = (_request, _response, next) => {
    if (!authService) {
      next(new HttpError(503, 'AUTH_UNAVAILABLE', 'Account services are not configured.'));
      return;
    }
    next();
  };
  const authenticate = async (request, _response, next) => {
    try {
      const header = request.get('authorization') ?? '';
      const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header);
      if (!match) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
      request.auth = await authService.authenticate(match[1]);
      request.authToken = match[1];
      next();
    } catch (error) {
      next(error);
    }
  };
  const requireImageService = (_request, _response, next) => {
    if (!imageService) {
      next(new HttpError(503, 'IMAGE_UPLOAD_UNAVAILABLE', 'Image uploads are not configured.'));
      return;
    }
    next();
  };
  const requireMentorshipService = (_request, _response, next) => {
    if (!mentorshipService) {
      next(new HttpError(503, 'MENTORSHIP_UNAVAILABLE', 'Mentorship services are not configured.'));
      return;
    }
    next();
  };
  const requireProgrammeService = (_request, _response, next) => {
    if (!programmeService) {
      next(new HttpError(503, 'PROGRAMME_OVERSIGHT_UNAVAILABLE', 'Programme oversight is not configured.'));
      return;
    }
    next();
  };

  app.post('/api/auth/register', requireAuthService, async (request, response, next) => {
    try {
      response.status(201).json({ data: await authService.register(request.body) });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/auth/staff-invitations/consume', requireAuthService, async (request, response, next) => {
    try {
      response.status(201).json({ data: await authService.consumeStaffInvitation(request.body) });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/auth/login', requireAuthService, async (request, response, next) => {
    try {
      response.json({ data: await authService.login(request.body) });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/auth/me', requireAuthService, authenticate, async (request, response, next) => {
    try {
      const profile = await authService.getProfile(request.auth.user.id, request.auth.user.role);
      response.json({ data: { user: request.auth.user, profile } });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/auth/logout', requireAuthService, authenticate, async (request, response, next) => {
    try {
      await authService.logout(request.authToken);
      response.json({ data: { loggedOut: true } });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/profile', requireAuthService, authenticate, async (request, response, next) => {
    try {
      response.json({ data: await authService.getProfile(request.auth.user.id, request.auth.user.role) });
    } catch (error) {
      next(error);
    }
  });
  app.patch('/api/profile', requireAuthService, authenticate, async (request, response, next) => {
    try {
      response.json({ data: await authService.updateProfile(request.auth.user, request.body) });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/staff/programmes', requireAuthService, authenticate, requireProgrammeService, async (request, response, next) => {
    try {
      response.json({ data: await programmeService.listProgrammes(request.auth.user) });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/staff/programmes', requireAuthService, authenticate, requireProgrammeService, async (request, response, next) => {
    try {
      response.status(201).json({ data: await programmeService.createProgramme(request.auth.user, request.body) });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/staff/programmes/:programmeId/participants', requireAuthService, authenticate, requireProgrammeService, async (request, response, next) => {
    try {
      response.status(201).json({
        data: await programmeService.assignParticipant(request.auth.user, request.params.programmeId, request.body),
      });
    } catch (error) {
      next(error);
    }
  });
  app.patch('/api/staff/programmes/:programmeId/participants/:participantId', requireAuthService, authenticate, requireProgrammeService, async (request, response, next) => {
    try {
      response.json({
        data: await programmeService.updateParticipantMembership(
          request.auth.user,
          request.params.programmeId,
          request.params.participantId,
          request.body,
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/staff/programmes/:programmeId/match-proposals', requireAuthService, authenticate, requireProgrammeService, async (request, response, next) => {
    try {
      response.json({ data: await programmeService.listMatchProposals(request.auth.user, request.params.programmeId) });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/staff/programmes/:programmeId/match-proposals', requireAuthService, authenticate, requireProgrammeService, async (request, response, next) => {
    try {
      response.status(201).json({
        data: await programmeService.proposeMatch(request.auth.user, request.params.programmeId, request.body),
      });
    } catch (error) {
      next(error);
    }
  });
  app.patch('/api/staff/programmes/:programmeId/match-proposals/:proposalId', requireAuthService, authenticate, requireProgrammeService, async (request, response, next) => {
    try {
      if (request.body?.status !== 'withdrawn' || Object.keys(request.body ?? {}).length !== 1) {
        throw new HttpError(400, 'INVALID_INPUT', 'Only an open proposal may be withdrawn.');
      }
      response.json({
        data: await programmeService.withdrawMatchProposal(
          request.auth.user,
          request.params.programmeId,
          request.params.proposalId,
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/staff/programmes/:programmeId/sessions', requireAuthService, authenticate, requireProgrammeService, async (request, response, next) => {
    try {
      response.status(201).json({
        data: await programmeService.createCoordinatedSession(
          request.auth.user,
          request.params.programmeId,
          request.body,
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/staff/dashboard', requireAuthService, authenticate, requireProgrammeService, async (request, response, next) => {
    try {
      response.json({ data: await programmeService.getDashboard(request.auth.user) });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/staff/programmes/:programmeId/participants', requireAuthService, authenticate, requireProgrammeService, async (request, response, next) => {
    try {
      response.json({
        data: await programmeService.listParticipants(
          request.auth.user,
          request.params.programmeId,
          request.query,
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/staff/participants/:participantId', requireAuthService, authenticate, requireProgrammeService, async (request, response, next) => {
    try {
      response.json({
        data: await programmeService.getParticipant(request.auth.user, request.params.participantId),
      });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/staff/programmes/:programmeId/oversight', requireAuthService, authenticate, requireProgrammeService, async (request, response, next) => {
    try {
      response.json({
        data: await programmeService.getOversight(request.auth.user, request.params.programmeId),
      });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/staff/invitations/accept', requireAuthService, authenticate, requireProgrammeService, async (request, response, next) => {
    try {
      response.json({ data: await programmeService.acceptInvitation(request.auth.user, request.body) });
    } catch (error) {
      next(error);
    }
  });
  app.post(
    '/api/profile/image',
    requireAuthService,
    authenticate,
    requireImageService,
    imageUpload.single('image'),
    async (request, response, next) => {
      try {
        if (!request.file) throw new HttpError(400, 'IMAGE_REQUIRED', 'Select an image to upload.');
        response.json({ data: await authService.uploadProfileImage(request.auth.user, request.file) });
      } catch (error) {
        next(error);
      }
    },
  );
  app.get('/api/agricultural-images', requireAuthService, authenticate, async (request, response, next) => {
    try {
      response.json({ data: await authService.listAgriculturalImages(request.auth.user.id) });
    } catch (error) {
      next(error);
    }
  });
  app.delete('/api/agricultural-images/:id', requireAuthService, authenticate, requireImageService, async (request, response, next) => {
    try {
      response.json({ data: await authService.deleteAgriculturalImage(request.auth.user, request.params.id) });
    } catch (error) {
      next(error);
    }
  });
  app.post(
    '/api/agricultural-images',
    requireAuthService,
    authenticate,
    requireImageService,
    imageUpload.single('image'),
    async (request, response, next) => {
      try {
        if (!request.file) throw new HttpError(400, 'IMAGE_REQUIRED', 'Select an image to upload.');
        response.status(201).json({
          data: await authService.uploadAgriculturalImage(request.auth.user, request.file),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get('/api/mentors', requireAuthService, authenticate, requireMentorshipService, async (request, response, next) => {
    try {
      response.json({ data: await mentorshipService.listMentors(request.auth.user, request.query) });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/mentors/:id', requireAuthService, authenticate, requireMentorshipService, async (request, response, next) => {
    try {
      response.json({ data: await mentorshipService.getMentor(request.auth.user, request.params.id) });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/mentorship/requests', requireAuthService, authenticate, requireMentorshipService, async (request, response, next) => {
    try {
      response.json({ data: await mentorshipService.listRequests(request.auth.user) });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/mentorship/match-proposals', requireAuthService, authenticate, requireProgrammeService, async (request, response, next) => {
    try {
      response.json({ data: await programmeService.listParticipantMatchProposals(request.auth.user) });
    } catch (error) {
      next(error);
    }
  });
  app.patch('/api/mentorship/sessions/:id/participation', requireAuthService, authenticate, requireProgrammeService, async (request, response, next) => {
    try {
      response.json({
        data: await programmeService.recordSessionParticipation(request.auth.user, request.params.id, request.body),
      });
    } catch (error) {
      next(error);
    }
  });
  app.patch('/api/mentorship/match-proposals/:id', requireAuthService, authenticate, requireProgrammeService, async (request, response, next) => {
    try {
      response.json({ data: await programmeService.respondToMatchProposal(request.auth.user, request.params.id, request.body) });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/mentorship/requests', requireAuthService, authenticate, requireMentorshipService, async (request, response, next) => {
    try {
      response.status(201).json({
        data: await mentorshipService.createRequest(request.auth.user, request.body),
      });
    } catch (error) {
      next(error);
    }
  });
  app.patch('/api/mentorship/requests/:id', requireAuthService, authenticate, requireMentorshipService, async (request, response, next) => {
    try {
      response.json({
        data: await mentorshipService.updateRequest(
          request.auth.user,
          request.params.id,
          request.body,
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/mentorship/relationships', requireAuthService, authenticate, requireMentorshipService, async (request, response, next) => {
    try {
      response.json({ data: await mentorshipService.listRelationships(request.auth.user) });
    } catch (error) {
      next(error);
    }
  });
  app.patch('/api/mentorship/relationships/:id', requireAuthService, authenticate, requireMentorshipService, async (request, response, next) => {
    try {
      response.json({
        data: await mentorshipService.endRelationship(
          request.auth.user,
          request.params.id,
          request.body,
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/mentorship/sessions', requireAuthService, authenticate, requireMentorshipService, async (request, response, next) => {
    try {
      response.json({ data: await mentorshipService.listSessions(request.auth.user) });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/mentorship/sessions', requireAuthService, authenticate, requireMentorshipService, async (request, response, next) => {
    try {
      response.status(201).json({ data: await mentorshipService.createSession(request.auth.user, request.body) });
    } catch (error) {
      next(error);
    }
  });
  app.patch('/api/mentorship/sessions/:id', requireAuthService, authenticate, requireMentorshipService, async (request, response, next) => {
    try {
      response.json({ data: await mentorshipService.updateSession(request.auth.user, request.params.id, request.body) });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/mentorship/goals', requireAuthService, authenticate, requireMentorshipService, async (request, response, next) => {
    try {
      response.json({ data: await mentorshipService.listGoals(request.auth.user) });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/mentorship/goals', requireAuthService, authenticate, requireMentorshipService, async (request, response, next) => {
    try {
      response.status(201).json({ data: await mentorshipService.createGoal(request.auth.user, request.body) });
    } catch (error) {
      next(error);
    }
  });
  app.patch('/api/mentorship/goals/:id', requireAuthService, authenticate, requireMentorshipService, async (request, response, next) => {
    try {
      response.json({ data: await mentorshipService.updateGoal(request.auth.user, request.params.id, request.body) });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/mentorship/goals/:id/milestones', requireAuthService, authenticate, requireMentorshipService, async (request, response, next) => {
    try {
      response.status(201).json({
        data: await mentorshipService.createMilestone(request.auth.user, request.params.id, request.body),
      });
    } catch (error) {
      next(error);
    }
  });
  app.patch('/api/mentorship/milestones/:id', requireAuthService, authenticate, requireMentorshipService, async (request, response, next) => {
    try {
      response.json({
        data: await mentorshipService.updateMilestone(request.auth.user, request.params.id, request.body),
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found.',
      },
    });
  });

  app.use((error, _request, response, _next) => {
    const status = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
      ? 413
      :
      Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
        ? error.status
        : 500;
    const isClientError = status >= 400 && status < 500;

    if (!isClientError) {
      console.error('Unhandled API error:', error);
    }
    const safeHttpError = error instanceof HttpError;
    const errorCode = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
      ? 'IMAGE_TOO_LARGE'
      : safeHttpError ? error.code : isClientError ? 'INVALID_REQUEST' : 'INTERNAL_SERVER_ERROR';
    const errorMessage = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
      ? 'Images must be 5 MB or smaller.'
      : safeHttpError ? error.message : isClientError ? 'The request could not be processed.' : 'An unexpected error occurred.';

    response.status(status).json({
      error: {
        code: errorCode,
        message: errorMessage,
      },
    });
  });

  return app;
}

module.exports = { createApp };
