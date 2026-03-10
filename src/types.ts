export interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  created_at: string;
  arguments?: ProjectArgument[];
}

export interface ProjectArgument {
  id: string;
  project_id: string;
  content: string;
  created_at: string;
  planned_experiments?: string; // JSON string array
}

export interface Template {
  id: string;
  name: string;
  type: string;
  color: string;
  description: string;
  project_id: string | null;
}

export interface TemplateStep {
  id: string;
  template_id: string;
  day_offset: number;
  step_order: number;
  description: string;
  duration_minutes: number | null;
  notes: string | null;
}

export interface Experiment {
  id: string;
  name: string;
  template_id: string | null;
  start_date: string;
  status: 'planned' | 'in_progress' | 'completed' | 'failed';
  notes: string | null;
  color: string;
  template_name?: string;
  max_day_offset?: number;
  project_id: string | null;
  argument_id: string | null;
  project_name?: string;
  samples_json?: string;
}

export interface ExperimentStep {
  id: string;
  experiment_id: string;
  day_offset: number;
  step_order: number;
  description: string;
  is_completed: boolean;
  completed_at: string | null;
  notes: string | null;
}

export interface Record {
  id: string;
  experiment_id: string;
  purpose: string | null;
  results: string | null;
  summary: string | null;
  problems_json: string | null;
}
