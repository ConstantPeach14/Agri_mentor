import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { ApiRequestError } from './api';
import {
  AuthAccount,
  AgriculturalImage,
  ImageAssetInput,
  MentorDirectoryProfile,
  MentorSearchFilters,
  StaffDashboard,
  ProgrammeMatchProposal,
  StaffParticipant,
  StaffParticipantDetail,
  StaffProgramme,
  StaffProgrammeOversight,
  acceptStaffInvitationWithApi,
  assignStaffParticipantWithApi,
  createStaffProgrammeWithApi,
  createMentorshipRequestWithApi,
  createGoalMilestoneWithApi,
  createMentorshipGoalWithApi,
  createMentorshipSessionWithApi,
  deleteAgriculturalImageWithApi,
  consumeStaffInvitationWithApi,
  endMentorshipRelationshipWithApi,
  getMentorWithApi,
  getStaffDashboardWithApi,
  getStaffParticipantWithApi,
  getStaffProgrammeOversightWithApi,
  listStaffMatchProposalsWithApi,
  createStaffMatchProposalWithApi,
  withdrawStaffMatchProposalWithApi,
  listParticipantMatchProposalsWithApi,
  respondToMatchProposalWithApi,
  createStaffProgrammeSessionWithApi,
  respondToSessionParticipationWithApi,
  loginWithApi,
  listMentorsWithApi,
  listStaffParticipantsWithApi,
  listStaffProgrammesWithApi,
  listMentorshipRelationshipsWithApi,
  listMentorshipRequestsWithApi,
  listMentorshipGoalsWithApi,
  listMentorshipSessionsWithApi,
  listAgriculturalImagesWithApi,
  logoutFromApi,
  registerWithApi,
  restoreApiSession,
  updateMentorshipRequestWithApi,
  updateMentorshipGoalWithApi,
  updateGoalMilestoneWithApi,
  updateMentorshipSessionWithApi,
  uploadAgriculturalImageWithApi,
  uploadProfileImageWithApi,
  updateProfileWithApi,
  updateStaffParticipantMembershipWithApi,
} from './auth-api';
import { clearAuthToken, readAuthToken, writeAuthToken } from './auth-storage';
import {
  createEmptyData,
  LocalData,
  LocalGoal,
  GoalMilestone,
  LocalProfile,
  LocalSession,
  LocalUser,
  Mentorship,
  MentorshipRequest,
  RequestStatus,
  SessionStatus,
  UserRole,
} from './local-data';

type RegisterInput = { name: string; email: string; password: string; role: UserRole; phone: string };
type ProfileChanges = Partial<Omit<LocalProfile, 'userId' | 'updatedAt'>> & { name?: string; phone?: string };

type AppContextValue = {
  data: LocalData;
  loading: boolean;
  error: string | null;
  currentUser: LocalUser | null;
  currentTime: number;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  consumeStaffInvitation: (input: { token: string; name: string; email: string; password: string; phone: string }) => Promise<void>;
  acceptStaffInvitation: (invitation: string) => Promise<StaffProgramme>;
  createStaffProgramme: (input: { name: string; description: string }) => Promise<void>;
  assignStaffParticipant: (programmeId: string, input: { email: string; role: 'mentee' | 'mentor' }) => Promise<void>;
  updateStaffParticipantMembership: (programmeId: string, participantId: string, status: 'active' | 'removed') => Promise<void>;
  getStaffDashboard: () => Promise<StaffDashboard>;
  listStaffProgrammes: () => Promise<StaffProgramme[]>;
  listStaffParticipants: (programmeId: string, filters?: { q?: string; role?: 'mentee' | 'mentor'; status?: 'active' | 'removed' | 'all'; page?: number; pageSize?: number }) => Promise<{ items: StaffParticipant[]; page: number; pageSize: number; total: number }>;
  getStaffParticipant: (participantId: string) => Promise<StaffParticipantDetail>;
  getStaffProgrammeOversight: (programmeId: string) => Promise<StaffProgrammeOversight>;
  listStaffMatchProposals: (programmeId: string) => Promise<ProgrammeMatchProposal[]>;
  createStaffMatchProposal: (programmeId: string, input: { menteeId: string; mentorId: string }) => Promise<ProgrammeMatchProposal>;
  withdrawStaffMatchProposal: (programmeId: string, proposalId: string) => Promise<void>;
  listMatchProposals: () => Promise<ProgrammeMatchProposal[]>;
  respondToMatchProposal: (proposalId: string, response: 'accepted' | 'declined') => Promise<ProgrammeMatchProposal>;
  createStaffProgrammeSession: (programmeId: string, input: { relationshipId: string; title: string; scheduledAt: string; preparationNotes: string }) => Promise<void>;
  respondToSessionParticipation: (sessionId: string, response: 'attended' | 'missed') => Promise<void>;
  logout: () => Promise<void>;
  retrySessionRestore: () => Promise<void>;
  updateProfile: (changes: ProfileChanges) => Promise<void>;
  uploadProfileImage: (asset: ImageAssetInput) => Promise<void>;
  uploadAgriculturalImage: (asset: ImageAssetInput) => Promise<AgriculturalImage>;
  listAgriculturalImages: () => Promise<AgriculturalImage[]>;
  deleteAgriculturalImage: (imageId: string) => Promise<void>;
  mentorshipLoading: boolean;
  mentorshipError: string | null;
  managementLoading: boolean;
  managementError: string | null;
  refreshMentorshipData: () => Promise<void>;
  refreshManagementData: () => Promise<void>;
  endRelationship: (relationshipId: string, reason: string) => Promise<void>;
  listMentors: (filters?: MentorSearchFilters) => Promise<MentorDirectoryProfile[]>;
  getMentor: (mentorId: string) => Promise<MentorDirectoryProfile>;
  sendRequest: (input: { mentorId: string; message: string; needs: string; interests: string; goals: string }) => Promise<void>;
  updateRequest: (requestId: string, status: Extract<RequestStatus, 'accepted' | 'declined' | 'cancelled'>) => Promise<void>;
  createGoal: (input: Pick<LocalGoal, 'title' | 'description' | 'targetDate'>, relationshipId: string) => Promise<void>;
  toggleMilestone: (goalId: string, milestoneId: string, title?: string) => Promise<void>;
  updateGoal: (goalId: string, changes: { title?: string; description?: string; targetDate?: string; status?: LocalGoal['status'] }) => Promise<void>;
  createMilestone: (goalId: string, title: string) => Promise<void>;
  updateMilestone: (milestoneId: string, changes: { title?: string; status?: GoalMilestone['status'] }) => Promise<void>;
  createSession: (input: Pick<LocalSession, 'title' | 'scheduledAt' | 'notes'>, relationshipId: string) => Promise<void>;
  updateSessionStatus: (sessionId: string, status: SessionStatus) => Promise<void>;
  updateSession: (sessionId: string, changes: { title?: string; scheduledAt?: string; preparationNotes?: string; outcomeNotes?: string; status?: SessionStatus }) => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function LocalAppProvider({ children }: PropsWithChildren) {
  const [account, setAccount] = useState<AuthAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [requests, setRequests] = useState<MentorshipRequest[]>([]);
  const [mentorships, setMentorships] = useState<Mentorship[]>([]);
  const [goals, setGoals] = useState<LocalGoal[]>([]);
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [mentorshipLoading, setMentorshipLoading] = useState(true);
  const [mentorshipError, setMentorshipError] = useState<string | null>(null);
  const [managementLoading, setManagementLoading] = useState(false);
  const [managementError, setManagementError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  const restoreSession = useCallback(async (): Promise<AuthAccount | null> => {
    const token = await readAuthToken();
    if (!token) {
      tokenRef.current = null;
      return null;
    }
    try {
      const restored = await restoreApiSession(token);
      tokenRef.current = token;
      return restored;
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 401) {
        await clearAuthToken();
        tokenRef.current = null;
        return null;
      } else {
        throw cause;
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    restoreSession()
      .then((restored) => {
        if (!active) return;
        setCurrentTime(Date.now());
        setAccount(restored);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'The account session could not be restored.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [restoreSession]);

  const retrySessionRestore = useCallback(async () => {
    setLoading(true);
    try {
      const restored = await restoreSession();
      setCurrentTime(Date.now());
      setAccount(restored);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore your sign-in session.');
    } finally {
      setLoading(false);
    }
  }, [restoreSession]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginWithApi(email, password);
    await writeAuthToken(result.token);
    setCurrentTime(Date.now());
    tokenRef.current = result.token;
    setAccount(result.account);
    setError(null);
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const result = await registerWithApi(input);
    await writeAuthToken(result.token);
    setCurrentTime(Date.now());
    tokenRef.current = result.token;
    setAccount(result.account);
    setError(null);
  }, []);

  const consumeStaffInvitation = useCallback(async (input: {
    token: string; name: string; email: string; password: string; phone: string;
  }) => {
    const result = await consumeStaffInvitationWithApi(input);
    await writeAuthToken(result.token);
    setCurrentTime(Date.now());
    tokenRef.current = result.token;
    setAccount(result.account);
    setError(null);
  }, []);

  const logout = useCallback(async () => {
    const token = tokenRef.current;
    let failure: unknown;
    if (token) {
      try {
        await logoutFromApi(token);
      } catch (cause) {
        failure = cause;
      }
    }
    await clearAuthToken();
    tokenRef.current = null;
    setAccount(null);
    if (failure) throw failure;
  }, []);

  const updateProfile = useCallback(async (changes: ProfileChanges) => {
    const token = tokenRef.current;
    const current = account;
    if (!token || !current) throw new Error('Sign in before editing your profile.');
    const profile = await updateProfileWithApi(token, changes);
    setAccount({
      user: {
        ...current.user,
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.phone !== undefined ? { phone: changes.phone } : {}),
      },
      profile,
    });
  }, [account]);

  const uploadProfileImage = useCallback(async (asset: ImageAssetInput) => {
    const token = tokenRef.current;
    const current = account;
    if (!token || !current) throw new Error('Sign in before uploading a profile image.');
    const profile = await uploadProfileImageWithApi(token, asset);
    setAccount({ ...current, profile });
  }, [account]);

  const uploadAgriculturalImage = useCallback(async (asset: ImageAssetInput) => {
    const token = tokenRef.current;
    if (!token) throw new Error('Sign in before uploading an agricultural image.');
    return uploadAgriculturalImageWithApi(token, asset);
  }, []);

  const listAgriculturalImages = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) throw new Error('Sign in before viewing agricultural images.');
    return listAgriculturalImagesWithApi(token);
  }, []);

  const deleteAgriculturalImage = useCallback(async (imageId: string) => {
    const token = tokenRef.current;
    if (!token) throw new Error('Sign in before deleting an agricultural image.');
    await deleteAgriculturalImageWithApi(token, imageId);
  }, []);

  const requireStaffToken = useCallback(() => {
    const token = tokenRef.current;
    if (!token || account?.user.role !== 'staff') {
      throw new Error('Sign in with an assigned Programme Staff account to continue.');
    }
    return token;
  }, [account]);
  const requireParticipantToken = useCallback(() => {
    const token = tokenRef.current;
    if (!token || !['mentee', 'mentor'].includes(account?.user.role ?? '')) {
      throw new Error('Sign in as the proposed Mentor or Mentee to respond to a match.');
    }
    return token;
  }, [account]);
  const acceptStaffInvitation = useCallback(async (invitation: string) => {
    return acceptStaffInvitationWithApi(requireStaffToken(), invitation);
  }, [requireStaffToken]);
  const createStaffProgramme = useCallback(async (input: { name: string; description: string }) => {
    await createStaffProgrammeWithApi(requireStaffToken(), input);
  }, [requireStaffToken]);
  const assignStaffParticipant = useCallback(async (
    programmeId: string,
    input: { email: string; role: 'mentee' | 'mentor' },
  ) => {
    await assignStaffParticipantWithApi(requireStaffToken(), programmeId, input);
  }, [requireStaffToken]);
  const updateStaffParticipantMembership = useCallback(async (
    programmeId: string,
    participantId: string,
    status: 'active' | 'removed',
  ) => {
    await updateStaffParticipantMembershipWithApi(requireStaffToken(), programmeId, participantId, status);
  }, [requireStaffToken]);
  const getStaffDashboard = useCallback(async () => getStaffDashboardWithApi(requireStaffToken()), [requireStaffToken]);
  const listStaffProgrammes = useCallback(async () => listStaffProgrammesWithApi(requireStaffToken()), [requireStaffToken]);
  const listStaffParticipants = useCallback(async (
    programmeId: string,
    filters: { q?: string; role?: 'mentee' | 'mentor'; status?: 'active' | 'removed' | 'all'; page?: number; pageSize?: number } = {},
  ) => listStaffParticipantsWithApi(requireStaffToken(), programmeId, filters), [requireStaffToken]);
  const getStaffParticipant = useCallback(async (participantId: string) => (
    getStaffParticipantWithApi(requireStaffToken(), participantId)
  ), [requireStaffToken]);
  const getStaffProgrammeOversight = useCallback(async (programmeId: string) => (
    getStaffProgrammeOversightWithApi(requireStaffToken(), programmeId)
  ), [requireStaffToken]);
  const listStaffMatchProposals = useCallback(async (programmeId: string) => (
    listStaffMatchProposalsWithApi(requireStaffToken(), programmeId)
  ), [requireStaffToken]);
  const createStaffMatchProposal = useCallback(async (
    programmeId: string,
    input: { menteeId: string; mentorId: string },
  ) => createStaffMatchProposalWithApi(requireStaffToken(), programmeId, input), [requireStaffToken]);
  const withdrawStaffMatchProposal = useCallback(async (programmeId: string, proposalId: string) => {
    await withdrawStaffMatchProposalWithApi(requireStaffToken(), programmeId, proposalId);
  }, [requireStaffToken]);
  const listMatchProposals = useCallback(async () => (
    listParticipantMatchProposalsWithApi(requireParticipantToken())
  ), [requireParticipantToken]);
  const respondToMatchProposal = useCallback(async (proposalId: string, response: 'accepted' | 'declined') => (
    respondToMatchProposalWithApi(requireParticipantToken(), proposalId, response)
  ), [requireParticipantToken]);
  const createStaffProgrammeSession = useCallback(async (
    programmeId: string,
    input: { relationshipId: string; title: string; scheduledAt: string; preparationNotes: string },
  ) => {
    await createStaffProgrammeSessionWithApi(requireStaffToken(), programmeId, input);
  }, [requireStaffToken]);
  const respondToSessionParticipation = useCallback(async (sessionId: string, response: 'attended' | 'missed') => {
    await respondToSessionParticipationWithApi(requireParticipantToken(), sessionId, response);
  }, [requireParticipantToken]);

  const refreshMentorshipData = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || !account) {
      setRequests([]);
      setMentorships([]);
      setMentorshipError(null);
      return;
    }
    if (account.user.role === 'staff') {
      setRequests([]);
      setMentorships([]);
      setMentorshipError(null);
      return;
    }
    setMentorshipLoading(true);
    setMentorshipError(null);
    try {
      const [nextRequests, nextRelationships] = await Promise.all([
        listMentorshipRequestsWithApi(token),
        listMentorshipRelationshipsWithApi(token),
      ]);
      setRequests(nextRequests);
      setMentorships(nextRelationships);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Mentorship information could not be loaded.';
      setMentorshipError(message);
      throw cause;
    } finally {
      setMentorshipLoading(false);
    }
  }, [account]);

  const refreshManagementData = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || !account || account.user.role === 'staff') {
      setGoals([]);
      setSessions([]);
      setManagementError(null);
      return;
    }
    setManagementLoading(true);
    setManagementError(null);
    try {
      const [nextGoals, nextSessions] = await Promise.all([
        listMentorshipGoalsWithApi(token),
        listMentorshipSessionsWithApi(token),
      ]);
      setGoals(nextGoals);
      setSessions(nextSessions);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Mentorship progress could not be loaded.';
      setManagementError(message);
      throw cause;
    } finally {
      setManagementLoading(false);
    }
  }, [account]);

  const endRelationship = useCallback(async (relationshipId: string, reason: string) => {
    const token = tokenRef.current;
    if (!token || !account || account.user.role === 'staff') {
      throw new Error('Sign in as a mentorship participant before ending a relationship.');
    }
    await endMentorshipRelationshipWithApi(token, relationshipId, reason);
    await Promise.all([refreshMentorshipData(), refreshManagementData()]);
  }, [account, refreshManagementData, refreshMentorshipData]);

  useEffect(() => {
    let active = true;
    const token = tokenRef.current;
    void Promise.resolve()
      .then(async () => {
        if (!active) return;
        if (!token || !account) {
          setRequests([]);
          setMentorships([]);
          setMentorshipError(null);
          return;
        }
        if (account.user.role === 'staff') {
          setRequests([]);
          setMentorships([]);
          setMentorshipError(null);
          return;
        }
        const [nextRequests, nextRelationships] = await Promise.all([
          listMentorshipRequestsWithApi(token),
          listMentorshipRelationshipsWithApi(token),
        ]);
        if (active) {
          setRequests(nextRequests);
          setMentorships(nextRelationships);
          setMentorshipError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setMentorshipError(cause instanceof Error ? cause.message : 'Mentorship information could not be loaded.');
        }
      })
      .finally(() => {
        if (active) setMentorshipLoading(false);
      });
    return () => {
      active = false;
    };
  }, [account]);

  useEffect(() => {
    let active = true;
    const token = tokenRef.current;
    if (!token || !account || account.user.role === 'staff') {
      setGoals([]);
      setSessions([]);
      setManagementError(null);
      setManagementLoading(false);
      return () => { active = false; };
    }
    setManagementLoading(true);
    Promise.all([
      listMentorshipGoalsWithApi(token),
      listMentorshipSessionsWithApi(token),
    ])
      .then(([nextGoals, nextSessions]) => {
        if (active) {
          setGoals(nextGoals);
          setSessions(nextSessions);
          setManagementError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) setManagementError(cause instanceof Error ? cause.message : 'Mentorship progress could not be loaded.');
      })
      .finally(() => {
        if (active) setManagementLoading(false);
      });
    return () => { active = false; };
  }, [account]);

  const listMentors = useCallback(async (filters: MentorSearchFilters = {}) => {
    const token = tokenRef.current;
    if (!token) throw new Error('Sign in before searching for mentors.');
    return listMentorsWithApi(token, filters);
  }, []);

  const getMentor = useCallback(async (mentorId: string) => {
    const token = tokenRef.current;
    if (!token) throw new Error('Sign in before viewing mentor profiles.');
    return getMentorWithApi(token, mentorId);
  }, []);

  const sendRequest = useCallback(async (input: {
    mentorId: string;
    message: string;
    needs: string;
    interests: string;
    goals: string;
  }) => {
    const token = tokenRef.current;
    if (!token || account?.user.role !== 'mentee') {
      throw new Error('Sign in as a mentee before requesting mentorship.');
    }
    await createMentorshipRequestWithApi(token, input);
    await refreshMentorshipData();
  }, [account, refreshMentorshipData]);

  const updateRequest = useCallback(async (
    requestId: string,
    status: Extract<RequestStatus, 'accepted' | 'declined' | 'cancelled'>,
  ) => {
    const token = tokenRef.current;
    if (!token) throw new Error('Sign in before updating mentorship requests.');
    await updateMentorshipRequestWithApi(token, requestId, status);
    await refreshMentorshipData();
  }, [refreshMentorshipData]);

  const createGoal = useCallback(async (
    input: Pick<LocalGoal, 'title' | 'description' | 'targetDate'>,
    relationshipId: string,
  ) => {
    const token = tokenRef.current;
    if (!token || !account || account.user.role === 'staff') throw new Error('Sign in as a mentorship participant to create a goal.');
    await createMentorshipGoalWithApi(token, {
      relationshipId,
      title: input.title,
      measurableOutcome: input.description,
      targetDate: input.targetDate,
    });
    await refreshManagementData();
  }, [account, refreshManagementData]);

  const updateGoal = useCallback(async (
    goalId: string,
    changes: { title?: string; description?: string; targetDate?: string; status?: LocalGoal['status'] },
  ) => {
    const token = tokenRef.current;
    if (!token) throw new Error('Sign in before updating a goal.');
    await updateMentorshipGoalWithApi(token, goalId, {
      ...(changes.title !== undefined ? { title: changes.title } : {}),
      ...(changes.description !== undefined ? { measurableOutcome: changes.description } : {}),
      ...(changes.targetDate !== undefined ? { targetDate: changes.targetDate } : {}),
      ...(changes.status !== undefined ? { status: changes.status } : {}),
    });
    await refreshManagementData();
  }, [refreshManagementData]);

  const createMilestone = useCallback(async (goalId: string, title: string) => {
    const token = tokenRef.current;
    if (!token) throw new Error('Sign in before adding a milestone.');
    await createGoalMilestoneWithApi(token, goalId, title);
    await refreshManagementData();
  }, [refreshManagementData]);

  const updateMilestone = useCallback(async (
    milestoneId: string,
    changes: { title?: string; status?: GoalMilestone['status'] },
  ) => {
    const token = tokenRef.current;
    if (!token) throw new Error('Sign in before updating a milestone.');
    await updateGoalMilestoneWithApi(token, milestoneId, changes);
    await refreshManagementData();
  }, [refreshManagementData]);

  const createSession = useCallback(async (
    input: Pick<LocalSession, 'title' | 'scheduledAt' | 'notes'>,
    relationshipId: string,
  ) => {
    const token = tokenRef.current;
    if (!token || !account || account.user.role === 'staff') throw new Error('Sign in as a mentorship participant to schedule a session.');
    await createMentorshipSessionWithApi(token, {
      relationshipId,
      title: input.title,
      scheduledAt: input.scheduledAt,
      preparationNotes: input.notes,
    });
    await refreshManagementData();
  }, [account, refreshManagementData]);

  const updateSession = useCallback(async (
    sessionId: string,
    changes: { title?: string; scheduledAt?: string; preparationNotes?: string; outcomeNotes?: string; status?: SessionStatus },
  ) => {
    const token = tokenRef.current;
    if (!token) throw new Error('Sign in before updating a session.');
    await updateMentorshipSessionWithApi(token, sessionId, changes);
    await refreshManagementData();
  }, [refreshManagementData]);

  const updateSessionStatus = useCallback(async (sessionId: string, status: SessionStatus) => {
    const token = tokenRef.current;
    if (!token) throw new Error('Sign in before updating a session.');
    await updateMentorshipSessionWithApi(token, sessionId, { status });
    await refreshManagementData();
  }, [refreshManagementData]);

  const currentUser = account?.user ?? null;
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const data = useMemo(() => {
    const empty = createEmptyData();
    if (!account) return empty;
    return {
      ...empty,
      users: [account.user],
      profiles: [account.profile],
      requests,
      mentorships,
      goals,
      sessions,
      currentUserId: account.user.id,
    };
  }, [account, requests, mentorships, goals, sessions]);

  return (
    <AppContext.Provider value={{
      data,
      loading,
      error,
      currentTime,
      mentorshipLoading,
      mentorshipError,
      managementLoading,
      managementError,
      currentUser,
      login,
      register,
      consumeStaffInvitation,
      acceptStaffInvitation,
      createStaffProgramme,
      assignStaffParticipant,
      updateStaffParticipantMembership,
      getStaffDashboard,
      listStaffProgrammes,
      listStaffParticipants,
      getStaffParticipant,
      getStaffProgrammeOversight,
      listStaffMatchProposals,
      createStaffMatchProposal,
      withdrawStaffMatchProposal,
      listMatchProposals,
      respondToMatchProposal,
      createStaffProgrammeSession,
      respondToSessionParticipation,
      logout,
      retrySessionRestore,
      updateProfile,
      uploadProfileImage,
      uploadAgriculturalImage,
      listAgriculturalImages,
      deleteAgriculturalImage,
      refreshMentorshipData,
      refreshManagementData,
      endRelationship,
      listMentors,
      getMentor,
      sendRequest,
      updateRequest,
      createGoal,
      toggleMilestone: async (goalId: string, milestoneId: string, title?: string) => {
        if (!milestoneId) {
          if (!title) throw new Error('Enter a milestone title.');
          await createMilestone(goalId, title);
          return;
        }
        const milestone = goals.find((goal) => goal.id === goalId)?.milestones.find((item) => item.id === milestoneId);
        if (!milestone) throw new Error('Milestone not found.');
        await updateMilestone(milestoneId, { status: milestone.completed ? 'pending' : 'completed' });
      },
      updateGoal,
      createMilestone,
      updateMilestone,
      createSession,
      updateSession,
      updateSessionStatus,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useLocalApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useLocalApp must be used inside LocalAppProvider.');
  return context;
}
