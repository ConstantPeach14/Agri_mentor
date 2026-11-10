export type UserRole = 'mentee' | 'mentor' | 'staff';
export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';
export type RelationshipStatus = 'active' | 'completed' | 'ended';
export type SessionStatus = 'scheduled' | 'completed' | 'cancelled';

export type LocalUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone: string;
};

export type LocalProfile = {
  userId: string;
  location: string;
  bio: string;
  interests: string[];
  expertise: string[];
  experience: string;
  specialisation: string;
  needs: string;
  qualifications: string;
  organization: string;
  jobTitle: string;
  maxActiveMentees: number | null;
  activeMentees: number;
  availabilityNote: string;
  imageUrl?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MentorshipParticipant = {
  id: string;
  name: string;
  location: string;
  imageUrl: string | null;
  specialisation?: string;
  experience?: string;
  interests?: string[];
};

export type MentorshipRequest = {
  id: string;
  menteeId: string;
  mentorId: string;
  message: string;
  needs: string;
  interests: string;
  goals: string;
  status: RequestStatus;
  createdAt: string;
  respondedAt: string | null;
  mentee: MentorshipParticipant;
  mentor: MentorshipParticipant;
};

export type Mentorship = {
  id: string;
  requestId: string;
  menteeId: string;
  mentorId: string;
  status: RelationshipStatus;
  startedAt: string;
  endedAt: string | null;
  endedByUserId?: string | null;
  endReason?: string;
  mentee: MentorshipParticipant;
  mentor: MentorshipParticipant;
};

export type GoalMilestone = {
  id: string;
  title: string;
  status: 'pending' | 'completed';
  completed: boolean;
  createdAt: string;
  completedAt: string | null;
};
export type GoalEvent = {
  id: string;
  actorUserId: string;
  type: string;
  details: Record<string, unknown>;
  createdAt: string;
};
export type LocalGoal = {
  id: string;
  relationshipId: string;
  title: string;
  description: string;
  measurableOutcome: string;
  targetDate: string;
  status: 'active' | 'completed' | 'archived';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  milestones: GoalMilestone[];
  history: GoalEvent[];
};

export type LocalSession = {
  id: string;
  relationshipId: string;
  title: string;
  scheduledAt: string;
  notes: string;
  preparationNotes: string;
  outcomeNotes: string;
  status: SessionStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  coordinatedByStaffUserId?: string | null;
  coordinatedByStaffName?: string | null;
  menteeResponse?: 'pending' | 'attended' | 'missed' | null;
  mentorResponse?: 'pending' | 'attended' | 'missed' | null;
};

export type LocalData = {
  version: 2;
  users: LocalUser[];
  profiles: LocalProfile[];
  requests: MentorshipRequest[];
  mentorships: Mentorship[];
  goals: LocalGoal[];
  sessions: LocalSession[];
  currentUserId: string | null;
};

export function createEmptyData(): LocalData {
  return {
    version: 2,
    users: [],
    profiles: [],
    requests: [],
    mentorships: [],
    goals: [],
    sessions: [],
    currentUserId: null,
  };
}
