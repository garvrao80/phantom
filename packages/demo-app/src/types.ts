export type Team = {
  id: string;
  name: string;
  members: string[];
  createdAt?: string;
};
export type Project = {
  id: string;
  teamId: string;
  title: string;
  pitch: string;
  votes: number;
};
export type LeaderboardEntry = Project & { teamName?: string };
export type ReportError = (error: unknown, retry: () => Promise<void>) => void;
