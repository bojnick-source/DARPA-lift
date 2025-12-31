export interface NLSecurityPolicy {
  allowedPaths: string[];
  allowedPanels: string[];
  allowedPipelines: string[];
}

export const DEFAULT_NL_POLICY: NLSecurityPolicy = {
  allowedPaths: [],
  allowedPanels: [],
  allowedPipelines: [],
};
