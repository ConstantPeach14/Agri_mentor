type ApiLikeError = {
  message?: unknown;
  status?: unknown;
  code?: unknown;
};

export function loginErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const apiError = error as ApiLikeError;
    if (apiError.code === 'INVALID_CREDENTIALS') {
      return 'The email or password is incorrect.';
    }
    if (apiError.code === 'AUTH_UNAVAILABLE' || apiError.status === 503) {
      return 'Sign-in is temporarily unavailable. Please try again shortly.';
    }
    if (typeof apiError.status === 'number' && apiError.status >= 500) {
      return 'The agriMentor service could not complete sign-in. Please try again shortly.';
    }
    if (error instanceof Error && error.message.startsWith('Could not reach the agriMentor API')) {
      return 'Could not reach agriMentor. Check your connection and try again.';
    }
    if (error instanceof Error && error.message.startsWith('EXPO_PUBLIC_API_URL')) {
      return 'The app API address is not configured. Contact the person who set up this app.';
    }
    if (typeof apiError.status === 'number' && apiError.status >= 400 && apiError.status < 500
      && typeof apiError.message === 'string') {
      return apiError.message;
    }
  }
  return 'Sign-in could not be completed. Please try again.';
}
