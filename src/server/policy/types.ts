export type PolicyCheck = {
  id: string;
  name: string;
  passed: boolean;
  message: string;
};

export type PolicyResult = {
  passed: number;
  total: number;
  checks: PolicyCheck[];
  approved: boolean;
};
