export interface SecGenScenarioContext {
  id: string;
  name: string;
  description: string;
  vulnerabilities: string[];
  services: string[];
}

export interface SecGenScenario extends SecGenScenarioContext {
  projectDirectory: string;
  generatedAt: string;
}

export interface SecGenPrerequisiteStatus {
  valid: boolean;
  errors: string[];
}

export interface DockerLlmStatus {
  running: boolean;
  image: string;
  model: string;
  baseUrl: string;
  port: number;
  containerId?: string;
}

export interface StudentProgress {
  completedActivities: number;
  totalAttempts: number;
  averageConfidence: number | null;
  lowConfidenceCategories: string[];
}
